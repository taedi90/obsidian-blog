---
title: MariaDB Galera 한 노드가 깨졌을 때 무손실로 되살리기
date: 2026-06-09
draft: false
tags:
  - mariadb
  - galera
  - kubernetes
  - mariadb-operator
  - split-brain
  - sst
  - troubleshooting
  - disaster-recovery
banner: 
cssclasses: 
description: NFS 백엔드 재기동으로 datadir이 깨져 CrashLoop에 빠진 Galera 노드를, 정상 노드를 donor 삼아 SST로 무손실 재동기화한 복구 기록.
permalink: 
aliases: 
completed: true
type:
  - issue
---

## 요약

> [!SUMMARY]
> mariadb-operator로 운영하는 Galera 3노드 클러스터에서 한 노드의 datadir이 깨져 CrashLoop에 빠지면, operator가 그 노드 때문에 reconcile을 끝내지 못해 클러스터 전체가 not-Ready로 묶인다. 정상 노드가 Primary/Synced인지부터 확인하고, operator reconcile을 suspend한 뒤 손상 노드의 PVC만 비우고 재기동해 <b>SST</b>로 다시 받게 하면 데이터 유실 없이 복구된다. 여러 노드가 동시에 깨져 split-brain이면 `grastate.dat`·`availableWhenDonor`·`startupProbe`까지 손봐야 한다.

## 1. 환경

- Kubernetes + mariadb-operator
- MariaDB Galera 3노드 클러스터 (StatefulSet, Pod 3개)
- 스토리지: 자체호스팅 NFS 백엔드, PVC 100Gi/노드, 마운트 `/var/lib/mysql`
- 손상 노드 예시: `app-mariadb-2`, datadir PVC `storage-app-mariadb-2`

네임스페이스·호스트명·UUID 등은 전부 가상값으로 바꿔 적는다.

## 2. 이슈

어느 날 데이터 레이어를 받치던 NFS 서버 Pod가 재기동됐다. 그 스토리지클래스를 쓰던 PVC가 일제히 NFS 단절을 겪었고, 그 위에서 돌던 DB Pod들이 비정상 종료되는 과정에서 Galera 한 노드(`app-mariadb-2`)의 datadir 일부 파일이 깨졌다. 로그를 보면 이런 식이다.

```
[ERROR] mariadbd: Got error 'Size of control file is smaller than expected' ... aria_log_control
[ERROR] InnoDB: File ./ib_logfile0 was not found
Installation of system tables failed!
```

여기서 첫 번째 함정이 있다. datadir은 PVC에 그대로 남아 있으므로 Pod를 재시작한다고 해결되지 않는다. 깨진 파일이 그 자리에 계속 있으니 몇 번을 재시작해도 같은 지점에서 죽는다. 그래서 `CrashLoopBackOff`에 빠진다.

두 번째 함정은 클러스터 전체가 not-Ready로 보인다는 것이다. MariaDB CR은 `Ready=False`, `GaleraReady=False` 상태에서 `error restarting Pod 'app-mariadb-2': context deadline exceeded`를 출력한다. 정상 노드의 agent 로그에도 다음 내용이 계속 기록된다.

```
probe.liveness "Galera not ready. Returning OK to facilitate recovery"
```

처음에는 "정상 노드까지 문제가 생겼나" 싶어 놀랐지만, 이것은 고장 신호가 아니었다. 복구 중인 Pod가 kubelet에게 종료되지 않도록 liveness 가 일부러 OK를 돌려주는 <b>정상 동작</b>이다. 정상 primary 노드도 같은 로그를 남긴다. operator가 손상 노드 하나 때문에 reconcile 을 끝내지 못하고, 그 여파로 클러스터를 not-Ready로 표시하고 있었을 뿐이다. 손상 노드만 복구하면 이 로그도 멈춘다.

> [!NOTE]
> Galera 는 쓰기 가능한 상태를 유지하려면 과반(quorum)이 필요하다. 3노드 중 2노드가 Primary/Synced 로 살아 있으면 클러스터 자체는 멀쩡하고, 나머지 1노드는 살아 있는 노드에서 <b>SST(State Snapshot Transfer)</b>로 datadir 전체를 다시 받아 합류하면 된다. 즉 깨진 노드 하나를 버리고 데이터를 다시 받으면 되는 문제다.

## 3. 해결

