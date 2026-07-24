---
title: 오퍼레이터 관리 DB 백업 통일 설계와 검증 CronJob
date: 2026-07-21
draft: false
tags:
  - kubernetes
  - postgresql
  - mariadb
  - galera
  - backup
  - cronjob
  - automation
banner: 
cssclasses: 
description: 백업 CR이 전무하던 오퍼레이터 관리 DB 두 종에, 물리 PITR을 백본으로 논리 덤프를 보험으로 얹어 계층을 나누고, 복구 가능성까지 검증하는 백업 자동화를 설계한 기록.
permalink: 
aliases: 
completed: true
type:
  - automation
---

## 🚀 요약

> [!SUMMARY]
> 오퍼레이터가 관리하는 PostgreSQL(CNPG)·MariaDB(Galera)에 백업 CR이 하나도 없던 상태를 손봤다. 복구 요구는 <b>물리 PITR</b>(증분 로그 + 주기적 물리 base)에 전부 맡겨 백본으로 삼고, 월1회 <b>논리 덤프</b>는 복구용이 아니라 물리 백업 자체가 실패할 때를 위한 독립 실패 도메인, 즉 보험으로만 낮게 운용한다. 두 엔진을 같은 골격으로 통일했고, Galera 쪽은 백업(initContainer)과 `--prepare` 무결성 검증(메인 컨테이너)을 나눈 2단계 CronJob으로 "복원해봤더니 되더라"까지 확인되는 일일 백업을 만들었다.

## 1. 현황: 백업 CR 부재

오퍼레이터로 DB를 굴리면 편하다. `Cluster`나 `MariaDB` CR 하나 던지면 StatefulSet, 서비스, HA, failover까지 알아서 돈다. 그런데 그 편함에 취해 있다가 백업 현황을 들여다봤더니, 정작 <b>백업 CR이 하나도 없었다.</b>

- PostgreSQL: CNPG 오퍼레이터가 3-HA 클러스터를 관리 중인데 `ScheduledBackup`도 `barmanObjectStore`도 설정 안 됨.
- MariaDB: mariadb-operator가 Galera 3노드를 관리 중인데 `PhysicalBackup`/`Backup` CR 전무.

차트에 백업용 템플릿이 들어 있긴 했다. CNPG 차트에는 barman 관련 기계가 다 있었지만 `backups.enabled` 게이트가 전 환경에서 꺼져 있었고, MariaDB 쪽은 애초에 백업 리소스를 넣은 적이 없었다. <b>기능은 있는데 아무도 켜지 않은</b> 상태였다. 오퍼레이터가 다 해줄 것 같지만, 백업만큼은 내가 명시적으로 켜지 않으면 아무 일도 일어나지 않는다.

이 글은 그 백업을 실제로 되살린 복구 무용담이 아니라, <b>백업 체계를 어떻게 설계하고 자동화했는가</b>에 대한 기록이다. (Galera를 특정 시점으로 되감는 복구 쪽 이야기는 따로 정리해뒀다 → [[MariaDB Operator(Galera) 물리 백업과 PITR 실전]].)

## 2. 계층 분리

가장 먼저 정리한 건 "무엇을 얼마나 자주, 어디에 두느냐"였다. 백업을 하나의 잡(job)으로 뭉뚱그리면 늘 어정쩡해진다. 자주 뜨자니 무겁고, 드물게 뜨자니 유실 창(RPO)이 커진다.

그래서 두 계층으로 쪼갰다. <b>증분·무중단·PITR은 물리 로그 계층에서만 얻을 수 있고, "엔진과 무관한 통짜 스냅샷"은 논리 덤프에서만 얻을 수 있다.</b> 이 둘을 한 방식으로 동시에 만족시킬 수는 없으니, 나눠서 각자 잘하는 걸 시켰다.

- <b>물리 PITR = 백본.</b> RPO/RTO 요구를 전부 여기서 담당한다. 연속 로그 아카이빙(WAL/binlog)으로 유실 창을 수 분까지 줄이고, 주기적 물리 base는 복원 속도용 기준점 역할을 한다. 둘이 합쳐 하나의 "PITR 창"을 이룬다.
- <b>논리 = 보험.</b> 복구 1순위가 아니다. (a) 물리 백업 자체가 깨졌을 때를 대비한 독립 실패 도메인, (b) 버전·엔진이 달라도 옮겨 붓는 포터빌리티와 부분 복원, (c) 장기 아카이브. 그래서 월1회, prod 위주로 <b>낮게</b> 운용한다.

