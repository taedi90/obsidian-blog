---
title: Kubernetes 클러스터 버전 업그레이드
date: 2025-07-16
draft: false
tags:
  - kubernetes
  - upgrade
  - cluster
  - kubespray
banner: 
cssclasses: 
description: Kubespray의 upgrade_cluster.yml 래퍼를 만들고, 인벤토리 변수 하나로 쿠버네티스 마이너 버전을 올리는 무중단 업그레이드 절차.
permalink: 
aliases: 
completed: 
type:
  - note
---

쿠버네티스 버전 업그레이드는 한 번에 두 마이너 버전까지만 지원한다. 1.30에서 1.32로 가려면 1.31을 거쳐야 한다. 이런 제약이 있다는 걸 미리 알면 좋은데, 보통 업그레이드를 처음 할 때 모르고 접근하게 된다.

## 1. 래퍼 플레이북

Kubespray가 `upgrade_cluster.yml` 플레이북을 제공한다. 우리가 만든 래퍼는 그걸 그대로 import한다. 사실 이 글은 래퍼가 거의 하는 일이 없다. 핵심은 인벤토리의 `kube_version` 변수를 바꾸는 것뿐이다.

```yaml
---
- name: Upgrade the Kubernetes cluster
  import_playbook: ../../modules/kubespray/playbooks/upgrade_cluster.yml
```

Kubespray의 업그레이드 플레이북이 알아서 노드를 하나씩 drain 하고, 컴포넌트를 올리고, uncordon 한다.

## 2. 절차

업그레이드는 결국 변수 하나를 바꾸고 플레이북을 실행하는 거지만, 전후 확인이 중요하다.

### 1. 현재 버전 확인

```bash
kubectl get nodes
# 모든 노드의 VERSION이 현재 버전인지 확인
```

### 2. kube_version 변경

인벤토리 `group_vars/all.yml`에서 버전을 올린다.

```yaml
# 예: 1.31.x → 1.32.x
kube_version: 1.32.6
```

> [!IMPORTANT]
> Kubespray 서브모듈 버전과 kube_version이 호환되는지 먼저 확인해야 한다. Kubespray `release-2.28`은 쿠버네티스 1.32를 지원하지만, 더 낮은 릴리스는 아닐 수 있다. 서브모듈을 먼저 올리고 테스트해야 한다.

### 3. 업그레이드 실행

```bash
ansible-playbook -i inventory/dev/inventory.yml playbooks/kubernetes/upgrade_cluster.yml
```

Kubespray가 노드를 순회하며 업그레이드한다. 컨트롤플레인 노드부터 올리고, 그 다음 워커 노드를 차례로 처리한다.

### 4. 업그레이드 후 확인

```bash
# 모든 노드 버전 확인
kubectl get nodes

# 컴포넌트 버전 확인
kubectl version --short

# 시스템 파드 상태
kubectl get pods -n kube-system
```

## 3. 주의할 점

- <b>한 번에 두 마이너 버전까지만</b>. 1.30에서 1.32로 직접 가면 안 된다. 1.31을 거쳐야 한다.
- <b>API 디프리케이션 확인</b>. 버전이 올라가면 deprecated API가 사라진다. 업그레이드 전에 `kubectl deprecations` 또는 [Pluto](https://github.com/FairwindsOps/pluto)로 확인한다.
- <b>etcd 버전 호환성</b>. etcd도 함께 올라가니, etcd 백업을 먼저 찍어두는 게 안전하다.
- <b>오프라인 환경</b>: 새 버전의 컨테이너 이미지와 바이너리를 미리 반입해야 한다. 온라인에서 패키징할 때 목표 버전에 맞춰 빌드한다.

> [!NOTE]
> 인증서 자동 갱신(`auto_renew_certificates: true`)을 켜두면, 업그레이드 시 인증서 만료 걱정을 덜 수 있다. Kubespray가 업그레이드 과정에서 인증서를 갱신해준다.
