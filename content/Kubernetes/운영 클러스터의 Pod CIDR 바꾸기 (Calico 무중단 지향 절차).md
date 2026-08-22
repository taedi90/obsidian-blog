---
title: 운영 중인 클러스터의 Pod CIDR 바꾸기 (Calico, 무중단 지향 절차)
date: 2026-02-09
draft: false
featured: true
tags:
  - kubernetes
  - calico
  - networking
  - kubeadm
  - troubleshooting
banner: 
cssclasses: 
description: 파드 대역이 노드 IP 대역과 겹쳐 라우팅이 꼬이던 클러스터의 Pod CIDR을, 노드를 한 대씩 갈아끼우며 무손실로 옮긴 기록.
permalink: 
aliases: 
completed: true
type:
  - issue
---

## 요약

> [!SUMMARY]
> 파드 대역(`192.168.0.0/16`)이 노드가 사용하는 물리 네트워크 대역과 겹쳐 통신 오류가 발생하던 클러스터에서, 파드 대역만 `10.244.0.0/16`으로 옮겼다. Calico IPPool·`kube-controller-manager`·`kubeadm-config`·`kube-proxy`의 CIDR을 순서대로 변경한 뒤, 노드 라벨 백업과 `node-ipam-controller` 에러 대응까지 포함하여 노드를 하나씩 `delete` 후 재join하는 방식으로 진행했다.

## 1. 환경

- Kubernetes: v1.30 (kubeadm)
- CNI: Calico (IPIP `Always` 모드)
- 기존 Pod CIDR `192.168.0.0/16` → 신규 `10.244.0.0/16`
- 노드·주변 장비가 쓰는 물리 네트워크도 `192.168.x.x` 대역

## 2. 이슈

새 GPU 서버를 검증 클러스터에 join하려다 문제에 부딪혔다. 서버가 연결된 물리 네트워크가 `192.168.x.x` 대역인데, 이 클러스터의 <b>Pod CIDR</b>도 `192.168.0.0/16`이었다. 파드에 할당되는 IP와 실제 노드·주변 장비가 사용하는 IP가 같은 대역에서 겹치니, 특정 목적지로 가는 패킷이 파드 오버레이로 흘러 들어가거나 그 반대 상황이 발생하여 라우팅이 불안정해졌다.

Calico 기본값이 `192.168.0.0/16`이라 초기 설치 때 별도의 검토 없이 그대로 둔 것이 원인이었다. 사내망이 `192.168.x.x`를 사용하는 이상, 파드 대역을 다른 사설 대역으로 옮기는 것 외에 뚜렷한 대안은 없었다.

문제는 <b>Pod CIDR은 클러스터를 구성할 때 한 번 정하면 변경을 가정하지 않은 값이라는 점</b>이다. `kubeadm`으로 새 클러스터를 다시 구축하는 것이 정석이지만, 이미 워크로드가 실행 중인 클러스터를 통째로 재설치할 수는 없었다. <b>클러스터를 유지한 채, 파드 대역만 노드 하나씩 교체하며 옮길 수 있을까?</b>

## 3. 해결

Pod CIDR은 한 곳에만 존재하는 값이 아니라 여러 컴포넌트에 분산되어 설정되어 있다. 어느 하나만 변경하면 서로 불일치가 발생하여 컨트롤플레인 동작에 문제가 생기므로, 변경해야 할 위치를 먼저 전부 파악했다.

- Calico <b>IPPool</b> — 파드에 실제로 IP를 나눠주는 주체
- `kube-controller-manager`의 `--cluster-cidr` — 노드별 파드 서브넷을 쪼개주는 <b>node-ipam</b>의 기준
- `kubeadm-config` ConfigMap의 `podSubnet` — 이후 노드가 join할 때 참조하는 값
- `kube-proxy` ConfigMap의 `clusterCIDR`
- 각 노드의 kubelet — 노드가 다시 join하면 새 대역으로 파드 서브넷을 받는다

### 1. 백업

되돌리기 어려운 작업일수록 백업이 중요하다. 변경 대상 네 가지를 모두 파일로 저장했다.

```bash
# 파드 대역이 박혀 있는 네 곳을 통째로 백업한다.
# (IPPool은 Calico CRD라 crd.projectcalico.org 리소스로 조회)
kubectl get ippool default-ipv4-ippool -o yaml > backup/ippool.yaml
kubectl -n kube-system get cm kubeadm-config -o yaml > backup/kubeadm-config.yaml
kubectl -n kube-system get cm kube-proxy     -o yaml > backup/kube-proxy.yaml
cp -a /etc/kubernetes /etc/kubernetes.bak.$(date +%y%m%d)  # 매니페스트째로
```

