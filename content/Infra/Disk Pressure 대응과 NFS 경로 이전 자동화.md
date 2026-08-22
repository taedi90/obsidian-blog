---
title: "Node Disk Pressure 대응: 라이브 클러스터의 NFS 경로를 스크립트로 옮기기"
date: 2026-01-08
draft: false
tags:
  - kubernetes
  - storage
  - nfs
  - automation
  - operations
  - disk-pressure
banner: 
cssclasses: 
description: Disk Pressure로 노드가 죽던 클러스터에서, StorageClass로 대상 파드를 전부 찾아 순서대로 내리고 NFS 경로를 통째로 옮긴 기록.
permalink: 
aliases: 
completed: true
type:
  - automation
---

## 요약

> [!SUMMARY]
> Node Disk Pressure로 노드가 주기적으로 죽던 클러스터의 디스크 용도를 전수조사하여 스토리지 노드 2대에 대용량 디스크를 증설했다. 그다음 NFS 데이터를 새 디스크(`/data2`)로 옮겨야 했는데, 그 경로를 사용하는 워크로드가 수십 개라 손으로 세는 순간 하나는 빠뜨릴 것이 뻔했다. 그래서 StorageClass 기준으로 PVC와 이를 사용하는 파드를 자동으로 찾아 scale down/up 명령을 통째로 생성하는 스크립트를 만들고, 검증부터 운영까지 순서대로 내렸다가 rsync로 옮긴 뒤 원복했다.

## 1. 도입 배경

시작은 Node Disk Pressure였다. 특정 노드의 디스크 사용량이 임계치를 넘으면 kubelet이 파드를 축출(Evict)하기 시작하고, 심하면 노드 자체가 `NotReady` 상태로 빠진다. 이것이 하필 검증·운영 클러스터에서 간헐적으로 발생했다. 노드 하나가 흔들리면 거기 배치되어 있던 파드들이 다른 노드로 일제히 이동하면서 연쇄적으로 압박이 번졌다.

응급처치로 오래된 빌드 캐시나 사용하지 않는 이미지를 지워 공간을 확보할 수는 있었다. 그런데 그것은 며칠을 벌어주는 임시방편이었다. 근본 원인은 <b>디스크가 실제로 부족</b>하다는 것이었으므로, 해답은 증설밖에 없었다.

증설을 하려면 먼저 "어느 서버의 어느 디스크가, 어떤 용도로 얼마나 차 있는지"를 알아야 했다. 이것이 정리되어 있지 않아서 서버별로 디스크 용량과 용도를 전수조사했다. 조사해보니 NFS로 사용하는 스토리지가 가장 빠르게 차오르고 있었다. 그래서 스토리지 노드 2대(가칭 `node-05`, `node-07`)에 NFS 전용 대용량 디스크를 장착하기로 하고 결재를 올렸다.

- `node-05`, `node-07`에 NFS 용도 디스크 추가
- 260128 증설 완료 — 새 마운트 경로 `/data2`, 약 3.5T 확보

물리 증설 자체는 결재만 승인되면 끝나는 일이었다. 진짜 작업은 그다음인, <b>이미 운영 중인 NFS 데이터를 새 디스크로 옮기는 것</b>이었다.

## 2. StorageClass로 대상 파드를 전부 찾기

NFS 경로를 변경하려면 그 경로를 사용하는 파드를 전부 잠시 내려야 한다. 파일이 열려 있는 상태로 rsync를 실행하면 복사 중에 데이터가 변경되어 정합성이 깨지기 때문이다.

문제는 그 "전부"가 몇 개인지 나조차 몰랐다는 점이다. NFS StorageClass(`nfs-client`)를 사용하는 PVC가 네임스페이스 여기저기 흩어져 있고, 그 PVC를 실제로 마운트한 파드도 Deployment·StatefulSet에 뒤섞여 있었다. 눈으로 세면 수십 개다. 사람이 세면 반드시 하나는 놓친다(그리고 놓친 그 하나가 꼭 DB다).

그래서 먼저 조사용 스크립트를 작성했다. 특정 StorageClass를 사용하는 PVC를 조회하고, 각 PVC를 `describe`하여 `Used By`에 표시된 파드까지 결합한 표를 출력한다.

