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
> 파드 대역(`192.168.0.0/16`)이 노드가 쓰는 물리 네트워크 대역과 겹쳐 통신이 꼬이던 클러스터를, 파드 대역만 `10.244.0.0/16`으로 옮겼다. Calico IPPool·`kube-controller-manager`·`kubeadm-config`·`kube-proxy`의 CIDR을 순서대로 바꾼 뒤 노드를 하나씩 `delete` 후 재join하는 방식으로, 노드 라벨 백업과 `node-ipam-controller` 에러까지 대응하며 진행했다.

## 1. 환경

- Kubernetes: v1.30 (kubeadm)
- CNI: Calico (IPIP `Always` 모드)
- 기존 Pod CIDR `192.168.0.0/16` → 신규 `10.244.0.0/16`
- 노드·주변 장비가 쓰는 물리 네트워크도 `192.168.x.x` 대역

## 2. 이슈

새 GPU 서버를 검증 클러스터에 join하려다 막혔다. 서버가 붙은 물리 네트워크가 `192.168.x.x` 대역인데, 하필 이 클러스터의 <b>Pod CIDR</b>이 `192.168.0.0/16`이었다. 파드에 붙는 IP와 실제 노드·주변 장비가 쓰는 IP가 같은 대역에서 겹치니, 특정 목적지로 가는 패킷이 파드 오버레이로 새거나 반대로 빨려 들어가는 식으로 라우팅이 애매해졌다.

Calico 기본값이 `192.168.0.0/16`이라 초기 설치 때 아무 생각 없이 그대로 뒀던 게 화근이었다. (설치 당시의 나를 탓해봐야 소용없고, 아마 앞으로도 비슷한 실수를 할 것 같긴 하다.) 사내망이 `192.168.x.x`를 쓰는 이상, 파드 대역을 아예 다른 사설 대역으로 빼는 것 말고는 답이 없었다.

문제는 <b>Pod CIDR은 클러스터를 세울 때 한 번 정하면 바꾸라고 만든 값이 아니라는 점</b>이다. `kubeadm`으로 새 클러스터를 다시 까는 게 정석이지만, 이미 워크로드가 돌고 있는 걸 통째로 재설치할 수는 없었다. <b>클러스터를 살려둔 채, 파드 대역만 노드 하나씩 갈아끼우며 옮길 수 있는가?</b>

## 3. 해결

Pod CIDR은 한 군데 값이 아니라 여러 컴포넌트에 흩어져 박혀 있다. 어느 하나만 바꾸면 서로 어긋나 컨트롤플레인이 삐걱대므로, 바꿔야 할 곳을 먼저 전부 파악했다.

- Calico <b>IPPool</b> — 파드에 실제로 IP를 나눠주는 주체
- `kube-controller-manager`의 `--cluster-cidr` — 노드별 파드 서브넷을 쪼개주는 <b>node-ipam</b>의 기준
- `kubeadm-config` ConfigMap의 `podSubnet` — 이후 노드가 join할 때 참조하는 값
- `kube-proxy` ConfigMap의 `clusterCIDR`
- 각 노드의 kubelet — 노드가 다시 join하면 새 대역으로 파드 서브넷을 받는다

### 1. 백업

되돌리기 어려운 작업일수록 백업이 마음의 평화다. 손댈 대상 네 가지를 전부 파일로 떠뒀다.

```bash
# 파드 대역이 박혀 있는 네 곳을 통째로 백업한다.
# (IPPool은 Calico CRD라 crd.projectcalico.org 리소스로 조회)
kubectl get ippool default-ipv4-ippool -o yaml > backup/ippool.yaml
kubectl -n kube-system get cm kubeadm-config -o yaml > backup/kubeadm-config.yaml
kubectl -n kube-system get cm kube-proxy     -o yaml > backup/kube-proxy.yaml
cp -a /etc/kubernetes /etc/kubernetes.bak.$(date +%y%m%d)  # 매니페스트째로
```

백업해둔 기존 IPPool은 이런 모양이었다. `cidr`이 노드 대역과 겹치는 `192.168.0.0/16`인 게 이번 사달의 핵심이다.

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

먼저 새 대역(`10.244.0.0/16`)으로 IPPool을 하나 더 만든다. 아직 기존 풀이 살아 있으니 이 시점에는 새로 뜨는 파드도 대부분 옛 대역을 받는다. 그다음 기존 IPPool을 <b>비활성화</b>해서, 앞으로 새로 뜨는 파드는 신규 풀에서만 IP를 받도록 유도한다. (이미 떠 있는 파드의 IP가 그 자리에서 바뀌지는 않는다. 결국 파드를 다시 띄워야 새 대역으로 넘어온다.)

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

이제 쿠버네티스가 아는 클러스터 CIDR을 신규 대역으로 맞춘다. 세 곳을 손봐야 한다.

<b>첫째, `kube-controller-manager` 매니페스트.</b> `/etc/kubernetes/manifests/kube-controller-manager.yaml`의 `--cluster-cidr` 플래그를 `10.244.0.0/16`으로 바꾼다. static pod라 파일을 저장하면 kubelet이 알아서 재기동한다.

<b>둘째, `kubeadm-config` ConfigMap.</b> `networking.podSubnet`을 신규 대역으로 바꾼다. 지금 당장 동작을 바꾸는 값은 아니지만, 앞으로 노드가 join할 때 이 값을 참조하므로 맞춰두지 않으면 나중에 다시 옛 대역으로 돌아간다.

