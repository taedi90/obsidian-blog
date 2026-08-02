---
title: CNI 구현체 선정
date: 2025-04-01
draft: false
tags:
  - Kubernetes
  - CNI
  - Cilium
  - eBPF
  - Calico
  - Flannel
  - ServiceMesh
  - Observability
  - Comparison
banner: 
cssclasses: 
description: 온프레미스 클러스터의 CNI로 Cilium을 고른 이유. Calico, Flannel과 비교하며 정리했다.
permalink: 
aliases:
completed: true
type:
  - comparison
---

## 요약

> [!SUMMARY]
> 온프레미스 클러스터의 CNI로 <b>Cilium</b>을 선정했다. eBPF 기반 성능도 성능이지만, MetalLB·kube-proxy 없이 로드밸런싱과 외부 노출(BGP)까지 한 번에 해결된다는 점이 결정적이었다.

## 1. 개요

CNI(Container Network Interface)는 쿠버네티스에서 파드 간 네트워크 연결, IP 할당, 네트워크 정책 적용을 담당하는 구성 요소다. 클러스터를 굴리려면 반드시 하나는 골라야 하는데, 무엇을 고르느냐에 따라 네트워크로 할 수 있는 일의 범위가 꽤 달라진다.

## 2. 선정 배경

단순히 파드끼리만 통신하면 된다면 Flannel로 5분 만에 끝낼 수 있는 일이다. 하지만 이번엔 욕심이 좀 더 있었다. 네트워크 성능, 보안 정책, 그리고 클러스터 밖에서 Pod IP나 Service IP로 직접 접근하는 것까지가 목표였다. 결국 "파드 통신 + α"를 얼마나 깔끔하게 소화하느냐가 선정 기준이 됐다.

## 3. 비교

후보는 세 가지로 좁혔다. 각각의 성격이 꽤 뚜렷하다.

| CNI 구현체 | 성격 | 이번 요구사항 관점에서 |
| --- | --- | --- |
| Calico | 네트워크 정책과 BGP 라우팅에 강점 | 정책·라우팅은 훌륭하지만 L7 가시성이나 kube-proxy 대체까지는 범위 밖 |
| Flannel | 가장 단순한 오버레이 네트워크 | 설정은 제일 쉽다. 딱 파드 통신까지. 외부 노출·정책은 직접 챙겨야 함 |
| Cilium | eBPF 기반 네트워킹·보안·가시성 | 위 요구사항 대부분을 자체 기능으로 커버. 대신 학습 곡선이 가파름 |

### 1. Calico

Calico는 네트워크 정책(Network Policy)과 확장성에서 평이 좋은 CNI다. 기본 동작은 IPIP/VXLAN 오버레이지만, BGP 모드로 전환하면 라우터와 직접 라우팅 정보를 주고받을 수 있다는 점이 매력이다. 정책 중심의 보안이 중요한 환경이라면 1순위로 둘 만하다. 다만 이번에 원했던 L7 가시성이나 kube-proxy 대체는 Calico의 주 무대가 아니었다.

### 2. Flannel

Flannel은 후보 중 설정이 가장 단순하다. 오버레이 네트워크로 파드 통신만 붙여주면 끝이라, 처음엔 "그냥 이걸로 빨리 갈까" 싶을 만큼 끌렸다. 하지만 정확히 그 단순함이 한계다. 네트워크 정책, 외부 노출, 성능 최적화는 전부 별도로 손대야 한다. 요구사항이 늘어난 이번 케이스와는 결이 맞지 않았다.

### 3. Cilium

Cilium은 리눅스 커널의 eBPF(extended Berkeley Packet Filter)를 활용하는 CNI다. 패킷 처리를 커널 레벨에서 하기 때문에 성능 이점이 있고, 네트워크 정책부터 서비스 메시, 가시성까지 한 스택에 담고 있다. 앞의 요구사항을 하나씩 따로 풀지 않고 대부분 Cilium 안에서 해결할 수 있다는 게 가장 큰 그림이었다.

## 4. 선정 사유

결국 Cilium을 골랐다. 결정에 크게 작용한 지점들은 이렇다.

### 1. eBPF 기반 패킷 처리