```bash
#!/bin/bash
# 인자로 받은 StorageClass(기본값 nfs-client)를 쓰는 PVC와,
# 그 PVC를 실제로 물고 있는 파드를 네임스페이스별로 표로 출력한다.
SC_NAME="${1:-nfs-client}"
>&2 echo "StorageClass: '$SC_NAME' 검색 중..."

(
  echo "NAMESPACE  PVC-NAME  USED-BY-POD"

  # 해당 StorageClass를 쓰는 PVC만 (네임스페이스, 이름) 쌍으로 조회
  kubectl get pvc -A -o jsonpath="{range .items[?(@.spec.storageClassName==\"$SC_NAME\")]}{.metadata.namespace} {.metadata.name}{\"\n\"}{end}" | while read ns pvc; do
    # describe의 'Used By' 섹션을 파싱해 파드명만 추출 (<none> 제외)
    used_pods=$(kubectl describe pvc "$pvc" -n "$ns" \
      | awk '/^Used By:/{flag=1; sub(/^Used By:/, ""); print; next} /^[A-Z]/{flag=0} flag {print}' \
      | tr -d ' ' | grep -v "<none>")

    if [ -z "$used_pods" ]; then
       echo "$ns $pvc (None)"
    else
       for pod in $used_pods; do echo "$ns $pvc $pod"; done
    fi
  done
) | column -t
```

이것을 실행하면 어느 네임스페이스의 어떤 PVC를 어떤 파드가 사용하는지 한 화면에 나타난다. `(None)`으로 표시되는 PVC는 현재 아무도 사용하지 않는 것이므로, 내릴 대상에서 제외해도 된다는 뜻이다(사용하지 않는 볼륨이 이렇게 많은지도 이때 알았다).

여기서 한 발 더 나아갔다. 조사 결과를 눈으로 확인하고 다시 `kubectl scale` 명령을 손으로 입력하면 결국 같은 실수를 반복하게 된다. 그래서 대상을 찾는 과정에서 <b>scale down 명령과, 현재 레플리카 수를 기억한 scale up(원복) 명령을 한꺼번에 텍스트로 출력하도록</b> 확장했다. 스크립트가 만들어준 결과는 대략 다음과 같은 형태였다.

```bash
=== [1] 발견된 대상 리소스 목록 ===
[Deployment] mlops/admin-api-deployment (Current Replicas: 2)
[Deployment] mlops/chat-api-deployment (Current Replicas: 2)
[Deployment] mlops/mongodb-deployment (Current Replicas: 1)
[Deployment] mlops/minio (Current Replicas: 1)
...

=== [2] Scale Down 명령어 (복사해서 사용) ===
kubectl scale --replicas=0 -n mlops Deployment admin-api-deployment
kubectl scale --replicas=0 -n mlops Deployment chat-api-deployment
kubectl scale --replicas=0 -n mlops Deployment mongodb-deployment
kubectl scale --replicas=0 -n mlops Deployment minio
...

=== [3] Scale Up (원상복구) 명령어 (복사해서 사용) ===
kubectl scale --replicas=2 -n mlops Deployment admin-api-deployment
kubectl scale --replicas=2 -n mlops Deployment chat-api-deployment
kubectl scale --replicas=1 -n mlops Deployment mongodb-deployment
kubectl scale --replicas=1 -n mlops Deployment minio
...
```

포인트는 [3]번이다. down은 전부 `--replicas=0`이라 단순하지만, up은 원래 레플리카 수가 1인 것과 2인 것이 섞여 있다. 이것을 일괄 `--replicas=1`로 원복하면 2였던 서비스가 조용히 1로 줄어든 채 방치된다. 스크립트가 <b>작업 직전의 replica 수를 그대로 반영하여 원복 명령을 생성</b>하므로 이 함정을 피한다. 운영 네임스페이스는 대상이 수십 개였는데, 이 부분 덕분에 마음이 편했다.

## 3. 작업 순서

명령어가 모두 준비되어도 순서가 틀리면 데이터가 깨진다. 그래서 순서를 먼저 종이에 적고 시작했다.

