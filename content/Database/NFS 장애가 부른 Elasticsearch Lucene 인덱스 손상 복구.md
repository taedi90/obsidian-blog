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
description: NFS 장애로 Lucene 세그먼트가 잘려 나가 마스터 선출이 막히고 로그 시스템이 이틀간 멈춘 걸, 클러스터 메타데이터만 도려내고 스냅샷으로 되채운 복구 기록.
permalink: 
aliases: 
completed: true
type:
  - issue
---

## 🚀 요약

> [!SUMMARY]
> NFS 백엔드가 장애를 겪으면서 Elasticsearch가 세그먼트 파일을 쓰던 도중 연결이 끊겼고, 0바이트로 잘린 세그먼트 때문에 마스터 3대가 전부 클러스터 상태(`_state`)를 못 읽어 마스터 선출이 막혔다(로그 시스템이 이틀 멈췄다). 인덱스 데이터는 건드리지 않고 손상된 `_state`와 0바이트 파일만 걷어내 마스터 선출을 되살린 뒤, 스냅샷에서 애플리케이션 인덱스를 되채워 서비스를 정상화했다.

## ⚙️ 환경

- Elasticsearch: Kubernetes StatefulSet, 마스터 3대(`elasticsearch-master-0~2`)
- Kibana: 별도 Deployment
- 데이터 볼륨: <b>NFS</b> 백엔드 PV (지금 와서 보면 이게 원죄였다)
- 스냅샷 저장소: `fs` 타입 리포지토리(외부 스토리지)

## 💬 이슈

로그 조회가 안 된다는 얘기를 듣고 파드를 봤다. 마스터 3대는 겉보기엔 `Running`인데 클러스터 health가 `unknown`이었고, Kibana는 Elasticsearch에 붙지 못해 503을 뱉으며 재시작을 반복하고 있었다. 최초 장애 시점을 로그로 되짚어 보니 이미 이틀 가까이 로그 시스템 전체가 멈춰 있었다.

```
NAME                     READY   STATUS             RESTARTS   AGE
elasticsearch-master-0   1/1     Running            0          2d8h
elasticsearch-master-1   1/1     Running            0          4d17h
elasticsearch-master-2   1/1     Running            0          47h
kibana-xxxxxxx-xxxxx     0/1     CrashLoopBackOff   2          7m
```

파드는 Running인데 정작 클러스터가 마스터를 못 뽑고 있었다. 마스터 3대가 서로를 discovery하고도 선출이 안 되는, 스스로를 조립하지 못하는 <b>split-brain</b> 상태였다. 로그를 열어봤다.

```
[WARN][o.e.c.c.ClusterFormationFailureHelper] [master-0]
  master not discovered or elected yet, an election requires at least 2 nodes ...
  MasterNotDiscoveredException

... CorruptIndexException[Unexpected file read error while reading index]
Caused by: java.io.EOFException: read past EOF:
  NIOFSIndexInput(path=".../nodes/0/_state/segments_1hq")
```

마스터를 못 뽑는 이유가 그 아래 있었다. `EOFException: read past EOF`. 세그먼트 파일을 읽다가 파일 끝을 예상보다 일찍 만났다는 뜻이다. 실제로 그 세그먼트 파일(`segments_fxk` 같은)은 0바이트였다. 정상적으로 닫힌 게 아니라 <b>쓰다 만 채로 잘렸다</b>는 신호다.

왜 잘렸나. 며칠 전 NFS 서버 쪽에 장애가 있었다. ES가 세그먼트(`segments_N`)에 쓰기를 하는 도중 NFS 연결이 끊기면, 커밋이 끝나기 전에 파일이 0바이트나 truncated 상태로 남는다. ES가 재시작하면서 그 반토막 세그먼트를 읽으려다 실패하고, 마스터 노드는 클러스터 상태가 들어있는 `_state` 디렉토리를 못 읽는다. 상태를 못 읽으니 선출에 못 나가고, 셋 다 그러니 클러스터가 영영 안 뜬다.

