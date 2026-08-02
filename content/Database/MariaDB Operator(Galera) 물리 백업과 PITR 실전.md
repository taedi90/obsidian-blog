---
title: MariaDB Operator(Galera) 환경에서 물리 백업과 PITR 무손실 복구
date: 2025-09-26
draft: false
featured: true
tags:
  - mariadb
  - galera
  - kubernetes
  - operator
  - backup
  - troubleshooting
banner: 
cssclasses: 
description: 오퍼레이터가 관리하는 Galera MariaDB를 mariabackup으로 물리 백업하고, 오퍼레이터를 잠시 재워둔 채 특정 시점으로 무손실 복구한 기록.
permalink: 
aliases: 
completed: true
type:
  - issue
---

## 요약

> [!SUMMARY]
> 오퍼레이터가 관리하는 Galera MariaDB를 `mariabackup`/`xbstream`으로 물리 백업하고, 복구할 때는 오퍼레이터·웹훅·cert-controller를 `replicas 0`으로 잠시 재워 자동복구와 충돌하지 않게 한 뒤, 단일 노드에만 데이터를 복원하고 `grastate.dat`을 `seqno: -1`·`safe_to_bootstrap: 1`로 재작성하고 나머지 노드 PVC를 비워 bootstrap시켰다. 여기에 오퍼레이터의 `PhysicalBackup`과 `bootstrapFrom.targetRecoveryTime`을 얹으면 특정 시점 복구(PITR)까지 선언적으로 넘길 수 있다.

## 1. 환경

- MariaDB: 물리 백업/복원은 `mariabackup`(=`mariadb-backup`) 기준
- Galera: 3노드 클러스터, `mariadb-operator`가 StatefulSet으로 관리
- Kubernetes: NFS 계열 스토리지클래스(`nfs-csi`)에 PVC 배치
- 네임스페이스는 이 글에서 애플리케이션 DB를 `app-db`, MariaDB CR 이름을 `app-mariadb`로 표기 (실제 값 마스킹)

## 2. 이슈

오퍼레이터는 편하다. `MariaDB` CR 하나 던지면 StatefulSet, Service, Galera 부트스트랩, primary failover까지 알아서 굴린다. 그런데 <b>백업을 복원해야 하는 순간</b>, 이 편함이 정확히 반대로 작동한다.

문제는 두 겹이다.

첫째, Galera는 논리적으로 데이터를 하나로 묶는 대신 노드마다 상태를 기억한다. 각 노드의 datadir에는 `grastate.dat`이 있고, 여기 적힌 `uuid`·`seqno`·`safe_to_bootstrap`으로 "누가 최신인지, 누가 클러스터를 처음 띄울 자격이 있는지"를 판단한다. 백업 데이터를 아무 노드에나 부어놓고 재기동하면, 노드들이 서로 다른 상태를 보고 <b>누구를 기준으로 클러스터를 세울지 합의하지 못한다.</b> `NON_PRIM`에서 멈추거나, 엉뚱한 노드가 donor가 되어 방금 복원한 데이터를 SST로 덮어버린다.

둘째, 그 위에 오퍼레이터가 있다. 오퍼레이터는 클러스터가 not-Ready면 "고쳐야 한다"고 판단하고 reconcile 루프를 돈다. 내가 손으로 노드를 재우고 datadir을 만지는 동안, 오퍼레이터는 그걸 <b>고장으로 인식하고 되돌리려 든다.</b> 웹훅은 내가 CR을 수정하는 걸 막고, cert-controller는 또 그것대로 인증서를 채운다. 사람과 컨트롤러가 같은 리소스를 두고 서로 다른 방향으로 잡아당기는, 꽤 피곤한 상황이 된다.

이 글이 답하려는 건 이거다. <b>오퍼레이터의 자동복구와 싸우지 않으면서, 물리 백업을 특정 시점으로 무손실 복원할 수 있는가?</b>

> [!NOTE]
> 여기서 다루는 건 "한 노드만 datadir이 깨진" 흔한 케이스가 아니다. 그건 살아있는 노드가 donor가 되니 깨진 노드 PVC만 비우고 SST를 받게 하면 끝난다. 이 글은 그것보다 무거운, <b>백업 시점의 데이터로 클러스터 전체를 되감아야 하는</b> 경우다.

## 3. 해결

전체 흐름은 이렇게 잡았다.