백업해 둔 기존 IPPool은 다음과 같았다. `cidr`이 노드 대역과 겹치는 `192.168.0.0/16`이라는 점이 이번 문제의 핵심이다.

```yaml
apiVersion: crd.projectcalico.org/v1
kind: IPPool
metadata:
  name: default-ipv4-ippool
spec:
  allowedUses:
  - Workload
  - Tunnel
  blockSize: 26
  cidr: 192.168.0.0/16   # ← 노드 물리 대역과 겹치는 기존 파드 대역
  ipipMode: Always
  natOutgoing: true
  nodeSelector: all()
  vxlanMode: Never
```

### 2. 신규 IPPool 생성, 기존 IPPool 비활성화

먼저 새 대역(`10.244.0.0/16`)으로 IPPool을 하나 더 생성한다. 기존 풀이 아직 활성 상태이므로 이 시점에는 새로 시작하는 파드도 대부분 기존 대역을 받는다. 그다음 기존 IPPool을 <b>비활성화</b>하여, 이후에 새로 시작하는 파드는 신규 풀에서만 IP를 받도록 유도한다. (이미 실행 중인 파드의 IP가 즉시 바뀌지는 않는다. 결국 파드를 다시 시작해야 새 대역으로 전환된다.)

```yaml
# 신규 파드 대역용 IPPool. 기존과 blockSize/모드는 동일하게 두고 cidr만 교체.
apiVersion: crd.projectcalico.org/v1
kind: IPPool
metadata:
  name: default-ipv4-pool
spec:
  allowedUses:
  - Workload
  - Tunnel
  blockSize: 26
  cidr: 10.244.0.0/16
  ipipMode: Always
  natOutgoing: true
  nodeSelector: all()
  vxlanMode: Never
```

```bash
# 기존 풀은 지우지 말고 비활성화한다. 롤백 여지를 남겨두는 편이 안전하다.
calicoctl patch ippool default-ipv4-ippool -p '{"spec":{"disabled":true}}'
```

### 3. 컨트롤플레인 쪽 CIDR 세 곳 교체

이제 쿠버네티스가 인식하는 클러스터 CIDR을 신규 대역으로 맞춘다. 세 곳을 수정해야 한다.

<b>첫째, `kube-controller-manager` 매니페스트.</b> `/etc/kubernetes/manifests/kube-controller-manager.yaml`의 `--cluster-cidr` 플래그를 `10.244.0.0/16`으로 바꾼다. static pod라 파일을 저장하면 kubelet이 알아서 재기동한다.

<b>둘째, `kubeadm-config` ConfigMap.</b> `networking.podSubnet`을 신규 대역으로 변경한다. 이 값이 즉시 동작을 바꾸는 것은 아니지만, 앞으로 노드가 join할 때 이 값을 참조하므로 맞춰 두지 않으면 나중에 노드가 다시 기존 대역으로 돌아간다.

```yaml
# kubeadm-config ConfigMap 내 ClusterConfiguration 발췌
networking:
  dnsDomain: cluster.local
  podSubnet: 10.244.0.0/16   # ← 192.168.0.0/16 에서 교체
  serviceSubnet: 10.96.0.0/12
```

<b>셋째, `kube-proxy` ConfigMap.</b> `clusterCIDR`을 신규 대역으로 바꾼 뒤 `kube-proxy` DaemonSet을 롤아웃해 반영한다.

### 4. 노드를 한 대씩 delete하고 다시 join

여기가 이번 작업에서 가장 신경 쓰인 단계였다. CIDR을 모두 변경해도 <b>기존 노드는 여전히 기존 대역의 `podCIDR`을 유지한다.</b> 노드의 `spec.podCIDR`은 join 시점에 node-ipam이 할당하는 값이라, 실행 중인 노드를 그 자리에서 새 대역으로 바꿀 방법이 없다. 노드를 클러스터에서 `delete`했다가 다시 join해야 비로소 신규 대역에서 서브넷을 새로 할당받는다.

그래서 노드를 <b>한 대씩</b> 교체했다. 한 번에 모두 내리면 워크로드가 배치될 곳이 없으므로, drain → delete → kubelet 재기동(재join) → 복귀를 노드별로 순차 진행했다.