Cilium은 패킷 처리를 커널 레벨의 eBPF로 수행한다. eBPF는 커널 안에서 샌드박스된 프로그램을 돌리는 기술이라, `iptables`나 `ipvs` 기반 방식보다 빠르고 유연하게 네트워크 정책 적용과 로드 밸런싱을 처리할 수 있다. 대규모 클러스터일수록 이 차이가 벌어진다는 점에서, 개인적으로 가장 끌린 부분이기도 했다.

### 2. MetalLB 없이 LoadBalancer 서비스 노출

온프레미스에서 `LoadBalancer` 타입 서비스를 쓰려면 보통 MetalLB 같은 별도 솔루션을 얹어야 한다. Cilium은 이걸 자체 BGP/L2 모드로 대신한다. 구성 요소 하나를 통째로 덜어낼 수 있다는 뜻이라, 온프레미스 환경에선 특히 반가운 기능이다.

### 3. kube-proxy 제거

Cilium은 `kube-proxy`를 완전히 걷어내고 그 역할(서비스 로드 밸런싱)을 eBPF로 대체할 수 있다. `kube-proxy`가 관리하던 `iptables`/`ipvs` 규칙은 클러스터가 커질수록 성능 병목이 되기 쉬운데, 이 스택 자체가 사라지니 네트워크 경로가 한층 단순해진다. 운영 관점에선 "관리할 컴포넌트가 하나 줄었다"는 게 사실 제일 크다.

### 4. Envoy 기반 서비스 메시

Cilium은 Envoy 프록시를 통해 L7(애플리케이션 계층) 정책, 트래픽 관리, 가시성 같은 서비스 메시 기능을 제공한다. Istio 같은 별도 메시를 도입하지 않고도 필요한 만큼의 이점을 챙길 수 있어, 지금 규모에선 이 정도가 적당하다고 봤다.

### 5. Hubble을 통한 네트워크 가시성

Cilium은 Hubble이라는 가시성 도구를 함께 제공한다. Hubble UI로 네트워크 흐름, 정책 적용 상태, 서비스 간 통신 지연을 눈으로 볼 수 있다. 네트워크 문제는 "어디서 막혔는지"를 찾는 게 절반인데, 흐름이 그림으로 보이면 트러블슈팅 속도가 확실히 달라진다.

### 6. Gateway API 연계

Cilium은 Gateway API와 연동된다. Gateway API는 Ingress의 뒤를 잇는 표준으로, 트래픽 관리를 더 유연하게 다룰 수 있게 해준다. 당장 전면 도입할 계획은 아니지만, 나중에 Ingress에서 넘어갈 여지를 열어둔다는 의미가 있다.

### 7. BGP를 통한 외부 네트워크 연동

Cilium은 BGP를 지원해서 클러스터 외부 네트워크 장비와 라우팅 정보를 교환할 수 있다. 사내에서 쓰는 UTM 장비(FortiGate)와 BGP로 연동하면, 클러스터 내부의 파드·서비스 IP 대역을 외부 네트워크에 동적으로 광고(Advertising)할 수 있다. NAT나 복잡한 라우팅 규칙 없이 외부에서 파드·서비스 IP로 바로 접근할 수 있다는 뜻이다.

> [!NOTE]
> 왜 L2(ARP)가 아니라 BGP였을까?
> 외부 서비스를 노출하는 방식은 크게 L2와 L3(BGP) 두 가지다.
> - <b>L2 방식</b>: 특정 노드가 "그 IP는 저에게 보내세요"라고 ARP(Address Resolution Protocol) 요청에 응답하는 식이다. 문제는 ARP가 동일한 L2 도메인 안에서만 유효하다는 점이다. 라우터를 넘어 다른 서브넷까지는 경로가 전파되지 않는다.
> - <b>L3(BGP) 방식</b>: BGP는 라우터끼리 쓰는 프로토콜이다. Cilium이 FortiGate 같은 외부 라우터와 연동하면 "이 IP 대역으로 가려면 우리 클러스터로 보내"라고 경로 자체를 알려준다. 라우터가 이 정보를 다시 전파하므로, 서브넷이 다른 클라이언트도 파드·서비스 IP로 통신할 수 있다. 우리 환경은 클러스터와 클라이언트가 같은 L2에 있지 않아, 애초에 BGP 말고는 선택지가 없었다.

## 참고
- [Cilium 공식 문서](https://docs.cilium.io/)
- [eBPF.io](https://ebpf.io/)
- [Kubernetes CNI 개념](https://kubernetes.io/docs/concepts/extend-kubernetes/compute-storage-net/network-plugins/)