1. 물리 백업을 뜬다 (`mariabackup` 직접, 또는 오퍼레이터의 `PhysicalBackup`).
2. 오퍼레이터·웹훅·cert-controller를 `replicas 0`으로 재운다.
3. 단일 노드(0번)에만 데이터를 복원하고, `grastate.dat`을 bootstrap 가능 상태로 재작성한다.
4. 나머지 노드 PVC를 비워, 그 노드들이 0번에서 SST로 새로 받게 한다.
5. (선택) 손으로 하는 대신, 오퍼레이터의 `bootstrapFrom` + `targetRecoveryTime`으로 PITR을 통째로 위임한다.

### 1. 물리 백업 뜨기

`mariabackup`은 InnoDB 데이터 파일을 잠그지 않고 통째로 복사하는 물리 백업 도구다(`mariadb-backup`과 동일). 파일을 복사하는 동안에도 DB는 계속 쓰기를 받으므로, 복사된 파일들은 서로 <b>미묘하게 다른 시점의 스냅샷</b>이다. 그래서 복원 전에 반드시 `--prepare`로 redo/undo 로그를 적용해 한 시점으로 일관성을 맞춰야 한다. 이 단계를 건너뛴 데이터는 그냥 깨진 데이터다.

백업은 `xbstream` 스트림으로 단일 파일에 담았다. Galera 클러스터라면 `--galera-info`를 붙여 wsrep 좌표(`xtrabackup_galera_info`)도 함께 남긴다.

```bash
# 실행 중인 노드에서 물리 백업을 xbstream 스트림으로 한 파일에 저장한다.
# 비밀번호는 명령줄에 평문으로 넣지 말고 파일/환경변수로 넘긴다. (아래 주의 참고)
mariabackup --backup --no-lock --galera-info \
  --user=root \
  --databases-exclude='lost+found' \
  --stream=xbstream > /bitnami/mariadb/backup/physicalbackup-20250916000000.xb
```

> [!IMPORTANT]
> 원본 운영 스크립트에는 `--password=<평문>`이 그대로 박혀 있었다. 이건 프로세스 목록(`ps`)과 셸 히스토리에 고스란히 남는다. 실제로는 `~/.my.cnf`의 `[mariabackup]` 섹션이나 `MYSQL_PWD`, 혹은 K8s라면 `secretKeyRef`로 주입하는 게 맞다. 이 글의 명령에서 비밀번호는 전부 뺐다(`<REDACTED>`).

복원 쪽은 두 단계다. 스트림을 풀고(`mbstream -x`), `--prepare`로 일관성을 맞춘 뒤, `--copy-back`으로 실제 datadir에 부어넣는다.

```bash
# 1) 스트림 해제
mbstream -x -C /backup/full < physicalbackup-20250916000000.xb
# 2) redo/undo 적용해 한 시점으로 정합화
mariadb-backup --prepare --target-dir=/backup/full
# 3) datadir(/var/lib/mysql)로 복사. 비어있지 않아도 강제
mariadb-backup --copy-back --target-dir=/backup/full --force-non-empty-directories
```

### 2. 오퍼레이터를 재우는 이유

복원 작업의 절반은 "오퍼레이터가 끼어들지 못하게 하는 것"이다. reconcile을 멈추는 방법은 두 가지가 있다.

CR 하나만 손대면 되는 가벼운 경우엔 `spec.suspend: true`로 그 CR의 reconcile만 끈다.

```bash
# 이 MariaDB CR에 대해서만 오퍼레이터가 손대지 않게 한다.
kubectl -n app-db patch mariadb app-mariadb --type merge -p '{"spec":{"suspend":true}}'
```

하지만 datadir을 직접 만지고 StatefulSet/PVC까지 손대는 이번 같은 작업에서는, 컨트롤러 자체를 내리는 게 확실하다. 오퍼레이터 본체와 함께 <b>웹훅(admission)·cert-controller</b>까지 같이 재워야 한다. 웹훅이 살아있으면 CR 수정이 반려되고, cert-controller가 살아있으면 인증서 시크릿을 다시 채우려 들기 때문이다.

```bash
# 오퍼레이터/웹훅/cert-controller 3종을 한 번에 0으로 내린다.
kubectl -n mariadb-operator scale deployment \
  mariadb-operator \
  mariadb-operator-webhook \
  mariadb-operator-cert-controller \
  --replicas 0
```

