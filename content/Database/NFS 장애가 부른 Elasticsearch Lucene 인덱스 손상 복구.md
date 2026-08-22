---
title: NFS 장애가 부른 Elasticsearch Lucene 인덱스 손상 복구
date: 2025-10-16
draft: false
tags:
  - elasticsearch
  - lucene
  - kubernetes
  - nfs
  - index-corruption
  - snapshot
  - split-brain
  - troubleshooting
  - disaster-recovery
banner: 
cssclasses: 
description: NFS 장애로 Lucene 세그먼트가 손상되어 마스터 선출이 막히고 로그 시스템이 이틀간 멈춘 상황을, 클러스터 메타데이터만 제거하고 스냅샷으로 복원하여 해결한 복구 기록.
permalink: 
aliases: 
completed: true
type:
  - issue
---

## 요약

> [!SUMMARY]
> NFS 백엔드에 장애가 발생하면서 Elasticsearch가 세그먼트 파일을 쓰던 도중 연결이 끊겼고, 0바이트로 잘린 세그먼트 때문에 마스터 3대가 모두 클러스터 상태(`_state`)를 읽지 못해 마스터 선출이 막혔다(로그 시스템이 이틀간 멈췄다). 인덱스 데이터는 건드리지 않으면서 손상된 `_state`와 0바이트 파일만 제거하여 마스터 선출을 회복시킨 뒤, 스냅샷에서 애플리케이션 인덱스를 복원하여 서비스를 정상화했다.

## 1. 환경

- Elasticsearch: Kubernetes StatefulSet, 마스터 3대(`elasticsearch-master-0~2`)
- Kibana: 별도 Deployment
- 데이터 볼륨: <b>NFS</b> 백엔드 PV (지금 돌아보면 이것이 근본 원인이었다)
- 스냅샷 저장소: `fs` 타입 리포지토리(외부 스토리지)

## 2. 이슈

로그 조회가 되지 않는다는 이야기를 듣고 파드 상태를 확인했다. 마스터 3대는 겉보기에는 `Running` 상태였지만 클러스터 health는 `unknown`이었고, Kibana는 Elasticsearch에 연결하지 못해 503 오류를 반환하며 재시작을 반복하고 있었다. 최초 장애 시점을 로그로 거슬러 확인해 보니 이미 이틀 가까이 로그 시스템 전체가 멈춰 있었다.

```
NAME                     READY   STATUS             RESTARTS   AGE
elasticsearch-master-0   1/1     Running            0          2d8h
elasticsearch-master-1   1/1     Running            0          4d17h
elasticsearch-master-2   1/1     Running            0          47h
kibana-xxxxxxx-xxxxx     0/1     CrashLoopBackOff   2          7m
```

파드는 Running 상태인데 정작 클러스터가 마스터를 선출하지 못하고 있었다. 마스터 3대가 서로를 discovery하고도 선출이 이루어지지 않는, 스스로를 구성하지 못하는 <b>split-brain</b> 상태였다. 로그를 확인했다.

```
[WARN][o.e.c.c.ClusterFormationFailureHelper] [master-0]
  master not discovered or elected yet, an election requires at least 2 nodes ...
  MasterNotDiscoveredException

... CorruptIndexException[Unexpected file read error while reading index]
Caused by: java.io.EOFException: read past EOF:
  NIOFSIndexInput(path=".../nodes/0/_state/segments_1hq")
```

마스터 선출이 실패하는 이유가 그 아래에 있었다. `EOFException: read past EOF`. 세그먼트 파일을 읽다가 파일 끝을 예상보다 일찍 만났다는 의미이다. 실제로 해당 세그먼트 파일(`segments_fxk` 등)은 0바이트였다. 정상적으로 닫힌 것이 아니라 <b>쓰던 도중에 잘렸다</b>는 신호이다.

파일이 잘린 원인을 살펴보면, 며칠 전 NFS 서버 쪽에 장애가 있었다. ES가 세그먼트(`segments_N`)에 쓰기를 하는 도중 NFS 연결이 끊기면, 커밋이 끝나기 전에 파일이 0바이트나 truncated 상태로 남는다. ES가 재시작하면서 불완전한 세그먼트를 읽으려다 실패하고, 마스터 노드는 클러스터 상태가 들어 있는 `_state` 디렉토리를 읽지 못한다. 상태를 읽지 못하니 선출에 참여할 수 없고, 세 노드가 모두 같은 상태이므로 클러스터가 다시는 기동하지 않는 것이다.

