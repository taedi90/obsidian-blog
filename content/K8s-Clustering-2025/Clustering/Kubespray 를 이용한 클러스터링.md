---
title: Kubespray로 온프레미스 클러스터 구축하기
date: 2025-07-16
draft: false
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
description: Kubespray를 서브모듈로 끌어안고 Ansible 플레이북 래퍼를 씌워, kube-proxy 없이 Cilium을 별도 설치하는 클러스터 구축 파이프라인을 만든 기록.
permalink: 
aliases: 
completed: 
type:
  - note
---

## 1. 왜 Kubespray인가

처음엔 직접 `kubeadm`을 두들기는 게 낫다고 생각했다. kubeadm이 하는 일이 결국 정해진 단계를 순서대로 실행하는 거니까, 쉘 스크립트로 감싸면 되지 않나. 3년 정도 그렇게 굴렸다. 결과부터 말하면 유지보수가 지옥이었다. 쿠버네티스 버전이 올라갈 때마다 kubeadm 플래그가 바뀌고, 새 노드를 추가하는 절차도 그때그때 달라졌다. 스크립트를 고치는 내 시간이 kubespray를 익히는 시간보다 컸을 것이다.

Kubespray는 Ansible 기반의 클러스터 자동화 도구다. 커뮤니티가 쿠버네티스 업스트림 변화를 따라가 주니, 버전업 때 내가 할 일은 인벤토리 변수 하나 바꾸는 것으로 끝난다. 처음엔 "프레임워크에 의존하는 게 마음에 안 든다"는 이유로 미뤘는데, 결국 그 의존성을 받아들이는 게 더 싼 선택이었다.

## 2. 구조: 서브모듈 + 래퍼 플레이북

Kubespray를 그대로 쓰지 않고 git 서브모듈로 끌어안았다. 이유는 두 가지다.

- Kubespray 버전을 클러스터 쿠버네티스 버전에 맞춰 핀해두고 싶었다.
- Kubespray의 플레이북을 직접 수정하면 업그레이드 때 머지가 꼬이니, 수정은 래퍼로 감싸는 쪽에만 두기로 했다.

리포 구조는 이런 식이다.

```
k8s-cluster/
├── modules/
│   └── kubespray/          # git submodule (release-2.28 핀)
├── playbooks/
│   ├── bootstrap/          # SSH, sudo, python 세팅
│   ├── kubernetes/         # cluster, scale, upgrade, reset 래퍼
│   ├── nvidia/            # GPU 드라이버/CUDA
│   └── manage/            # sysctl, CNI 플러그인 등
├── inventory/
│   ├── dev/                # 개발 클러스터 인벤토리
│   ├── offline_test/      # 오프라인 테스트
│   └── prod/               # 프로덕션
└── ansible.cfg
```

`ansible.cfg`에서 Kubespray의 roles, library, collections를 그대로 참조하게 해서, 래퍼 플레이북에서 Kubespray의 모든 자원을 쓸 수 있게 했다.

```ini
[defaults]
collections_paths = ./collections
roles_path = ./roles/galaxy:./roles:./modules/kubespray/roles
library = ./modules/kubespray/library
```

## 3. kube-proxy 끄고 Cilium 별도 설치

Kubespray가 기본 제공하는 Cilium은 Envoy 프록시가 빠져 있어서 Service Mesh 기능을 온전히 쓸 수 없었다. 그래서 Kubespray에서 CNI 설치를 아예 건너뛰고, 클러스터가 뜬 뒤 Cilium Helm 차트로 직접 설치하는 방식을 택했다.

인벤토리 `group_vars`에서 두 값을 끈다.

```yaml
# CNI 설치 제외
kube_network_plugin: none
# kube-proxy 설치 안 함
kube_proxy_remove: true
```

kube-proxy가 없으면 Cilium이 kube-proxy replacement 모드로 동작하게 설정해야 한다. Cilium values에서 `kubeProxyReplacement: true`를 주면, Cilium이 서비스 트래픽 라우팅을 kube-proxy 대신 처리한다. (이건 별도 CNI 선정 글에서 다룬다.)

> [!IMPORTANT]
> kube-proxy를 끄고 Cilium을 별도 설치하는 사이에 서비스 트래픽이 안通되는 공백이 생긴다. 클러스터 설치 직후 최대한 빨리 Cilium을 올려야 한다. 다행히 이 과정은 스크립트로 묶어두면 한 방에 된다.

## 4. 인벤토리: 노드 역할 그룹화

인벤토리는 단순히 IP 나열이 아니라 노드 역할을 그룹으로 나눈다. Kubespray가 그룹 이름을 인식해서 역할별로 다른 작업을 수행한다.

```yaml
# 컨트롤플레인 노드
kube_control_plane:
  hosts:
    master-01:
      ansible_host: 10.0.10.4
      ip: 10.0.10.4

# 스토리지 노드 (NFS, Longhorn)
storage_node:
  hosts:
    storage-01:
      ansible_host: 10.0.20.13
      ip: 10.0.20.13
      node_labels:
        node-role.kubernetes.io/storage: nfs
        node-role.kubernetes.io/worker: ""
      node_taints:
      - "dedicated=rook-ceph:NoSchedule"

# GPU 노드
gpu_node:
  hosts:
    gpu-worker-01:
      ansible_host: 10.0.20.10
      ip: 10.0.20.10
      node_labels:
        node-role.kubernetes.io/worker: ""
        node-role.kubernetes.io/gpu: nvidia
```