저장 위치도 계층에 따라 갈랐다. 물리·증분은 S3(사내 오브젝트 스토리지)로, 논리 덤프는 그와 분리된 NFS PVC로. 백본이 죽는 상황과 보험이 죽는 상황이 서로 물리지 않게 실패 도메인을 떨어뜨리는 게 목적이다.

| 계층 | PostgreSQL(CNPG) | MariaDB(operator) | 저장 타깃 | 성격 |
|---|---|---|---|---|
| 증분(연속) | WAL 아카이빙 | binlog 아카이브(PITR) | S3 | 백본 |
| 물리 base(주1회) | ScheduledBackup(`pg_basebackup`) | PhysicalBackup(`mariabackup`, 무중단) | S3 | 백본 |
| 전체(논리, 월1회) | `pg_dump` CronJob | Backup CR(`mysqldump --single-transaction`) | NFS PVC | 보험 |

보관 정책은 환경별로 차등을 뒀다. 물리 PITR 창은 stg 14일 / prod 30일(이 기간 안이면 임의 시점으로 복원), 논리 월간본은 6개월. 토글은 증분(물리)은 stg·prod 모두 켜고, 논리는 prod만 켜되 stg는 복원 리허설 때만 임시로 켠다.

## 3. 물리 백업과 로컬 PV

설계에서 한 가지 못을 박아둔 게 있다. <b>물리 백업에 CSI 볼륨 스냅샷을 쓰지 않는다.</b>

처음엔 나도 "물리 백업 = 볼륨 스냅샷"이라고 막연히 생각했다. 그런데 이 DB들의 데이터는 로컬 정적(local-static) PV 위에 있었다. CSI 스냅샷은 스토리지 드라이버가 스냅샷을 지원해야 뜨는데, 로컬 PV는 그 대상이 아니다. "그럼 물리 백업이 안 되나?" 싶었는데, 안 막힌다.

CNPG의 `pg_basebackup`+WAL도, mariadb-operator의 `mariabackup`도 스냅샷이 아니라 <b>스트리밍 파일 복사</b>다. 실행 중인 DB의 데이터 파일을 읽어 S3로 흘려보내는 방식이라, 데이터가 어떤 종류의 PV 위에 있든 상관이 없다. 스토리지 계층에 의존하는 건 스냅샷이고, 이 도구들은 애플리케이션 계층에서 파일을 직접 뜬다. 그래서 mariadb-operator의 `PhysicalBackup`에서도 `volumeSnapshot` 옵션은 쓰지 않고 `storage.s3`(또는 PVC)만 쓴다.

한 가지 더. HA/Galera 3노드는 <b>같은 데이터의 복제본</b>이므로 백업은 노드 수만큼이 아니라 <b>클러스터당 1벌</b>이면 된다. 오퍼레이터/CNPG가 한 인스턴스(가능하면 standby)에서 떠서 primary 부하를 피한다. CNPG라면 `backup.target: prefer-standby`로 넘긴다.

## 4. 두 엔진 공통 골격

PostgreSQL과 MariaDB는 백업 도구도 CRD도 완전히 다르다. 그래도 운영자가 머릿속에 넣어둘 골격은 하나로 통일하는 게 낫다고 봤다. 나중에 "이 DB는 어떻게 백업하더라"를 매번 새로 떠올리고 싶지 않았다.

그래서 계층·스케줄·보관·네이밍을 두 엔진에서 대칭으로 맞췄다. 증분은 연속, 물리 base는 주1회 새벽 2시(KST), 논리는 월1회. 저장 타깃도 계층별로 동일(물리/증분 → S3, 논리 → NFS PVC). CNPG는 이미 있던 `backups.enabled`를 켜고 values만 채우면 됐고, MariaDB는 오퍼레이터의 `PhysicalBackup`·`PointInTimeRecovery`·`Backup` CR을 새로 넣었다.

MariaDB 증분(PITR)은 `PointInTimeRecovery` CR이 물리 base(`physicalBackupRef`)를 기준점으로 잡고 binlog를 연속 아카이브하는 구조다. 대략 이런 모양이다.