```bash
# 노드 한 대 기준. drain 으로 워크로드를 뺀 뒤 클러스터에서 제거하고,
# kubelet 을 재기동하면 kubeadm-config 의 신규 대역으로 다시 join 된다.
kubectl drain node-01 --ignore-daemonsets --delete-emptydir-data
kubectl delete node node-01
# (해당 노드에서) 재join
systemctl restart kubelet
```

> [!IMPORTANT]
> 노드를 `delete`하면 그 노드에 부여되어 있던 <b>라벨이 모두 초기화</b>된다. 컨트롤플레인 노드라면 `node-role.kubernetes.io/control-plane` 같은 라벨까지 사라진다. 다시 join하면 라벨 없는 상태의 노드로 돌아오므로, `delete` 전에 노드별 라벨을 반드시 백업해 두고 재join 후에 다시 적용해야 한다. 이 작업을 누락하면 nodeSelector·affinity를 설정한 파드들이 `Pod was rejected: Predicate NodeAffinity failed`로 스케줄링되지 않는다.

라벨 백업은 이렇게 떠뒀다.

```bash
# 노드별 라벨을 통째로 json 으로 저장. 재join 후 이걸 보고 다시 label 을 건다.
kubectl get nodes -o json \
  | jq '.items[] | {name: .metadata.name, labels: .metadata.labels}' \
  > backup/node-labels.json
```

그리고 이 순서를 지키지 않고 노드를 그대로 둔 채 CIDR만 변경했을 때, `kube-controller-manager`가 다음과 같은 에러를 출력하며 node-ipam 컨트롤러를 시작하지 못했다.

```text
"Error starting controller"
  err="failed to mark cidr[192.168.0.0/24] at idx [0] as occupied for node: node-05:
       cidr 192.168.0.0/24 is out the range of cluster cidr 10.244.0.0/16"
  controller="node-ipam-controller"
```

node-ipam 입장에서는 클러스터 CIDR이 이미 `10.244.0.0/16`인데, 노드에 설정된 `podCIDR`은 아직 기존 대역(`192.168.0.0/24`)이라 "이 노드 서브넷은 관할 범위 밖"이라며 초기화를 거부한 것이다. 노드를 다시 join하여 `podCIDR`을 신규 대역으로 갱신하면 이 에러는 사라진다. 에러 메시지 자체가 <b>왜 노드를 교체해야 하는지</b>를 그대로 설명해 주는 셈이다.

## 4. 확인

먼저 `kube-controller-manager`의 정상 동작을 확인했다. 파드가 `Running` 상태이면서 로그에 앞의 node-ipam 에러가 더는 나오지 않으면 통과한다.

```bash
kubectl -n kube-system get pod -l component=kube-controller-manager
kubectl -n kube-system logs -l component=kube-controller-manager --tail=50 | grep -i ipam
```

다음으로 노드가 신규 대역의 `podCIDR`을 받았는지 확인했다.

```bash
# 각 노드의 podCIDR 이 10.244.x.x 로 바뀌었는지 한눈에 본다.
kubectl get nodes -o custom-columns='NAME:.metadata.name,PODCIDR:.spec.podCIDR'
```

마지막으로 실제 파드를 확인했다. 기존 대역을 사용 중이던 파드는 다시 시작해야 신규 대역을 받으므로, NFS·DB처럼 상태를 가진 워크로드부터 재생성이 정상적으로 되는지 확인한 뒤 나머지를 롤링 방식으로 전환했다. 새로 시작한 파드가 `10.244.x.x`를 할당받고, 파드 간·파드-서비스 간 통신이 정상이면 이전이 완료된다.

```bash
# 새로 뜬 파드들이 신규 대역 IP 를 받았는지 확인
kubectl get pods -A -o wide | awk '{print $1, $2, $7}'
```

특별한 기법이 필요한 작업은 아니었다. CIDR이 설정된 위치를 빠짐없이 찾고, 노드를 교체하여 `podCIDR`을 갱신하고, 라벨 백업 같은 롤백 수단을 미리 준비한 것이 전부다.

## 참고

- [Calico — Migrate from one IP pool to another](https://docs.tigera.io/calico/latest/networking/ipam/migrate-pools)
- [Calico — IPPool resource](https://docs.tigera.io/calico/latest/reference/resources/ippool)
- [kube-controller-manager 옵션 (`--cluster-cidr`)](https://kubernetes.io/docs/reference/command-line-tools-reference/kube-controller-manager/)