되돌리기 어려운 작업이므로 손대기 전에 게이트를 하나 둔다. <b>정상 노드가 실제로 Primary/Synced 인가.</b> 이것이 확인되어야 그 노드를 donor 로 삼아 손상 노드의 데이터를 다시 받을 수 있다. 아니라면 아래의 단순 절차로는 처리할 수 없고, split-brain 대응 절차로 넘어가야 한다.

### 1. 정상 노드 상태 확인

살아 있는 노드(`app-mariadb-0`)에서 wsrep 상태를 확인한다. root 비밀번호를 커맨드에 직접 넣지 않으려고 컨테이너 안에 들어 있는 healthcheck 용 설정 파일을 그대로 사용한다.

```bash
# 정상으로 보이는 노드에서 Galera 클러스터 상태를 조회한다.
kubectl -n app-db exec app-mariadb-0 -c mariadb -- \
  mariadb --defaults-extra-file=/var/lib/mysql/.my-healthcheck.cnf -N \
  -e "SHOW STATUS WHERE Variable_name IN \
      ('wsrep_cluster_status','wsrep_local_state_comment','wsrep_cluster_size','wsrep_ready')"
# Primary / Synced / ON 이면 이 노드가 donor 가 될 수 있다 -> 진행
```

`Primary`, `Synced`, `ON`이 나오면 진행한다. 손상 노드 외의 PVC 는 이 시점부터 절대 건드리지 않는다.

### 2. operator reconcile 중단과 손상 노드 격리

먼저 operator 를 재운다. `spec.suspend: true`를 주면 operator 가 리소스에서 손을 떼므로, 수동 조작과 operator 의 자동 복구 로직이 충돌하지 않는다. 이 값을 걸지 않으면 operator 가 5분 timeout 으로 Pod 를 계속 재시작시키며 작업을 방해한다.

```bash
# 1) operator reconcile 중단 (수동 변경과 충돌 방지)
kubectl -n app-db patch mariadb app-mariadb --type merge -p '{"spec":{"suspend":true}}'

# 2) StatefulSet 축소로 손상 Pod 제거 (PVC 는 남는다)
kubectl -n app-db scale statefulset app-mariadb --replicas=2
```

StatefulSet 은 인덱스 역순으로 파드를 종료한다. `replicas=2`면 가장 뒤 인덱스인 `app-mariadb-2`가 먼저 내려간다. 손상 노드가 마침 마지막 인덱스라 운이 좋았던 셈이고, 그렇지 않았다면 인덱스 배치를 더 고민해야 했을 것이다. PVC 는 축소해도 남는다.

### 3. 손상 노드 datadir 비우기

깨진 파일이 그대로 있으면 재기동해도 다시 죽으므로, `storage-app-mariadb-2` PVC 내부를 통째로 비운다. 임시 Pod 로 해당 PVC 만 마운트하여 지운다(air-gapped 환경이면 `busybox` 이미지를 사내 레지스트리 경로로 바꾼다).

```bash
# 손상 노드의 PVC 만 마운트해 내부를 전부 비운다 (숨김 파일 포함).
kubectl -n app-db run mariadb2-wipe --restart=Never --rm -it \
  --image=busybox \
  --overrides='{"spec":{"containers":[{"name":"wipe","image":"busybox","command":["sh","-c","rm -rf /data/* /data/..?* /data/.[!.]* ; ls -la /data"],"volumeMounts":[{"name":"d","mountPath":"/data"}]}],"volumes":[{"name":"d","persistentVolumeClaim":{"claimName":"storage-app-mariadb-2"}}]}}'
```

NFS 서버 호스트나 export 를 마운트한 곳에 직접 접근할 수 있으면 파일시스템에서 바로 지우는 것이 빠르다. 대신 경로를 틀리면 <b>다른 PVC 를 통째로 삭제해버린다.</b> 그래서 PV 의 `nfs.path`로 실제 경로를 확인하고 `ls`로 눈으로 본 다음에만 지운다.

```bash
# PVC -> PV -> 실제 NFS server:path 를 확인한 뒤 그 경로만 비운다.
PV=$(kubectl -n app-db get pvc storage-app-mariadb-2 -o jsonpath='{.spec.volumeName}')
kubectl get pv "$PV" -o jsonpath='{.spec.nfs.server}:{.spec.nfs.path}{"\n"}'
# 예: nfs-01:/exports/app-db/storage-app-mariadb-2

DIR=/exports/app-db/storage-app-mariadb-2
ls -la "$DIR"                     # 대상 디렉토리 맞는지 먼저 확인
find "$DIR" -mindepth 1 -delete   # 디렉토리는 두고 내부만 제거
ls -la "$DIR"                     # 비었는지 확인
```

