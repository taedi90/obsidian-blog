---
title: etcd 백업 설정
date: 2025-04-12
draft: false
tags:
  - kubernetes
  - etcd
  - backup
  - cronjob
  - cluster-management
  - disaster-recovery
  - automation
banner: 
cssclasses: 
description: Kubernetes 클러스터의 etcd 데이터를 자동으로 백업하는 CronJob 설정과 구성 방법
permalink: 
aliases:
completed: 
type:
  - note
---

## 1. 개요

Kubernetes 클러스터에서 <b>etcd</b>는 모든 클러스터 상태 정보를 저장하는 핵심 데이터베이스다. etcd 데이터가 날아가면 클러스터 전체를 재구성해야 하는 치명적인 상황이 온다.

예전에 클러스터를 구성하면서 etcd를 백업하지 않은 채 노드 join을 하다가 etcd 클러스터 장애를 낸 적이 있다. 결국 클러스터 전체를 다시 세워야 했는데, 운영 서버가 아니었으니 망정이지 정말 땀나는 경험이었다. 그 뒤로 백업은 습관이 됐다.

> [!IMPORTANT]
> etcd 백업은 클러스터 운영에서 필수다. 정기 백업 없이는 장애 시 복구가 불가능하다.

## 2. 백업 전략

이번 설정에서 쓴 백업 전략은 다음과 같다.

- 백업 주기: 매일 오후 5시 (Asia/Seoul 기준)
- 보관 정책: 로컬과 영구 저장소에 각각 5일간 보관
- 이중화: 로컬 스토리지와 PVC를 활용한 이중 백업
- 자동 정리: 오래된 백업 파일 자동 삭제

## 3. CronJob 구성

### 3-1. 기본 설정

CronJob은 매일 정해진 시간에 etcd 스냅샷을 생성하고 백업 파일을 관리한다.

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: etcd-backup-cron-job
  namespace: kube-system
spec:
  schedule: "0 17 * * *"  # 매일 오후 5시
  timeZone: "Asia/Seoul"
  concurrencyPolicy: Allow
  failedJobsHistoryLimit: 1
  successfulJobsHistoryLimit: 3
```

### 3-2. Pod 스케줄링

백업 작업은 반드시 control-plane 노드에서 실행되어야 한다. etcd 서버에 직접 접근할 수 있는 노드에서만 백업이 가능하기 때문이다.

```yaml
spec:
  template:
    spec:
      nodeSelector:
        node-role.kubernetes.io/control-plane: ""
      tolerations:
      - effect: NoSchedule
        key: node-role.kubernetes.io/control-plane
        operator: Exists
      affinity:
        nodeAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
          - preference:
              matchExpressions:
              - key: kubernetes.io/hostname
                operator: In
                values:
                - kdev-master-a-04  # 특정 마스터 노드 선호
            weight: 100
```

### 3-3. etcd 백업 수행

InitContainer에서 실제 etcd 스냅샷 생성 작업을 수행한다. `etcdctl snapshot` 명령어를 사용하여 현재 etcd 상태를 백업 파일로 저장한다.

```yaml
initContainers:
- name: etcd-backup
  image: bitnami/etcd:latest
  command:
  - /bin/sh
  - -c
  - |
    DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    BACKUP_DIR="/backup/host"
    SNAPSHOT_FILE="etcd-snapshot-${DATE}.db"
    
    etcdctl \
      --endpoints=https://127.0.0.1:2379 \
      --cacert=/etc/kubernetes/pki/etcd/ca.crt \
      --cert=/etc/kubernetes/pki/etcd/server.crt \
      --key=/etc/kubernetes/pki/etcd/server.key \
      snapshot save "${BACKUP_DIR}/${SNAPSHOT_FILE}"
