---
title: longhorn 볼륨 용량이 줄어들지 않는 이슈
date: 2025-06-23
draft: false
tags:
  - kubernetes
  - longhorn
  - storage
  - volume
  - pvc
  - troubleshooting
  - thin-provisioning
  - fstrim
  - clickhouse
banner: 
cssclasses: 
description: Longhorn에서 데이터 삭제 후에도 볼륨 용량이 줄어들지 않는 현상의 원인과 fstrim을 통한 해결 방법
permalink: 
aliases:
completed: 
type:
  - issue
---

## 🚀 요약

> [!SUMMARY]
> Longhorn은 <b>블록 레벨</b>에서 동작하기 때문에 파일 시스템 내 데이터 삭제를 인식하지 못한다. v1.4.0 이상에서는 <b>fstrim</b> 명령을 통해 사용하지 않는 블록을 회수할 수 있다.

## ⚙️ 환경
- Kubernetes: v1.32.6
- Longhorn: v1.8.1

## 💬 이슈

ClickHouse에서 관측가능성 데이터(observability data)를 대량으로 삭제했지만, Longhorn UI에서 확인한 PVC 용량은 전혀 줄어들지 않는 문제가 발생했다. 파일 시스템 관점에서는 분명히 데이터가 삭제되었지만, 스토리지 볼륨의 실제 사용량은 그대로 유지되는 상황이었다.

이런 현상은 처음 겪는 것이 아니었다. 몇 년 전에도 동일한 이슈를 경험하고 해결 방법을 찾아봤던 기억이 있지만, 시간이 지나면서 다시 까먹게 되었다.

## 🧗 해결

### 원인 분석

Longhorn이 볼륨 용량을 줄이지 않는 근본 이유는 다음과 같다.

1. 블록 레벨 동작: Longhorn은 파일 시스템 수준이 아니라 블록 수준에서 작동한다.
2. 정보 부족: 사용자가 파일 시스템에서 데이터를 지웠는지 여부를 블록 스토리지 계층에서는 알 수 없다.
3. Thin Provisioning: 동적으로 할당된 블록이 파일 삭제 후에도 자동으로 해제되지 않는다.

### 해결 방법 1: fstrim 사용 (권장)

Longhorn <b>v1.4.0</b> 이상부터는 볼륨 트리밍(Volume Trimming)을 지원한다. 이걸로 사용하지 않는 블록을 수동으로 회수할 수 있다.

1단계, Longhorn UI에서 트림 수행.
1. Longhorn UI (`http://<longhorn-frontend-service>`) 접속
2. Volume 메뉴에서 해당 볼륨 선택
3. 볼륨 상세 페이지에서 "Trim Filesystem" 버튼 클릭
4. 트림 작업 완료 대기

2단계, kubectl로 트림 수행.
```bash
# Longhorn 볼륨에 대한 트림 작업 요청
kubectl patch volume <volume-name> -n longhorn-system \
  --type='merge' \
  -p='{"spec":{"trimRequested":true}}'
```

3단계, Pod 내부에서 직접 fstrim 실행.
```bash
# 해당 볼륨을 사용하는 Pod에 접속
kubectl exec -it <pod-name> -- /bin/bash

# 마운트된 볼륨에 대해 fstrim 실행
fstrim -v <mount-point>
```

> [!IMPORTANT]
> fstrim은 I/O 집약적이라 서비스 영향을 고려해서 돌려야 한다. 가능하면 트래픽이 적은 시간대에 실행하는 것이 좋다.

### 해결 방법 2: 볼륨 교체 (대안)

데이터 크기가 크지 않은 경우, 새로운 볼륨으로 데이터를 이전하는 방법도 고려할 수 있다.

```bash
# 1. 새로운 PVC 생성
kubectl apply -f new-pvc.yaml

# 2. 데이터 복사 (rsync 등 사용)
kubectl exec -it <source-pod> -- rsync -av <source-path>/ <dest-path>/

# 3. 기존 PVC 삭제 및 새 PVC로 교체
kubectl delete pvc <old-pvc>
kubectl patch deployment <deployment-name> \
  -p '{"spec":{"template":{"spec":{"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"<new-pvc>"}}]}}}}'
```

## ✅ 확인

트림 작업 후 다음과 같은 방법으로 결과를 확인할 수 있다.

### Longhorn UI에서 확인
- Volume 페이지에서 "Actual Size" 값 변화 확인
- 트림 작업 전후의 용량 비교

### kubectl을 통한 확인
```bash
# 볼륨 상태 확인
kubectl get volume <volume-name> -n longhorn-system -o yaml

# PVC 사용량 확인
kubectl get pvc <pvc-name> -o yaml | grep -A 5 status
```

### 파일 시스템 레벨에서 확인
```bash
# Pod 내부에서 디스크 사용량 확인
kubectl exec -it <pod-name> -- df -h <mount-point>

# fstrim 상태 확인
kubectl exec -it <pod-name> -- fstrim -v <mount-point>
```

> [!NOTE]
> 트림 작업의 효과는 즉시 나타나지 않을 수 있다. Longhorn의 백그라운드 프로세스가 실제 용량을 업데이트하는 데 시간이 소요될 수 있으므로, 몇 분 후에 다시 확인해보는 것이 좋다.

## 🔗 참고
- [SUSE Knowledge Base: Longhorn 볼륨 크기 관리](https://www.suse.com/ko-kr/support/kb/doc/?id=000020027)
- [Longhorn Docs: Volume Size Management](https://longhorn.io/docs/archives/1.0.1/volumes-and-nodes/volume-size/)
- [Longhorn Docs: Thin Provisioning 개념](https://longhorn.io/docs/archives/1.0.1/concepts/#21-thin-provisioning-and-volume-size)
- [Longhorn Docs: Trim Filesystem 기능](https://longhorn.io/docs/1.9.0/nodes-and-volumes/volumes/trim-filesystem/)