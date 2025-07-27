---
title: nfs-subdir-provisioner PVC 삭제시 실제 디렉토리는 그대로 남아있는 이슈
date: 2025-07-01
draft: false
tags:
  - kubernetes
  - nfs
  - pvc
  - persistent-volume
  - storage
  - provisioner
  - troubleshooting
  - pathpattern
banner: 
cssclasses: 
description: nfs-subdir-provisioner에서 reclaimPolicy Delete 설정에도 불구하고 PVC 삭제 시 NFS 디렉토리가 남아있는 문제 해결 과정
permalink: 
aliases: 
completed: 
type:
  - issue
---

## 🚀 요약

> [!SUMMARY]
> nfs-subdir-provisioner의 <b>pathPattern</b> 설정으로 인해 PVC 삭제 시 실제 NFS 디렉토리가 삭제되지 않는 버그가 4.0.18 버전에서 해결되었다. Docker 이미지가 공식 레지스트리에 없어 직접 빌드하여 문제를 해결했다.

## ⚙️ 환경
- Kubernetes 클러스터
- nfs-subdir-external-provisioner (4.0.17 이하 버전)
- pathPattern 설정이 포함된 StorageClass

## 💬 이슈

Kubernetes에서 <b>nfs-subdir-provisioner</b>를 사용하여 동적 볼륨 프로비저닝을 구성했다. StorageClass에서 `reclaimPolicy: Delete`로 설정했음에도 불구하고, PVC를 삭제할 때 실제 NFS 서버의 디렉토리는 그대로 남아있는 문제가 발생했다.

프로비저너의 로그를 확인해보니 <b>pathPattern</b>을 설정한 경로를 인식하지 못하고 삭제 작업에 실패하는 것으로 판단됐다. pathPattern은 NFS 서버에 생성되는 디렉토리 구조를 커스터마이징할 때 사용하는 설정인데, 이 설정이 있을 때 삭제 로직에서 올바른 경로를 찾지 못하는 버그가 있었다.

> [!INFO]
> pathPattern 설정 예시: `${.PVC.namespace}-${.PVC.name}-${.PVC.annotations.volume.beta.kubernetes.io/storage-class}`

## 🧗 해결

GitHub Issues를 통해 동일한 증상을 겪는 사용자들의 보고를 확인했다. 조사 결과, 이는 nfs-subdir-external-provisioner의 알려진 버그였으며 <b>4.0.18 버전</b>에서 수정되었다는 것을 확인했다.

하지만 문제는 공식 Docker Hub 레지스트리에 4.0.18 버전의 이미지가 업로드되지 않았다는 점이었다. 따라서 다음과 같은 방식으로 문제를 해결했다:

1. **소스 코드 클론 및 빌드**
```bash
git clone https://github.com/kubernetes-sigs/nfs-subdir-external-provisioner.git
cd nfs-subdir-external-provisioner
git checkout tags/nfs-subdir-external-provisioner-v4.0.18
```

2. **Docker 이미지 직접 빌드**
```bash
docker build -t nfs-subdir-external-provisioner:4.0.18 .
```

3. **프라이빗 레지스트리에 푸시**
```bash
docker tag nfs-subdir-external-provisioner:4.0.18 your-registry/nfs-subdir-external-provisioner:4.0.18
docker push your-registry/nfs-subdir-external-provisioner:4.0.18
```

4. **Deployment 이미지 업데이트**
```yaml
spec:
  template:
    spec:
      containers:
      - name: nfs-client-provisioner
        image: your-registry/nfs-subdir-external-provisioner:4.0.18
```

## ✅ 확인

업데이트 후 테스트를 진행했다. pathPattern이 설정된 StorageClass로 PVC를 생성하고 삭제하는 과정에서 다음과 같은 결과를 확인했다:

- PVC 삭제 시 프로비저너 로그에서 삭제 성공 메시지 확인
- NFS 서버에서 해당 디렉토리가 정상적으로 삭제됨
- `archived-` 접두사가 붙은 백업 디렉토리도 정상적으로 정리됨

> [!NOTE]
> nfs-subdir-provisioner는 기본적으로 삭제된 볼륨을 `archived-` 접두사를 붙여서 백업하는 방식으로 동작한다. 완전 삭제를 원한다면 `archiveOnDelete: "false"` 설정을 추가해야 한다.

## 🔗 참고
- [GitHub Issue #347: Delete with pathPattern doesn't work](https://github.com/kubernetes-sigs/nfs-subdir-external-provisioner/issues/347)
- [GitHub Issue #272: pathPattern causes PV deletion to fail](https://github.com/kubernetes-sigs/nfs-subdir-external-provisioner/issues/272)
- [nfs-subdir-external-provisioner GitHub Repository](https://github.com/kubernetes-sigs/nfs-subdir-external-provisioner)

  
  