```yaml
# 물리 base(주1회, mariabackup 스트리밍)를 S3에 적재.
# 자격증명은 평문이 아니라 Secret 참조(secretKeyRef).
apiVersion: k8s.mariadb.com/v1alpha1
kind: PhysicalBackup
metadata:
  name: app-mariadb-physicalbackup
spec:
  mariaDbRef:
    name: app-mariadb
  schedule:
    cron: "0 2 * * 0"      # 주1회 일요일 02:00
  compression: gzip
  maxRetention: 336h        # 14d(stg 기준)
  storage:
    s3:
      bucket: db-backups
      prefix: app-mariadb/physical
      endpoint: <s3-endpoint>:8333   # 내부 S3 호환 스토리지 (예: SeaweedFS)
      tls: { enabled: false }
      accessKeyIdSecretKeyRef:     { name: s3-creds, key: accessKey }
      secretAccessKeySecretKeyRef: { name: s3-creds, key: secretKey }
---
# 위 base를 기준으로 binlog를 연속 아카이브 = 증분/PITR.
apiVersion: k8s.mariadb.com/v1alpha1
kind: PointInTimeRecovery
metadata:
  name: app-mariadb-pitr
spec:
  physicalBackupRef: { name: app-mariadb-physicalbackup }
  compression: gzip
  archiveTimeout: 1h
  storage:
    s3:
      bucket: db-backups
      prefix: app-mariadb/binlog
      endpoint: <s3-endpoint>:8333   # 내부 S3 호환 스토리지 (예: SeaweedFS)
      tls: { enabled: false }
      accessKeyIdSecretKeyRef:     { name: s3-creds, key: accessKey }
      secretAccessKeySecretKeyRef: { name: s3-creds, key: secretKey }
```

> [!NOTE]
> S3 게이트웨이가 SSE(서버측 암호화)를 지원하지 않는 경우가 있다. CNPG barman은 기본이 AES256이라 그대로 두면 백업이 조용히 실패한다. `backups.wal.encryption`·`backups.data.encryption`를 빈 값(`""`)으로 명시해야 했다. "기본값이 안전한 쪽"이 항상 우리 환경에 맞는 건 아니라는, 매번 다시 배우는 교훈.

## 5. 검증 포함 CronJob

여기가 이 작업에서 제일 공들인 부분이다. 백업이 파일로 남았다고 백업이 된 게 아니다. <b>그 파일이 실제로 복원 가능한 상태인지</b>까지 확인해야 백업이다. 물리 백업(`mariabackup`)은 실행 중인 DB의 파일을 잠그지 않고 복사하기 때문에, 복사된 파일들은 서로 미묘하게 다른 시점의 조각이다. `--prepare`로 redo/undo 로그를 적용해 한 시점으로 정합화하기 전까지는 그냥 깨진 데이터에 가깝다.

그래서 Galera 일일 백업 CronJob을 <b>2단계</b>로 나눴다. (이 CronJob은 4절의 오퍼레이터 CR이 만들어주는 게 아니라, `kubectl exec`로 Galera에 직접 붙어 도는 별도 잡이다. 오퍼레이터 백업으로 옮겨가더라도 이 `--prepare` 검증 방식만큼은 그대로 가져갈 생각이다.) initContainer가 백업을 뜨고, 메인 컨테이너가 그 백업을 실제로 풀어서 `--prepare`까지 돌려 "복원돼?"를 매일 자동으로 물어본다. 검증이 실패하면 그날 백업은 신뢰할 수 없다는 뜻이고, Job이 실패로 남아 눈에 띈다.

### 5-1. 백업 (initContainer)

initContainer는 `kubectl exec`로 Galera 파드에 들어가 `mariabackup`을 xbstream 스트림으로 떠서 gzip으로 PVC에 저장한다. 끝에 <b>빈 파일 감지</b>를 붙였다 — 파일이 만들어졌는데 크기가 0이면 백업이 실패한 것이므로 `exit 1`로 잡의 실패를 명확히 만든다. (조용히 성공한 척 넘어가는 게 제일 무섭다.) 오래된 백업은 `find`로 정리해 30일 보관을 유지한다.