> [!IMPORTANT]
> ES를 NFS 위에 올린 게 근본 원인이다. Lucene은 세그먼트 파일이 원자적으로 커밋된다고 믿는데, NFS는 네트워크 지연·파일 락·캐시 일관성 문제 때문에 ES 데이터 디렉토리로는 권장되지 않는다. 특히 NFS가 불안정할 때 발생하는 불완전 쓰기는 Lucene 레벨에서 복구가 거의 불가능하다. 단순히 PV 하나를 붙였을 뿐인데 이런 결과까지 이어진 것이다.

## 3. 해결

복구 방향은 하나였다. 인덱스 데이터(샤드)는 대부분 정상이므로 살리고, 손상된 것은 클러스터 메타데이터와 일부 세그먼트뿐이라고 가정하여 <b>최소한만 제거하는</b> 것이다. 전체 데이터를 삭제하는 것은 스냅샷이 완벽하다는 확신이 있을 때만 사용하는 최후의 수단이다.

### 1. 손상 범위부터 확인

파드는 Running 상태였으므로 그대로 exec하여 데이터 디렉토리를 조사했다. 0바이트로 잘린 파일이 어디에 얼마나 있는지부터 집계했다.

```bash
# _state 디렉토리 목록과 파일 크기 확인 (0바이트 segments 파일을 찾는다)
kubectl exec elasticsearch-master-0 -- \
  ls -la /usr/share/elasticsearch/data/nodes/0/_state/

# 데이터 전체에서 크기 0인 파일 목록 (segments, state 파일)
kubectl exec elasticsearch-master-0 -- \
  find /usr/share/elasticsearch/data -name "segments*" -o -name "state-*.st" -size 0
```

손상은 예상대로 `_state`의 클러스터 메타데이터(0바이트 `segments_fxk`)와 인덱스 메타데이터 파일(0바이트 `state-*.st`, 세 노드 합쳐 66개)에 집중되어 있었다. 반면 실제 인덱스 데이터(`indices` 디렉토리, 149개)는 정상적으로 남아 있었다.

### 2. 손상된 `_state`만 비우기

마스터 선출을 막는 것은 손상된 클러스터 상태 파일이다. 이것을 삭제하면 ES는 클러스터 상태를 새로 쓰기 시작하고, 재기동 시 디스크에 남아 있는 기존 샤드들을 다시 발견하여 편입시킨다. 인덱스 데이터는 건드리지 않는다.

먼저 StatefulSet을 0으로 축소하여 파드가 자동으로 기동하지 못하게 차단하고, 각 PVC를 임시 파드에 마운트하여 `_state`를 제거했다. 삭제하지 않고 `mv`로 백업만 해 두었다. 판단이 틀렸을 때 되돌릴 여지를 남기기 위해서이다.

```bash
# 모든 마스터 파드 중지 (kubelet이 성급하게 파드를 띄우지 못하게)
kubectl scale statefulset elasticsearch-master --replicas=0

# 각 노드의 PVC를 임시 파드에 마운트해 _state를 백업 이름으로 옮긴다(삭제 아님).
# (--overrides로 data PVC를 /data에 붙이고, _state를 _state.backup으로 mv)
for i in 0 1 2; do
  kubectl run state-clean-${i} --image=ubuntu --restart=Never \
    --overrides="{\"spec\":{\"volumes\":[{\"name\":\"data\",\"persistentVolumeClaim\":{\"claimName\":\"data-elasticsearch-master-${i}\"}}],\"containers\":[{\"name\":\"clean\",\"image\":\"ubuntu\",\"command\":[\"bash\",\"-c\",\"mv /data/nodes/0/_state /data/nodes/0/_state.backup.$(date +%Y%m%d_%H%M%S) && echo done\"],\"volumeMounts\":[{\"name\":\"data\",\"mountPath\":\"/data\"}]}]}}"
done

kubectl delete pod state-clean-0 state-clean-1 state-clean-2
```

> [!NOTE]
> `_state` 삭제가 이 복구의 핵심이다. 클러스터 메타데이터가 손상되어 마스터 선출이 막힐 때, `_state`를 비우면 ES는 "새 클러스터"로 기동하되 디스크의 기존 샤드를 그대로 편입한다. 즉 <b>메타데이터는 리셋하고 데이터는 보존</b>한다. etcd에서 멤버십만 리셋하고 데이터를 살리는 `--force-new-cluster`와 발상이 비슷하다.

### 3. 0바이트 인덱스 메타데이터 정리

`_state`를 제거하더라도 개별 인덱스의 메타데이터 파일(`state-*.st`)이 0바이트로 잘려 있으면 해당 샤드가 다시 문제를 일으킨다. 크기 0인 `state-*.st`를 같은 방식으로 제거했다(master-0에서 25개, master-2에서 41개가 나왔다).