> [!INFO]
> 작업이 끝나면 이 셋을 다시 원래 레플리카로 올려야 오퍼레이터가 정상 관리 상태로 돌아온다. 재우고 나서 원복을 잊으면, 나중에 진짜 장애가 났을 때 자동복구가 안 도는 사고로 이어진다. (미래의 나에게 남기는 메모다.)

### 3. 0번 노드에만 복원하고 grastate.dat 재작성

방법 자체는 단순하다. <b>0번 노드를 유일한 진실로 만들고, 나머지는 빈손으로 만든다.</b>

먼저 0번 Pod를 지우고 StatefulSet을 0으로 내려, mysqld가 뜨지 않는 상태에서 PVC를 조용히 만진다.

```bash
# 0번 Pod 제거 (PVC는 남는다)
kubectl -n app-db delete pod app-mariadb-0 --force
# StatefulSet 전체를 0으로 (모든 노드 정지)
kubectl -n app-db scale statefulset app-mariadb --replicas 0
```

그다음 0번 PVC(`storage-app-mariadb-0`)에 위에서 `--copy-back`한 datadir을 채운다. 그리고 그 datadir의 `grastate.dat`을 이렇게 재작성한다.

```text
# storage-app-mariadb-0 의 /var/lib/mysql/grastate.dat
version: 2.1
uuid:    00000000-0000-0000-0000-000000000000
seqno:   -1
safe_to_bootstrap: 1
```

여기서 두 값이 전부다. `seqno: -1`은 "정상 종료 좌표를 모른다 = 복구 상황이다"라는 신호이고, `safe_to_bootstrap: 1`은 "이 노드로 클러스터를 처음 띄워도 된다"는 명시적 허가다. 이 둘이 있어야 Galera가 이 노드를 새 클러스터의 시작점으로 인정한다. 반대로 나머지 1·2번 노드의 PVC 데이터는 <b>전부 비운다.</b> 그래야 그 노드들이 부팅할 때 자기 데이터가 없어서 0번을 donor로 SST를 받고, 결과적으로 0번의 데이터로 클러스터가 통일된다.

> [!NOTE]
> 예전에 `mariadb-operator` + `MariaDB 11.0.3` 조합에서, `grastate.dat`이 0바이트가 되면 오퍼레이터의 agent가 `safe_to_bootstrap`을 갱신하지 못해 bootstrap API가 500을 뱉는 걸 겪은 적이 있다. `error unmarshalling galera state: invalid galera state file` 같은 메시지다. 파일이 "존재하되 최소 유효 형식을 갖추는 것"이 생각보다 중요하다. (당시엔 커스텀 이미지 wrapper로 이 파일을 감시·재생성하게 우회했다.)

필요하면 0번 노드의 설정에서 `wsrep_cluster_address`를 잠깐 `gcomm://`로 두어, 다른 노드를 찾지 않고 자기 혼자 새 클러스터를 여는 것을 명시할 수도 있다. `gcomm://` 뒤가 비어 있다는 건 "join할 기존 노드가 없다 = 내가 시작점이다"라는 뜻이다.

이제 StatefulSet을 다시 올리면 0번이 bootstrap하고, 1·2번이 빈 datadir으로 SST를 받아 합류한다.

```bash
kubectl -n app-db scale statefulset app-mariadb --replicas 3
```

마지막으로 2번에서 재웠던 오퍼레이터·웹훅·cert-controller를 원래 레플리카로 되돌린다.

### 4. 여기까지를 오퍼레이터에게 위임하기

3번까지가 "손으로 하는" 정공법이다. 그런데 `mariadb-operator`는 이 과정을 상당 부분 선언적으로 대신 해준다. 백업은 `PhysicalBackup` 리소스로 만든다. 스토리지는 VolumeSnapshot 또는 PVC 중 하나를 고른다.

```yaml
# PhysicalBackup: 물리 백업을 PVC에 적재한다. (VolumeSnapshot도 선택 가능)
apiVersion: k8s.mariadb.com/v1alpha1
kind: PhysicalBackup
metadata:
  name: mariadb-physical-backup
  namespace: app-db
spec:
  mariaDbRef:
    name: app-mariadb
  # compression: bzip2
  storage:
    persistentVolumeClaim:
      resources:
        requests:
          storage: 200Gi
      accessModes:
        - ReadWriteOnce
```

복원은 `MariaDB` CR에 `bootstrapFrom`을 얹는 방식이다. 여기에 `targetRecoveryTime`을 주면, 오퍼레이터가 백업 중 그 시점 이하의 가장 가까운 백업을 골라 <b>특정 시점 복구(PITR, Point-In-Time Recovery)</b>를 수행한다.