```

> [!NOTE]
> etcd 백업 시에는 etcd 서버의 TLS 인증서가 필요하다. Kubernetes에서는 기본적으로 `/etc/kubernetes/pki/etcd/` 경로에 필요한 인증서들이 위치한다.

### 3-4. 백업 파일 관리

메인 컨테이너에서는 백업 파일을 영구 저장소로 복사하고, 오래된 백업 파일들을 정리한다.

```yaml
containers:
- name: backup-purge
  image: busybox:latest
  command:
  - /bin/sh
  - -c
  - |
    # 로컬 백업을 영구 저장소로 복사
    cp -u /backup/host/*.db /backup/persist/
    
    # 5일 이상 된 백업 파일 삭제
    find /backup/host -type f -mtime +5 -name '*.db' -exec rm -- '{}' \;
    find /backup/persist -type f -mtime +5 -name '*.db' -exec rm -- '{}' \;
```

## 4. 볼륨 구성

백업 파일을 저장하기 위해 두 가지 볼륨을 사용한다:

- `etcd-backup`: 노드의 로컬 스토리지 (`/data/etcd-backup`)
- `second-backup`: PVC를 통한 영구 저장소
- `etcd-certs`: etcd TLS 인증서 디렉토리

```yaml
volumes:
- name: etcd-backup
  hostPath:
    path: /data/etcd-backup
- name: etcd-certs
  hostPath:
    path: /etc/kubernetes/pki/etcd
    type: Directory
- name: second-backup
  persistentVolumeClaim:
    claimName: etcd-backup-pvc
```

## 5. 전체 설정

<details>
<summary>완전한 CronJob YAML 설정</summary>

```yaml
apiVersion: v1
items:
- apiVersion: batch/v1
  kind: CronJob
  metadata:
    name: etcd-backup-cron-job
    namespace: kube-system
  spec:
    concurrencyPolicy: Allow
    failedJobsHistoryLimit: 1
    jobTemplate:
      metadata:
        creationTimestamp: null
      spec:
        template:
          metadata:
            creationTimestamp: null
          spec:
            affinity:
              nodeAffinity:
                preferredDuringSchedulingIgnoredDuringExecution:
                - preference:
                    matchExpressions:
                    - key: kubernetes.io/hostname
                      operator: In
                      values:
                      - kdev-master-a-04
                  weight: 100
            containers:
            - command:
              - /bin/sh
              - -c
              - |
                cp -u /backup/host/*.db /backup/persist/
                find /backup/host -type f -mtime +5 -name '*.db' -exec rm -- '{}' \;
                find /backup/persist -type f -mtime +5 -name '*.db' -exec rm -- '{}' \;
              image: busybox:latest
              imagePullPolicy: IfNotPresent
              name: backup-purge
              resources: {}
              terminationMessagePath: /dev/termination-log
              terminationMessagePolicy: File
              volumeMounts:
              - mountPath: /backup/host
                name: etcd-backup
              - mountPath: /backup/persist
                name: second-backup
            dnsPolicy: ClusterFirst
            hostNetwork: true
            initContainers:
            - command:
              - /bin/sh
              - -c
              - |
                DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
                BACKUP_DIR="/backup/host"
                SNAPSHOT_FILE="etcd-snapshot-${DATE}.db"
                ARCHIVE_FILE="${SNAPSHOT_FILE}.gz"

                etcdctl \
                  --endpoints=https://127.0.0.1:2379 \
                  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
                  --cert=/etc/kubernetes/pki/etcd/server.crt \
                  --key=/etc/kubernetes/pki/etcd/server.key \
                  snapshot save "${BACKUP_DIR}/${SNAPSHOT_FILE}"
              image: bitnami/etcd:latest
              imagePullPolicy: IfNotPresent
              name: etcd-backup
              resources: {}
              securityContext:
                allowPrivilegeEscalation: false
                runAsGroup: 0
                runAsUser: 0
              terminationMessagePath: /dev/termination-log
              terminationMessagePolicy: File
              volumeMounts:
              - mountPath: /backup/host
                name: etcd-backup
              - mountPath: /etc/kubernetes/pki/etcd
                name: etcd-certs
                readOnly: true
            nodeSelector:
              node-role.kubernetes.io/control-plane: ""
            restartPolicy: OnFailure
            schedulerName: default-scheduler
            securityContext: {}
            terminationGracePeriodSeconds: 30
            tolerations:
            - effect: NoSchedule
              key: node-role.kubernetes.io/control-plane
              operator: Exists
            volumes:
            - hostPath:
                path: /data/etcd-backup
                type: ""
              name: etcd-backup
            - hostPath:
                path: /etc/kubernetes/pki/etcd
                type: Directory
              name: etcd-certs
            - name: second-backup
              persistentVolumeClaim:
                claimName: etcd-backup-pvc
    schedule: 0 17 * * *
    successfulJobsHistoryLimit: 3
    suspend: false
    timeZone: Asia/Seoul
```

</details>

## 6. 백업 확인 및 복구

백업이 정상적으로 수행되는지 정기적으로 확인해야 한다:

```bash
# 백업 파일 확인
ls -la /data/etcd-backup/

# 백업 파일 무결성 검증
etcdctl snapshot status /data/etcd-backup/etcd-snapshot-<timestamp>.db

# 복구 테스트 (테스트 환경에서만)
etcdctl snapshot restore /data/etcd-backup/etcd-snapshot-<timestamp>.db \
  --data-dir=/var/lib/etcd-restore
```

> [!INFO]
> 백업은 생성하는 것도 중요하지만, 실제로 복구가 가능한지 주기적으로 테스트하는 것이 더욱 중요하다. 테스트 환경에서 정기적으로 복구 테스트를 수행하는 것을 권장한다.