```bash
# 각 노드에서 0바이트 state-*.st 파일 삭제
for i in 0 1 2; do
  kubectl run meta-clean-${i} --image=ubuntu --restart=Never \
    --overrides="{\"spec\":{\"volumes\":[{\"name\":\"data\",\"persistentVolumeClaim\":{\"claimName\":\"data-elasticsearch-master-${i}\"}}],\"containers\":[{\"name\":\"clean\",\"image\":\"ubuntu\",\"command\":[\"bash\",\"-c\",\"find /data/nodes/0/indices -name 'state-*.st' -size 0 -delete && echo done\"],\"volumeMounts\":[{\"name\":\"data\",\"mountPath\":\"/data\"}]}]}}"
done
```

### 4. 재기동과 yellow 복구

정리가 끝나면 StatefulSet을 다시 3으로 확장한다. 마스터 선출이 회복되면서 클러스터가 구성되고, 남아 있던 샤드들이 다시 인식된다.

```bash
kubectl scale statefulset elasticsearch-master --replicas=3

# 클러스터 상태 확인 (yellow = 데이터는 있으나 일부 복제본 미배치)
kubectl exec elasticsearch-master-0 -- \
  curl -s localhost:9200/_cluster/health | python3 -m json.tool
```

상태가 `yellow`로 안정되었다. red가 아니라 yellow라는 것은 프라이머리 샤드는 모두 할당되었고 복제본만 아직 배치되지 않았다는 의미이므로, 이 시점에 이미 데이터 조회가 가능했다. 디스크에 남아 있던 149개 인덱스가 그대로 다시 인식된 것을 확인했다. `_state`만 제거하고 데이터를 건드리지 않은 판단이 옳았다.

### 5. 스냅샷에서 손상 인덱스 되채우기

`yellow`까지 회복했지만 세그먼트가 손상된 애플리케이션 인덱스 일부는 데이터가 온전하지 않았다. 이것은 Lucene 레벨에서 복구할 수 없는 종류의 손상이므로, 정기 스냅샷이 유일한 복구 수단이다. 손상 인덱스 106개를 스냅샷에서 추가로 복원했다.

```bash
# 스냅샷 목록 확인
curl -X GET "localhost:9200/_snapshot/my_backup/_all?pretty"

# 손상된 애플리케이션 인덱스만 골라 복원
curl -X POST "localhost:9200/_snapshot/my_backup/snapshot_20251015/_restore" \
  -H 'Content-Type: application/json' -d'
{
  "indices": "app-logs-*,service-*",
  "ignore_unavailable": true,
  "include_global_state": false
}'
```

`include_global_state`는 `false`로 설정했다. 방금 `_state`를 새로 쓴 클러스터에 스냅샷의 이전 글로벌 상태를 다시 덮어쓸 이유가 없었다.

## 4. 확인

중요한 것은 프라이머리 샤드였다. 프라이머리가 모두 할당되면(`yellow`) 그 시점에 이미 조회가 가능하고 Kibana도 기동한다. 복제본은 이후 천천히 배치되면서 `green`으로 수렴한다.

```bash
# 클러스터 상태 확인
curl -s localhost:9200/_cluster/health?pretty

# 미할당 프라이머리 샤드가 있는지 확인 (없어야 한다)
curl -s "localhost:9200/_cat/shards?v" | grep 'p ' | grep UNASSIGNED
```

프라이머리가 모두 배치되면서 Kibana가 정상 기동했고 로그 조회 기능이 돌아왔다. 이틀 만이었다. 3노드에 복제본을 여러 벌 두다 보니 복제본 배치가 끝날 때까지는 한동안 `yellow` 상태에 머물렀지만, 서비스 자체는 그 전에 이미 정상화되어 있었다.

스냅샷이 없었으면 106개 인덱스는 그대로 유실되었을 것이다. 그리고 애초에 ES를 NFS에 올리지 않았으면 이 장애 자체가 발생하지 않았을 것이다. 재발 방지를 위해 확정한 것은 세 가지다. 데이터 디렉토리를 NFS가 아닌 블록 스토리지로 옮길 것, NFS I/O 오류와 클러스터 health를 상시 모니터링하고 알림을 설정할 것, 스냅샷 무결성을 정기적으로 검증할 것이다. 이틀치 로그와 맞바꾼 교훈치고는 당연한 내용들이다.

## 참고

- [Restore a snapshot](https://www.elastic.co/guide/en/elasticsearch/reference/current/snapshots-restore-snapshot.html)
- [Register a snapshot repository](https://www.elastic.co/guide/en/elasticsearch/reference/current/snapshots-register-repository.html)
- [Voting configurations (마스터 선출)](https://www.elastic.co/guide/en/elasticsearch/reference/current/modules-discovery-voting.html)
- [Lucene CheckIndex](https://lucene.apache.org/core/9_0_0/core/org/apache/lucene/index/CheckIndex.html)