> [!IMPORTANT]
> ES를 NFS 위에 올린 게 근본 원인이다. Lucene은 세그먼트 파일이 원자적으로 커밋된다고 믿는데, NFS는 네트워크 지연·파일 락·캐시 일관성 문제 때문에 ES 데이터 디렉토리로는 권장되지 않는다. 특히 NFS가 흔들릴 때 생기는 불완전 쓰기는 Lucene 레벨에서 복구가 거의 안 된다. "그냥 PV 하나 붙였을 뿐인데"가 여기까지 온다.

## 🧗 해결

방향은 하나였다. 인덱스 데이터(샤드)는 대부분 멀쩡하니 살리고, 손상된 건 클러스터 메타데이터와 몇몇 세그먼트뿐이라고 가정하고 <b>최소한만 도려내는</b> 것. 전체 데이터를 밀어버리는 건 스냅샷이 완벽하다는 확신이 있을 때나 쓰는 최후의 수단이다.

### 1. 손상 범위부터 확인

파드는 Running이라 그대로 exec해서 데이터 디렉토리를 뜯어봤다. 0바이트로 잘린 파일이 어디에 얼마나 있는지부터 셌다.

```bash
# _state 디렉토리 목록과 파일 크기 확인 (0바이트 segments 파일을 찾는다)
kubectl exec elasticsearch-master-0 -- \
  ls -la /usr/share/elasticsearch/data/nodes/0/_state/

# 데이터 전체에서 크기 0인 파일 목록 (segments, state 파일)
kubectl exec elasticsearch-master-0 -- \
  find /usr/share/elasticsearch/data -name "segments*" -o -name "state-*.st" -size 0
```

손상은 예상대로 `_state`의 클러스터 메타데이터(0바이트 `segments_fxk`)와 인덱스 메타데이터 파일(0바이트 `state-*.st`, 세 노드 합쳐 66개)에 몰려 있었다. 반면 실제 인덱스 데이터(`indices` 디렉토리, 149개)는 살아 있었다.

### 2. 손상된 `_state`만 비우기

마스터 선출을 막는 건 손상된 클러스터 상태 파일이다. 이걸 지우면 ES는 클러스터 상태를 새로 쓰기 시작하고, 재기동 시 디스크에 남아있는 기존 샤드들을 다시 발견해 편입시킨다. 인덱스 데이터는 건드리지 않는다.

먼저 StatefulSet을 0으로 내려 파드가 자동으로 뜨지 못하게 막고, 각 PVC를 임시 파드에 마운트해 `_state`를 걷어냈다. 지우지 않고 `mv`로 백업만 해뒀다. 판단이 틀렸을 때 되돌릴 여지를 남기려는 것이다.

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
> `_state` 삭제가 이 복구의 핵심이다. 클러스터 메타데이터가 손상돼 마스터 선출이 막힐 때, `_state`를 비우면 ES는 "새 클러스터"로 기동하되 디스크의 기존 샤드를 그대로 흡수한다. 즉 <b>메타데이터는 리셋하고 데이터는 보존</b>한다. etcd에서 멤버십만 리셋하고 데이터를 살리는 `--force-new-cluster`와 발상이 닮았다.

### 3. 0바이트 인덱스 메타데이터 정리

`_state`를 걷어내도 개별 인덱스의 메타데이터 파일(`state-*.st`)이 0바이트로 잘려 있으면 그 샤드가 다시 발목을 잡는다. 크기 0인 `state-*.st`를 같은 방식으로 걷어냈다(master-0에서 25개, master-2에서 41개가 나왔다).

```bash
# 각 노드에서 0바이트 state-*.st 파일 삭제
for i in 0 1 2; do
  kubectl run meta-clean-${i} --image=ubuntu --restart=Never \
    --overrides="{\"spec\":{\"volumes\":[{\"name\":\"data\",\"persistentVolumeClaim\":{\"claimName\":\"data-elasticsearch-master-${i}\"}}],\"containers\":[{\"name\":\"clean\",\"image\":\"ubuntu\",\"command\":[\"bash\",\"-c\",\"find /data/nodes/0/indices -name 'state-*.st' -size 0 -delete && echo done\"],\"volumeMounts\":[{\"name\":\"data\",\"mountPath\":\"/data\"}]}]}}"
done
```