```bash
set -e  # 에러 발생 시 즉시 중단
TODAY=$(date "+%Y-%m-%d")
BACKUP_FILE="/backup/${TODAY}.gz"

# Galera 파드 안에서 물리 백업을 xbstream 스트림으로 떠 gzip으로 PVC에 저장.
# 비밀번호는 아래 env에서 secretKeyRef로 주입된 값을 참조한다(평문 아님).
kubectl exec ${TARGET_POD} -n app-db -- bash -c \
  "mariadb-backup --backup --no-lock --galera-info --stream=xbstream \
   --user=root --password=${ROOT_PASSWORD} | gzip" > "${BACKUP_FILE}"

# 30일(43200분) 지난 백업 정리 — 보관 정책
find /backup -maxdepth 1 -cmin +43200 -regextype posix-extended \
  -regex '.*[0-9]{4}-[0-9]{2}-[0-9]{2}(\.gz)?' -exec rm -rf {} \;

# 빈 파일 감지: 크기가 0이면 실패로 처리
if [ -s "${BACKUP_FILE}" ]; then
  echo "Backup Success: ${BACKUP_FILE}"
else
  echo "Error: Backup file is empty!"; exit 1
fi
```

비밀번호는 매니페스트에 박지 않고 Galera가 만든 시크릿을 `secretKeyRef`로 env에 주입한다.

```yaml
env:
- name: ROOT_PASSWORD
  valueFrom:
    secretKeyRef:
      name: app-mariadb-secret   # Galera가 생성한 root 시크릿
      key: root-password
```

> [!IMPORTANT]
> 매니페스트에 평문 비밀번호는 없지만, `--password=${ROOT_PASSWORD}`가 `kubectl exec`로 넘어가면 <b>대상 파드의 프로세스 목록(`ps`)에 그 값이 노출된다.</b> 완전히 깔끔하게 하려면 `~/.my.cnf`의 `[mariabackup]` 섹션이나 `MYSQL_PWD`로 넘기는 편이 낫다. 이 글의 예시에서는 시크릿 참조까지만 두고 실제 값은 전부 `<REDACTED>` 처리했다.

### 5-2. 무결성 검증 (메인 컨테이너)

메인 컨테이너는 방금 뜬 gzip을 `mbstream`으로 풀고 `mariadb-backup --prepare`를 돌린다. `--prepare`가 성공한다는 건 <b>이 백업으로 datadir을 세울 수 있다</b>는 뜻이다. 실제 복원(`--copy-back`)까지는 안 가지만, 복원 가능성 자체는 매일 확인된다.

```bash
TODAY=$(date "+%Y-%m-%d")
RESTORE_DIR="/backup/temp_restore"
rm -rf ${RESTORE_DIR}; mkdir -p ${RESTORE_DIR}

# 1) 스트림 해제 (gzip -> xbstream -> 파일)
zcat /backup/${TODAY}.gz | mbstream -x -C ${RESTORE_DIR}

# 2) redo/undo 적용해 한 시점으로 정합화 = 무결성 검증
mariadb-backup --prepare --target-dir=${RESTORE_DIR}

echo "Verification Completed OK!"
```

검증 컨테이너 이미지는 `mariadb-backup`이 들어 있는 mariadb-galera 이미지를 그대로 쓴다(사내 사설 레지스트리 경유). 백업을 뜬 도구와 같은 버전으로 풀어봐야 검증이 의미가 있다.

```yaml
containers:
- name: verify-backup
  image: <사내-레지스트리>/mariadb-galera:11.0.3-debian-11-r7
```

### 5-3. 스케줄·시간대·저장

CronJob은 매일 새벽 1시에 도는데, K8s CronJob의 `schedule`은 기본적으로 UTC라 그냥 두면 시간이 밀린다. `timeZone: "Asia/Seoul"`을 명시해 KST 기준으로 맞췄다.

```yaml
spec:
  schedule: "0 1 * * *"     # 매일 새벽 1시
  timeZone: "Asia/Seoul"    # KST 기준 (미지정 시 UTC)
```

백업 저장소는 여러 파드가 붙을 수 있게 NFS 계열 스토리지클래스의 `ReadWriteMany` PVC를 썼다.

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: mariadb-backup-pvc
  namespace: app-db
spec:
  storageClassName: nfs-client
  accessModes: [ ReadWriteMany ]
  resources: { requests: { storage: 8Gi } }