```yaml
# MariaDB CR에 추가: 이 백업을 지정 시점으로 복원하며 클러스터를 새로 세운다.
spec:
  bootstrapFrom:
    backupRef:
      name: mariadb-physical-backup
      kind: PhysicalBackup
    targetRecoveryTime: 2025-09-16T00:00:00Z
    # 스테이징 공간이 부족해 복원이 실패하면 아래로 임시 PVC를 지정
    # stagingStorage:
    #   persistentVolumeClaim:
    #     resources:
    #       requests:
    #         storage: 1Gi
    #     accessModes:
    #       - ReadWriteOnce
```

이걸 적용하면 오퍼레이터가 노드 수만큼 `...-physicalbackup-init` Job을 띄운다. 각 Job은 두 컨테이너로 3번의 수작업을 그대로 재현한다.

- init 컨테이너(오퍼레이터 이미지): `backup restore --path /backup --target-time 2025-09-16T00:00:00Z --backup-content-type Physical ...` 로 지정 시점에 맞는 백업 파일을 골라준다.
- 메인 컨테이너(mariadb 이미지): 그 파일을 `mbstream -x`로 풀고 → `mariadb-backup --prepare` → `mariadb-backup --copy-back --force-non-empty-directories` 로 각 노드 datadir을 채운다.

즉 오퍼레이터가 내부에서 하는 일도 `prepare` → `copy-back`이다. 추상화 뒤에서 도는 게 mariabackup 그 자체라, 손으로 하든 위임하든 막히는 지점은 같다.

> [!INFO]
> `bootstrapFrom`으로 복원한 뒤에는, 초기 부트스트랩을 마친 `MariaDB` 리소스(및 필요 시 남은 init 관련 StatefulSet/Job)를 정리하는 뒷마무리가 붙는다. 자동화가 편하긴 해도, 스테이징 PVC 용량 부족이나 이미지 pull 실패로 Job이 멈추는 경우가 있어서 나는 여전히 3번의 수동 흐름을 머리에 넣어둔다.

## 4. 확인

복원이 끝나면 Galera가 한 클러스터로 합의했는지부터 본다. 살아있는 노드에서 wsrep 상태를 조회한다.

```bash
# 클러스터 크기와 상태 확인. size=3, status=Primary, ready=ON 이면 정상
kubectl -n app-db exec app-mariadb-0 -c mariadb -- \
  mariadb --defaults-extra-file=/var/lib/mysql/.my-healthcheck.cnf -N \
  -e "SHOW STATUS WHERE Variable_name IN \
      ('wsrep_cluster_status','wsrep_cluster_size','wsrep_local_state_comment','wsrep_ready')"
```

그리고 오퍼레이터 관점의 상태도 함께 본다.

```bash
# Ready / GaleraReady 가 모두 True 여야 복구 완료
kubectl -n app-db get mariadb app-mariadb \
  -o jsonpath='Ready={.status.conditions[?(@.type=="Ready")].status} GaleraReady={.status.conditions[?(@.type=="GaleraReady")].status}{"\n"}'
```

`wsrep_cluster_size=3`, `wsrep_cluster_status=Primary`, `wsrep_local_state_comment=Synced`, 그리고 `Ready=True`·`GaleraReady=True`면 끝이다. 마지막으로 복원한 시점의 데이터가 실제로 들어있는지 애플리케이션 테이블 몇 개를 눈으로 확인하면 마음이 놓인다. (백업이 최신이 아닐 수 있다는 걸 늘 의심하는 편이 낫다.)

## 참고

- [MariaDB Operator — Physical backup](https://github.com/mariadb-operator/mariadb-operator/blob/main/docs/physical_backup.md)
- [MariaDB Operator — Galera](https://github.com/mariadb-operator/mariadb-operator/blob/main/docs/galera.md)
- [Mariabackup Overview](https://mariadb.com/kb/en/mariabackup-overview/)
- [Full Backup and Restore with Mariabackup](https://mariadb.com/kb/en/full-backup-and-restore-with-mariabackup/)
- [Galera Cluster — Crash Recovery](https://galeracluster.com/library/documentation/crash-recovery.html)
- [[오퍼레이터 DB 백업 통일 설계와 검증 CronJob|여러 오퍼레이터 DB의 백업을 하나로 통일한 상위 설계]]
- [[MariaDB Galera 한 노드가 깨졌을 때 무손실로 되살리기]]