여기서 핵심은 인벤토리에 `node_labels`와 `node_taints`를 적어두면, Kubespray가 노드 조인 시 자동으로 라벨과 테인트를 붙여준다는 거다. 나중에 `kubectl label`을 수동으로 안 쳐도 된다.

`kube_node` 그룹은 `storage_node`, `gpu_node`, `none_gpu_node`를 자식으로 묶는 부모 그룹이다. Kubespray는 `kube_node`에 속한 호스트를 워커로 취급한다.

```yaml
kube_node:
  children:
    storage_node:
    gpu_node:
    none_gpu_node:

etcd:
  children:
    kube_control_plane:
```

## 5. 주요 group_vars

인벤토리와 함께 가장 많이 건드리는 파일이다. 불필요한 기본값은 모두 걷어내고 우리 환경에 맞는 값만 남겼다.

```yaml
# 쿠버네티스 버전
kube_version: 1.32.6

# 컨테이너 런타임
container_manager: containerd

# 컨테이너 런타임 데이터 경로 (기본 /var/lib에서 /data로 이동)
containerd_storage_dir: /data/containerd
etcd_data_dir: /data/etcd

# 서비스 CIDR
kube_service_addresses: 10.20.0.0/16

# 파드 CIDR
kube_pods_subnet: 10.10.0.0/16

# 노드별 서브넷
kube_network_node_prefix: 22

# 노드 로컬 DNS 비활성화 (iptables-free 환경)
enable_nodelocaldns: false

# 인증서 자동 갱신
auto_renew_certificates: true

# etcd 배포 방식
etcd_deployment_type: kubeadm

# 외부 로드밸런서 (apiserver용)
apiserver_loadbalancer_domain_name: "k8s-api.example.com"
loadbalancer_apiserver:
  address: 203.0.113.10
  port: 6000
```

> [!NOTE]
> `containerd_storage_dir`과 `etcd_data_dir`을 `/data`로 옮긴 건 디스크 파티션 분리 때문이다. 시스템 디스크 `/`가 찰까 봐 노심초심하는 것보다, 애초에 데이터 디스크를 따로 두는 게 속 편하다.

## 6. 클러스터 설치

래퍼 플레이북은 Kubespray의 `cluster.yml`을 `import_playbook`으로 끌어와 앞뒤에 우리 작업만 끼워넣는 구조다.

```yaml
---
- name: Disable firewalld/ufw
  import_playbook: ../../modules/kubespray/contrib/os-services/os-services.yml
  vars:
    disable_service_firewall: true

- name: Install Kubernetes
  import_playbook: ../../modules/kubespray/playbooks/cluster.yml

- name: Get admin.conf from the first control plane node
  hosts: kube_control_plane
  tasks:
    - name: Fetch kubeconfig from remote node to localhost
      fetch:
        src: "{{ kube_config_dir + '/admin.conf' }}"
        dest: "{{ inventory_dir }}/kube-config/config"
        flat: yes
      when: inventory_hostname == groups['kube_control_plane'][0]
```

설치 실행은 한 줄이다.

```bash
ansible-playbook -i inventory/dev/inventory.yml playbooks/kubernetes/cluster.yml
```

설치가 끝나면 `inventory/dev/kube-config/config`에 kubeconfig가 떨어진다. 이걸 `KUBECONFIG`로 설정하면 로컬에서 `kubectl`을 바로 쓸 수 있다.

```bash
export KUBECONFIG=$(pwd)/inventory/dev/kube-config/config
kubectl get nodes
```

## 7. OIDC 설정

Kubespray의 `kube_oidc_auth`를 쓰면 API 서버에 OIDC 설정을 붙일 수 있다. 우리는 Entra ID(구 Azure AD)를 IdP로 썼다.

```yaml
kube_oidc_auth: true
kube_oidc_url: https://login.microsoftonline.com/{tenant}/v2.0
kube_oidc_client_id: {client-id}
kube_oidc_username_claim: email
```

이렇게 하면 `kubectl`에 OIDC 토큰으로 인증할 수 있다. (인증인가 구성은 별도 글에서 다룬다.)

## 8. 남은 것들

클러스터가 뜨고 나면 할 일이 아직 남아 있다.

1. <b>Cilium 설치</b> — kube-proxy를 껐으니 서비스 트래픽이 안通된다. 최대한 빨리 올려야 한다.
2. <b>플러그인 컴포넌트 설치</b> — Helmfile로 관리하는 애플리케이션들(Longhorn, SigNoz, Argo CD 등)을 배포한다.
3. <b>GPU 노드 설정</b> — NVIDIA 드라이버와 container toolkit을 올린다.
4. <b>etcd 백업</b> — CronJob으로 etcd 스냅샷을 주기적으로 찍는다.

이 과정들은 각각 별도 글로 정리해뒀다.