```yaml
# kubeadm-config ConfigMap 내 ClusterConfiguration 발췌
networking:
  dnsDomain: cluster.local
  podSubnet: 10.244.0.0/16   # ← 192.168.0.0/16 에서 교체
  serviceSubnet: 10.96.0.0/12
```

<b>셋째, `kube-proxy` ConfigMap.</b> `clusterCIDR`을 신규 대역으로 바꾼 뒤 `kube-proxy` DaemonSet을 롤아웃해 반영한다.

### 4. 노드를 한 대씩 delete하고 다시 join

여기가 이번 작업의 진짜 고비였다. CIDR을 다 바꿔도 <b>기존 노드는 여전히 옛 대역의 `podCIDR`을 물고 있다.</b> 노드의 `spec.podCIDR`은 join 시점에 node-ipam이 할당하는 값이라, 살아 있는 노드를 그 자리에서 새 대역으로 바꿀 방법이 없다. 노드를 클러스터에서 `delete`했다가 다시 join시켜야 비로소 신규 대역에서 서브넷을 새로 받는다.

그래서 노드를 <b>한 대씩</b> 돌렸다. 한 번에 다 내리면 워크로드가 갈 곳이 없으니, drain → delete → kubelet 재기동(재join) → 복귀를 노드별로 순차 진행했다.

```bash
# 노드 한 대 기준. drain 으로 워크로드를 뺀 뒤 클러스터에서 제거하고,
# kubelet 을 재기동하면 kubeadm-config 의 신규 대역으로 다시 join 된다.
kubectl drain node-01 --ignore-daemonsets --delete-emptydir-data
kubectl delete node node-01
# (해당 노드에서) 재join
systemctl restart kubelet
```

> [!IMPORTANT]
> 노드를 `delete`하면 그 노드에 붙어 있던 <b>라벨이 전부 초기화</b>된다. 컨트롤플레인 노드라면 `node-role.kubernetes.io/control-plane` 같은 라벨까지 사라진다. 다시 join하면 라벨 없는 맨몸 노드로 돌아오므로, `delete` 전에 노드별 라벨을 반드시 백업해두고 재join 후 다시 붙여야 한다. 이걸 놓치면 nodeSelector·affinity를 건 파드들이 `Pod was rejected: Predicate NodeAffinity failed`로 스케줄되지 않는다.

라벨 백업은 이렇게 떠뒀다.

```bash
# 노드별 라벨을 통째로 json 으로 저장. 재join 후 이걸 보고 다시 label 을 건다.
kubectl get nodes -o json \
  | jq '.items[] | {name: .metadata.name, labels: .metadata.labels}' \
  > backup/node-labels.json
```

그리고 이 순서를 지키지 않고 노드를 그대로 둔 채 CIDR만 바꿨을 때, `kube-controller-manager`가 이런 에러를 뱉으며 node-ipam 컨트롤러를 못 띄웠다.

```text
"Error starting controller"
  err="failed to mark cidr[192.168.0.0/24] at idx [0] as occupied for node: node-05:
       cidr 192.168.0.0/24 is out the range of cluster cidr 10.244.0.0/16"
  controller="node-ipam-controller"
```

node-ipam 입장에서는 클러스터 CIDR은 이미 `10.244.0.0/16`인데, 노드에 박힌 `podCIDR`은 아직 옛 대역(`192.168.0.0/24`)이라 "이 노드 서브넷은 내 관할 밖"이라며 초기화를 거부한 것이다. 노드를 다시 join시켜 `podCIDR`을 신규 대역으로 갱신하면 이 에러는 사라진다. 에러 메시지 자체가 <b>왜 노드를 갈아끼워야 하는지</b>를 그대로 설명해준 셈이다.

## 4. 확인

먼저 `kube-controller-manager`가 정상인지 봤다. 파드가 `Running`이면서 로그에 앞의 node-ipam 에러가 더는 안 나오면 통과다.

```bash
kubectl -n kube-system get pod -l component=kube-controller-manager
kubectl -n kube-system logs -l component=kube-controller-manager --tail=50 | grep -i ipam
```

다음으로 노드가 신규 대역의 `podCIDR`을 받았는지 확인했다.

```bash
# 각 노드의 podCIDR 이 10.244.x.x 로 바뀌었는지 한눈에 본다.
kubectl get nodes -o custom-columns='NAME:.metadata.name,PODCIDR:.spec.podCIDR'
```

마지막은 실제 파드다. 옛 대역을 물고 있던 파드는 다시 띄워야 신규 대역을 받으므로, NFS·DB처럼 상태를 가진 것부터 재생성이 잘 되는지 확인한 뒤 나머지를 롤링으로 넘겼다. 새로 뜬 파드가 `10.244.x.x`를 받고, 파드 간·파드-서비스 간 통신이 정상이면 이전 완료다.

```bash
# 새로 뜬 파드들이 신규 대역 IP 를 받았는지 확인
kubectl get pods -A -o wide | awk '{print $1, $2, $7}'
```

대단한 마법이 있는 작업은 아니었다. CIDR이 박힌 곳을 빠짐없이 찾고, 노드를 갈아끼워 `podCIDR`을 갱신하고, 라벨 백업 같은 되돌릴 구석을 만들어둔 게 전부다.

## 참고

- [Calico — Migrate from one IP pool to another](https://docs.tigera.io/calico/latest/networking/ipam/migrate-pools)
- [Calico — IPPool resource](https://docs.tigera.io/calico/latest/reference/resources/ippool)
- [kube-controller-manager 옵션 (`--cluster-cidr`)](https://kubernetes.io/docs/reference/command-line-tools-reference/kube-controller-manager/)