```

### 5-4. 최소권한 RBAC

이 CronJob이 하는 일은 딱 하나, "특정 파드에 들어가 백업 명령을 실행"이다. 그래서 클러스터 관리 권한 같은 걸 줄 이유가 없다. 전용 ServiceAccount에 `pods`/`pods/exec`만 허용하는 Role을 붙였다.

```yaml
apiVersion: v1
kind: ServiceAccount
metadata: { name: backup-sa, namespace: app-db }
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata: { name: pod-exec-role, namespace: app-db }
rules:
- apiGroups: [""]
  resources: ["pods", "pods/exec"]   # 딱 exec에 필요한 만큼만
  verbs: ["get", "list", "create"]
```

`RoleBinding`으로 이 SA에만 묶고, CronJob의 `serviceAccountName: backup-sa`로 사용한다. 백업 잡이 탈취되더라도 할 수 있는 게 "파드 exec"로 한정된다.

## 6. 보험 계층: 월1회 논리 덤프

백본이 물리 PITR이라면, 논리 덤프는 그 백본이 통째로 실패했을 때를 위한 보험이다. 앞서 말했듯 복구 1순위가 아니라서 월1회로 낮게 돌린다.

MariaDB는 오퍼레이터의 `Backup` CR(`mysqldump --single-transaction`, 무중단)을 월1회 스케줄로 NFS PVC에 적재한다. PostgreSQL은 CNPG에 논리 백업 네이티브가 없어서 `pg_dump` CronJob을 별도로 만들었다. 여기서도 원칙은 같다 — 산출물이 비어 있지 않은지 `test -s`로 확인하고, `find -mtime`으로 6개월 넘은 월간본을 정리한다.

```bash
set -euo pipefail
OUT=/backup/app-postgres-$(date +%Y-%m-%d).sql.gz

# rw 서비스로 접속해 논리 덤프. 자격증명은 앱 시크릿 참조.
PGPASSWORD="$PGPASS" pg_dump -h app-postgres-rw -U "$PGUSER" -d "$PGDB" | gzip > "$OUT"

test -s "$OUT"                                    # 빈 덤프 방지
find /backup -name '*.sql.gz' -mtime +180 -delete # 6개월 보관
```

논리 덤프는 물리 백업과 <b>다른 도구, 다른 코드 경로, 다른 저장소</b>를 탄다. 물리 백업 파이프라인 어딘가에 버그가 있어 조용히 깨져도, 최소한 월 단위 통짜 스냅샷은 남아 있다.

## 7. 남은 것

여기까지가 설계와 자동화의 뼈대다. 실제 복원 절차(CNPG `bootstrap.recovery` + targetTime, MariaDB `Restore`/`PointInTimeRecovery`)와 stg에서의 복원 리허설은 별도로 남겨둔다. 백업은 복원 리허설을 한 번이라도 통과하기 전까지는 "백업했다고 믿는 상태"일 뿐이다. Galera를 특정 시점으로 무손실 복구하는 실전 흐름은 아래 글에 정리해뒀다.

- [[MariaDB Operator(Galera) 물리 백업과 PITR 실전]] — 이 백업을 실제로 되돌리는 복구 편

오퍼레이터가 백업까지 "알아서 해줄 것 같지만", 무엇을 어느 계층에서 얻을지는 내가 직접 나눠야 했다.

## 🔗 참고

- [CloudNativePG — Backup](https://cloudnative-pg.io/documentation/current/backup/)
- [CloudNativePG — Recovery](https://cloudnative-pg.io/documentation/current/recovery/)
- [PostgreSQL — Continuous Archiving and PITR](https://www.postgresql.org/docs/current/continuous-archiving.html)
- [MariaDB Operator — Physical backup](https://github.com/mariadb-operator/mariadb-operator/blob/main/docs/physical_backup.md)
- [MariaDB Operator — Logical backup](https://github.com/mariadb-operator/mariadb-operator/blob/main/docs/logical_backup.md)
- [Mariabackup Overview](https://mariadb.com/kb/en/mariabackup-overview/)
- [Kubernetes — CronJob (timeZone)](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/)
- [[MariaDB Operator(Galera) 물리 백업과 PITR 실전|MariaDB 쪽 물리 백업·PITR의 실전 상세]]