1. 대상 파드 scale → 0 (StatefulSet 포함, 볼륨을 놓게 만든다)
2. `nfs-server` 중단 (쓰기를 완전히 멈춘다)
3. `rsync`로 기존 경로 → 새 경로 복사
4. `nfs-server` export 경로를 새 경로로 변경 후 재기동
5. 필요 시 `nfs-provisioner` 재기동
6. 파드 scale → 원래 수(스크립트가 만든 [3]번 명령)
7. 마운트가 안 붙어 애매하게 뜬 파드 확인 및 강제 재기동

복사는 rsync로 수행했다. NFS 데이터는 용량이 크고 파일 수도 많아서, 중간에 중단되어도 이어받을 수 있고 변경분만 전송하는 rsync가 적합했다.

```bash
# 기존 NFS 루트를 새 디스크(/data2)로 통째로 복사한다.
# -a: 권한·타임스탬프 보존, --delete: 대상에만 있는 잔여 파일 정리(2회차 동기화 대비)
sudo rsync -av --delete /data/cluster-nfs /data2/
```

`--delete`는 대상 경로에만 남아 있는 잔여 파일을 지워 새 경로를 원본과 정확히 일치시키는 옵션이다. 한 번에 끝나는 복사라면 없어도 되지만, 혹시 rsync를 다시 실행하게 되더라도 새 경로에 옛 파일이 남지 않도록 붙였다.

## 4. 검증부터 돌리고 운영으로

같은 작업을 한 번에 두 클러스터에 모두 적용하지는 않았다. 검증(stg)을 먼저 수행하고, 거기서 순서와 스크립트가 문제없이 동작하는지 확인한 뒤 운영을 수정했다.

- 260129 — 검증 NFS 경로 이전 완료
- 260204 — 운영 NFS 경로 이전 완료

검증에서 한 번 리허설을 한 셈이라 운영 작업은 훨씬 담담하게 진행되었다. 그래도 운영은 파드 수가 많아 scale down부터 up까지 시간이 상당히 걸렸고, 그사이 몇몇 파드는 옛 마운트를 붙인 채 비정상적으로 실행되어 있었다. 이런 파드들은 원복 명령만으로는 정상화되지 않아 `--force --grace-period 0`으로 강제 삭제하여 다시 스케줄되게 했다.

마지막으로 옮긴 뒤의 원본은 바로 지우지 않았다. 새 경로가 며칠 동안 문제없이 운영되는 것을 확인한 뒤에야 정리했는데, 그것조차 삭제가 아니라 압축이었다.

```bash
# 이전이 끝난 운영 원본 데이터를 새 디스크에 tar.gz로 압축 보관한 뒤,
# 원본 경로의 공간을 회수한다. (바로 rm 하기엔 겁이 나서)
tar -czf /data2/old-nfs-backup.tar.gz -C /data cluster-nfs
```

- 260205 — 운영 기존 데이터를 `/data2`에 `tar.gz`로 압축 보관

되돌릴 여지를 남겨두는 습관인데, 스토리지 작업에서는 이러한 신중함이 대체로 이득이었다. 확인 절차는 특별할 것이 없었다. `kubectl get pods -A`로 대상 파드가 전부 다시 `Running` 상태인지, DB류가 데이터를 제대로 읽는지 확인하고, 며칠간 Disk Pressure 이벤트가 다시 발생하지 않는지 지켜봤다. 노드가 죽는 일은 그 뒤로 없었다.

정작 손이 많이 간 것은 rsync나 결재가 아니라, "빠뜨리면 안 되는 파드 목록"을 사람이 아니라 스크립트가 관리하도록 만든 부분이었다. 수십 개짜리 목록을 손으로 관리했다면 어딘가는 반드시 틀렸을 것이다.

## 참고

- [Kubernetes Storage Classes](https://kubernetes.io/docs/concepts/storage/storage-classes/)
- [kubectl scale](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_scale/)
- [Scale a StatefulSet](https://kubernetes.io/docs/tasks/run-application/scale-stateful-set/)
- [rsync(1) man page](https://download.samba.org/pub/rsync/rsync.1)
- [[NFS에 DB를 얹었다가 터진 이야기]]
- [[NFS 쓰기 병목 잡기 - sync→async 전환과 nfsd·마운트 옵션 튜닝]]
