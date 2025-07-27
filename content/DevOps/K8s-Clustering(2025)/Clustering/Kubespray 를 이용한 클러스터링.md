---
title: Kubespray 를 이용한 클러스터링
date: 2025-07-16
draft: true
tags:
  - kubernetes
  - kubespray
  - ansible
  - cluster
  - automation
  - infrastructure
  - installation
  - cilium
  - cni
banner: 
cssclasses: 
description: Kubespray를 활용하여 Kubernetes 클러스터를 자동화 구축하는 과정과 주요 설정 방법
permalink: 
aliases: 
completed: 
type:
  - note
---

## 1. 개요

<b>Kubespray</b>는 Ansible 기반의 Kubernetes 클러스터 자동화 설치 도구다. 프로덕션 환경에서 안정적이고 확장 가능한 Kubernetes 클러스터를 구축할 때 널리 사용되며, 다양한 플랫폼과 네트워크 구성을 지원한다.

이 문서에서는 Kubespray를 사용하여 Kubernetes 클러스터를 구축하는 전체 과정을 다룬다. 특히 <b>kube-proxy를 비활성화</b>하고 별도의 CNI(Container Network Interface)를 설치하는 방법에 중점을 둔다.

> [!INFO]
> Kubespray에서 기본 제공하는 Cilium은 Envoy Proxy가 포함되지 않아 Service Mesh 기능을 완전히 활용하기 어렵다. 이런 경우 kube-proxy를 비활성화하고 별도로 Cilium을 설치하는 것이 더 나은 선택이 될 수 있다.

## 2. 사전 준비

### 2-1. 하드웨어 요구사항
- **Master Node**: 최소 2CPU, 4GB RAM
- **Worker Node**: 최소 1CPU, 2GB RAM
- **네트워크**: 모든 노드 간 SSH 통신 가능
- **스토리지**: 각 노드당 최소 20GB 여유 공간

### 2-2. 소프트웨어 요구사항
- Ubuntu 20.04 이상 또는 CentOS 7/8
- Python 3.6 이상
- Ansible 2.12 이상
- SSH 키 기반 인증 설정

## 3. Kubespray 준비

### 3-1. 소스 코드 다운로드

```bash
# Kubespray 저장소 클론
git clone https://github.com/kubernetes-sigs/kubespray.git
cd kubespray

# 안정 버전으로 체크아웃 (권장)
git checkout release-2.28
```

### 3-2. Python 환경 설정

가상 환경을 사용하여 의존성 충돌을 방지하는 것이 좋다.

```bash
# Python 가상 환경 생성 (선택사항)
python3 -m venv venv
source venv/bin/activate

# 필요한 패키지 설치
pip install -r requirements.txt
```

## 4. 인벤토리 구성

### 4-1. 인벤토리 파일 생성

대상 클러스터의 환경에 맞게 인벤토리를 구성한다. Kubespray의 `inventory/sample` 파일을 참고하여 새로운 인벤토리를 생성한다.

```bash
# 샘플 인벤토리 복사
cp -rfp inventory/sample inventory/mycluster

# 인벤토리 편집
vi inventory/mycluster/inventory.ini
```

### 4-2. 인벤토리 설정 예시

```ini
[all]
master-01 ansible_host=192.168.1.10 ip=192.168.1.10
master-02 ansible_host=192.168.1.11 ip=192.168.1.11
master-03 ansible_host=192.168.1.12 ip=192.168.1.12
worker-01 ansible_host=192.168.1.20 ip=192.168.1.20
worker-02 ansible_host=192.168.1.21 ip=192.168.1.21

[kube_control_plane]
master-01
master-02
master-03

[etcd]
master-01
master-02
master-03

[kube_node]
worker-01
worker-02

[calico_rr]

[k8s_cluster:children]
kube_control_plane
kube_node
calico_rr
```

### 4-3. 클러스터 변수 설정

`inventory/mycluster/group_vars/k8s_cluster/k8s-cluster.yml` 파일에서 주요 설정을 수정한다.

```yaml
# Kubernetes 버전 설정
kube_version: v1.28.2

# kube-proxy 비활성화 (Cilium 등 별도 CNI 사용 시)
kube_proxy_mode: "none"

# 네트워크 플러그인 설정
kube_network_plugin: none  # 별도 CNI 설치를 위해 비활성화

# 서비스 서브넷
kube_service_addresses: 10.233.0.0/18

# Pod 서브넷
kube_pods_subnet: 10.233.64.0/18

# 클러스터 도메인
cluster_name: cluster.local
```