### 4. 재기동과 yellow 복구

정리가 끝나면 StatefulSet을 다시 3으로 올린다. 마스터 선출이 되살아나면서 클러스터가 조립되고, 살아있던 샤드들이 재인식된다.

```bash
kubectl scale statefulset elasticsearch-master --replicas=3

# 클러스터 상태 확인 (yellow = 데이터는 있으나 일부 복제본 미배치)
kubectl exec elasticsearch-master-0 -- \
  curl -s localhost:9200/_cluster/health | python3 -m json.tool
```

상태가 `yellow`로 안정됐다. red가 아니라 yellow라는 건 프라이머리 샤드는 다 붙었고 복제본만 아직 배치가 안 됐다는 뜻이라, 이 시점에 이미 데이터 조회는 됐다. 디스크에 남아 있던 149개 인덱스가 그대로 재인식된 걸 확인했다. `_state`만 걷어내고 데이터를 안 건드린 판단이 맞았다.

### 5. 스냅샷에서 손상 인덱스 되채우기

`yellow`까지 왔지만 세그먼트가 잘려 나간 애플리케이션 인덱스 일부는 데이터가 온전치 않았다. 이건 Lucene 레벨에서 복구가 안 되는 종류라, 정기 스냅샷이 유일한 안전망이다. 손상 인덱스 106개를 스냅샷에서 추가 복원했다.

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

`include_global_state`는 `false`로 뒀다. 방금 `_state`를 새로 쓴 클러스터에 스냅샷의 옛 글로벌 상태를 다시 덮어쓸 이유가 없었다.

## ✅ 확인

중요한 건 프라이머리 샤드였다. 프라이머리가 다 붙으면(`yellow`) 그 시점에 이미 조회는 되고 Kibana도 뜬다. 복제본은 뒤에서 천천히 배치되면서 `green`으로 수렴한다.

```bash
# 클러스터 상태 확인
curl -s localhost:9200/_cluster/health?pretty

# 미할당 프라이머리 샤드가 있는지 확인 (없어야 한다)
curl -s "localhost:9200/_cat/shards?v" | grep 'p ' | grep UNASSIGNED
```

프라이머리가 전부 배치되면서 Kibana가 정상 기동했고 로그 조회가 돌아왔다. 이틀 만이었다. 3노드에 복제본을 여러 벌 두다 보니 복제본 배치가 끝날 때까지는 한동안 `yellow`에 머물렀지만, 서비스 자체는 그 전에 이미 살아났다.

스냅샷이 없었으면 106개 인덱스는 그대로 날렸다. 그리고 애초에 ES를 NFS에 올리지 않았으면 이 장애 자체가 없었다. 재발 방지로 잡은 건 세 가지다. 데이터 디렉토리를 NFS가 아닌 블록 스토리지로 옮길 것, NFS I/O 에러와 클러스터 health를 상시 모니터링하고 알림을 걸 것, 스냅샷 무결성을 정기적으로 검증할 것. 이틀치 로그와 맞바꾼 교훈치고는 당연한 얘기들이다.

## 🔗 참고

- [Restore a snapshot](https://www.elastic.co/guide/en/elasticsearch/reference/current/snapshots-restore-snapshot.html)
- [Register a snapshot repository](https://www.elastic.co/guide/en/elasticsearch/reference/current/snapshots-register-repository.html)
- [Voting configurations (마스터 선출)](https://www.elastic.co/guide/en/elasticsearch/reference/current/modules-discovery-voting.html)
- [Lucene CheckIndex](https://lucene.apache.org/core/9_0_0/core/org/apache/lucene/index/CheckIndex.html)
