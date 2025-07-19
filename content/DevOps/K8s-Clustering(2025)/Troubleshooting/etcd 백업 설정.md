---
title: etcd 백업 설정
date: 2025-07-16
draft: true
tags:
  - etcd
  - backup
  - kubernetes
banner: 
cssclasses: 
description: 
permalink: 
aliases: 
completed: 
type:
  - note
---
예전에 쿠버네티스 클러스터를 구성했을 떄 

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