### 4. 재기동과 SST 재동기화

빈 datadir 로 Pod 를 다시 띄우고 operator 를 깨우면, operator 와 Galera 가 알아서 빈 노드에 SST 를 수행한다. 정상 노드가 donor 가 되어 datadir 전체를 넘겨준다.

```bash
# 3) StatefulSet 복원 -> 빈 datadir 로 Pod 재생성
kubectl -n app-db scale statefulset app-mariadb --replicas=3

# 4) reconcile 재개 -> operator/Galera 가 빈 노드에 SST 수행
kubectl -n app-db patch mariadb app-mariadb --type merge -p '{"spec":{"suspend":false}}'
```

여기까지가 "한 노드만 깨졌고 나머지가 멀쩡할 때"의 정석적인 절차다. 손댈 부분이 많지 않다. 번거로운 것은 여러 노드가 동시에 깨졌을 때다.

### 5. 여러 노드가 깨졌을 때: grastate와 safe_to_bootstrap

예전에 노드들이 한꺼번에 비정상 종료되어 split-brain 이 발생한 적이 있다. 그때 Pod 들의 상태는 다음과 같았다.

- Pod-0: 원래 클러스터 UUID 를 유지한 채 부트스트랩을 거부하여 `CrashLoopBackOff`
- Pod-1: Running이지만 혼자 새 UUID로 떨어져 나가 단독 클러스터를 형성
- Pod-2: InnoDB 데이터 파일 손상으로 시작 불가

Pod-0 로그에서 다음 부분이 걸렸다.

```
[ERROR] WSREP: It may not be safe to bootstrap the cluster from this node.
It was not the last one to leave the cluster and may not contain all the updates.
Found saved state: <cluster-uuid-A>:-1, safe_to_bootstrap: 0
```

Galera 는 각 노드의 datadir 에 <b>grastate.dat</b>를 두고, 여기 `safe_to_bootstrap` 플래그로 "이 노드가 클러스터에서 마지막까지 남아 있어 최신 데이터를 보장하는가"를 기록한다. 비정상 종료로 이 값이 전부 `0`이 되면 어느 노드도 스스로 클러스터를 부트스트랩하지 못한다. 데이터가 가장 최신인 노드(또는 physical backup 이 복원된 노드)를 골라 이 값을 `1`로 바꿔줘야 한다.

```bash
# 부트스트랩 기준으로 삼을 노드의 datadir 에서 safe_to_bootstrap 을 1 로 바꾼다.
# (임시 busybox Pod 로 해당 PVC 를 /data 에 마운트한 상태)
sed -i 's/safe_to_bootstrap: 0/safe_to_bootstrap: 1/g' /data/grastate.dat
cat /data/grastate.dat  # 확인
```

Pod 가 재시작되면 이 값은 다시 `0`으로 돌아간다. 그래서 operator 를 suspend 한 상태에서 해당 노드만 `replicas=1`로 단독 부트스트랩하고, 나머지 노드는 datadir 을 비워 SST 로 데이터를 다시 받게 한 뒤 하나씩 붙이면서 순서대로 확장했다(0→1→2→3). "운이 나쁘면 grastate 를 몇 번이고 다시 고치게 된다"는 사실을 몸으로 배웠다.

### 6. availableWhenDonor와 startupProbe

여기서 두 차례 막혔다. 둘 다 3노드 클러스터라서 생기는 문제다.

첫째는 <b>availableWhenDonor</b>였다. 노드를 다시 붙였는데 SST donor 를 찾지 못해 모두 NON-PRIMARY로 멈췄다. 원인은 이 값이 기본값 `false`라는 것이었다. donor 로 동작하는 노드는 SST 중에 트래픽을 받지 않는다는 뜻인데, 3노드에서 두 노드가 동시에 SST 를 받으려 하면 donor 하나가 빠지는 순간 과반이 깨진다. 큰 클러스터라면 donor 보호에 맞는 기본값이지만, 3노드에서는 켜줘야 SST 가 성립한다.