> [!IMPORTANT]
> kube-proxy를 비활성화할 경우, 반드시 **대체 네트워크 솔루션**(Cilium, Istio 등)을 준비해야 한다. 그렇지 않으면 Service 간 통신이 불가능하다.

## 5. 노드 설정

### 5-1. SSH 키 설정

모든 대상 노드에 SSH 키 기반 인증을 설정한다.

```bash
# SSH 키 생성 (없는 경우)
ssh-keygen -t rsa -b 4096

# 각 노드에 공개키 복사
ssh-copy-id root@192.168.1.10
ssh-copy-id root@192.168.1.11
# ... 모든 노드에 반복
```

### 5-2. 노드 사전 확인

각 노드에서 다음 사항들을 확인한다:

```bash
# SSH 서비스 상태 확인
systemctl status sshd

# 방화벽 설정 확인 (필요시 비활성화)
systemctl status ufw
systemctl disable ufw

# SELinux 설정 확인 (CentOS/RHEL의 경우)
getenforce
```

## 6. 클러스터 설치

### 6-1. 연결성 테스트

실제 설치 전에 모든 노드에 대한 연결성을 테스트한다.

```bash
# Ansible 연결 테스트
ansible -i inventory/mycluster/inventory.ini all -m ping
```

### 6-2. 클러스터 설치 실행

```bash
# 클러스터 설치 시작
ansible-playbook -i inventory/mycluster/inventory.ini cluster.yml \
  --become --become-user=root
```

설치 과정은 환경에 따라 20-60분 정도 소요된다. 로그를 통해 진행 상황을 모니터링할 수 있다.

### 6-3. 설치 진행 상황 모니터링

```bash
# 별도 터미널에서 master 노드 로그 확인
ssh root@192.168.1.10 "journalctl -u kubelet -f"

# Ansible 상세 로그 출력
ansible-playbook -i inventory/mycluster/inventory.ini cluster.yml \
  --become --become-user=root -v
```

## 7. 설치 후 확인

### 7-1. kubectl 접근 설정

```bash
# master 노드에서 kubeconfig 복사
scp root@192.168.1.10:/etc/kubernetes/admin.conf ~/.kube/config

# 권한 설정
chmod 600 ~/.kube/config
```

### 7-2. 클러스터 상태 확인

```bash
# 노드 상태 확인
kubectl get nodes -o wide

# 시스템 Pod 상태 확인
kubectl get pods -n kube-system

# 클러스터 정보 확인
kubectl cluster-info
```

### 7-3. 예상 결과

정상적으로 설치가 완료되면 다음과 같은 결과를 확인할 수 있다:

```bash
$ kubectl get nodes
NAME        STATUS   ROLES           AGE   VERSION
master-01   Ready    control-plane   10m   v1.28.2
master-02   Ready    control-plane   10m   v1.28.2
master-03   Ready    control-plane   10m   v1.28.2
worker-01   Ready    <none>          9m    v1.28.2
worker-02   Ready    <none>          9m    v1.28.2
```

## 8. 문제 해결

### 8-1. 일반적인 오류 및 해결

**네트워크 연결 오류**
```bash
# SSH 연결 확인
ansible -i inventory/mycluster/inventory.ini all -m ping

# 방화벽 규칙 확인
sudo ufw status
```

**권한 오류**
```bash
# sudo 권한 확인
ansible -i inventory/mycluster/inventory.ini all -m shell -a "sudo whoami" --become
```

**메모리 부족 오류**
```bash
# 각 노드의 메모리 사용량 확인
ansible -i inventory/mycluster/inventory.ini all -m shell -a "free -h"
```

### 8-2. 로그 분석

문제가 발생한 경우 다음 로그들을 확인한다:

```bash
# Kubelet 로그
journalctl -u kubelet -f

# Ansible 로그 (자세한 출력)
ansible-playbook -i inventory/mycluster/inventory.ini cluster.yml \
  --become --become-user=root -vvv

# 컨테이너 런타임 로그
journalctl -u containerd -f
```

## 9. 다음 단계

클러스터 설치가 완료된 후에는 다음 작업들을 수행한다:

1. **CNI 설치**: kube-proxy를 비활성화한 경우 Cilium 등의 CNI를 설치
2. **Ingress Controller**: NGINX, Traefik 등의 인그레스 컨트롤러 설치
3. **스토리지**: Longhorn, NFS 등의 영구 스토리지 솔루션 구성
4. **모니터링**: Prometheus, Grafana 등의 모니터링 스택 설치
5. **백업**: etcd 백업 및 클러스터 백업 정책 수립

> [!NOTE]
> 프로덕션 환경에서는 반드시 **정기적인 백업 정책**을 수립하고, **고가용성 구성**을 통해 단일 장애점을 제거해야 한다.