```bash
# 3노드 클러스터에서 SST 가 성립하도록 donor 도 서비스 가능하게 둔다.
kubectl -n app-db patch mariadb app-mariadb \
  --type=merge -p '{"spec":{"galera":{"availableWhenDonor":true}}}'
```

둘째는 <b>startupProbe</b> timeout 이었다. SST 는 datadir 을 통째로 넘기는 작업이라 데이터가 크면 오래 걸린다. 한 케이스에서 SST 가 17분 걸렸는데, startupProbe 의 `failureThreshold`가 5분치밖에 되지 않아 SST 가 끝나기 전에 Pod 가 재시작됐다. 그러면 SST 가 중단되고, 다시 시작하고, 또 timeout 이 발생하는 무한 반복이 된다. 특히 NFS 위에서는 초기화 파일 생성부터 로컬 디스크보다 훨씬 느리므로 여유를 넉넉히 잡아야 한다.

```bash
# SST 소요 시간보다 훨씬 길게 startupProbe 여유를 준다 (200 * 30s = 100분).
kubectl -n app-db patch mariadb app-mariadb --type=merge \
  -p '{"spec":{"podTemplate":{"spec":{"containers":[{"name":"mariadb","startupProbe":{"failureThreshold":200,"periodSeconds":30}}]}}}}'
```

SST 실측치의 5배 정도로 잡아뒀다. 과해 보이더라도 timeout 이 한 번 발생하면 처음부터 다시 해야 하므로 넉넉히 잡는 쪽이 낫다.

## 4. 확인

Pod 가 모두 올라오면 클러스터 크기와 CR 상태를 확인한다.

```bash
kubectl -n app-db get pod -l app.kubernetes.io/instance=app-mariadb
kubectl -n app-db get mariadb app-mariadb \
  -o jsonpath='Ready={.status.conditions[?(@.type=="Ready")].status} GaleraReady={.status.conditions[?(@.type=="GaleraReady")].status}{"\n"}'
kubectl -n app-db exec app-mariadb-0 -c mariadb -- \
  mariadb --defaults-extra-file=/var/lib/mysql/.my-healthcheck.cnf -N \
  -e "SHOW STATUS LIKE 'wsrep_cluster_size'"
```

`wsrep_cluster_size=3`, `Ready`/`GaleraReady=True`면 끝난다. 앞서 신경 쓰이던 agent 의 `Galera not ready` 로그도 그제서야 멈췄다.

다만 근본 트리거는 이 복구로 막을 수 없다. NFS 서버 재기동은 그 위의 데이터 레이어 전체에 동시에 영향을 준다. 노드 하나를 되살리는 일과, NFS 를 건드릴 때 영향 범위를 함께 살피는 일은 별개의 과제다. 그래서 재발 방지 쪽으로는 `availableWhenDonor: true`와 넉넉한 `startupProbe`를 CR 표준값으로 명시하고, `wsrep_cluster_size` 알림을 걸어두는 선에서 정리했다. 이 절차 자체도 문서로 남겨 다음 담당자(아마 미래의 나)가 당황하지 않게 해뒀다.

> [!IMPORTANT]
> 여러 노드가 동시에 깨졌거나 어느 노드가 최신인지 불확실하다면, 위의 단순 절차로 함부로 datadir 을 비우면 안 된다. `grastate.dat`의 seqno 를 비교해 부트스트랩 노드를 먼저 정하는 정식 Galera 복구 흐름을 따라야 한다. "정상 노드가 Primary/Synced 인가"라는 게이트가 통과되지 않으면 이미 다른 종류의 사고다.

## 참고

- [MariaDB Galera Cluster](https://mariadb.com/kb/en/galera-cluster/)
- [Galera Cluster Crash Recovery](https://galeracluster.com/library/documentation/crash-recovery.html)
- [Introduction to State Snapshot Transfers (SSTs)](https://mariadb.com/kb/en/introduction-to-state-snapshot-transfers-ssts/)
- [mariadb-operator](https://github.com/mariadb-operator/mariadb-operator)
- [Kubernetes StatefulSet](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/)
- [[MariaDB Operator(Galera) 물리 백업과 PITR 실전]]
- [[Galera 앞단에 MaxScale read-write-split 프록시를 두고 Helm 관리 Service를 재지정하기|같은 Galera 클러스터 앞단 프록시 이야기]]
