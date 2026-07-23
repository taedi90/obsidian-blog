---
title: BGP 라우팅 설정으로 쿠버네티스 네트워크 외부 연동하기
date: 2025-04-09
draft: false
tags:
  - kubernetes
  - bgp
  - cilium
  - fortigate
  - network
banner: 
cssclasses: 
description: 사무실에서 IDC 클러스터의 Pod·서비스 IP로 바로 접근하려고 Fortigate와 Cilium으로 BGP 라우팅을 붙인 기록.
permalink: 
aliases:
completed: 
type:
  - issue
---

## 🚀 요약
> [!SUMMARY]
> Fortigate 간 IPsec 터널 인터페이스에 IP를 할당하고 <b>BGP</b> 피어링을 걸어 Kubernetes의 Pod/Service CIDR를 사무실 네트워크에 광고했다. Cilium의 BGP 기능으로 클러스터 대역이 라우팅 테이블에 자동으로 올라오면서, LoadBalancer나 Ingress 같은 별도 리소스 없이 내부망에서 Pod·서비스 IP에 바로 접근할 수 있었다.

## ⚙️ 환경
- <b>UTM</b>: Fortigate 60E (v5.6.8)
- <b>CNI</b>: Cilium 1.17.4
- <b>Kubernetes</b>: 1.32.6
- <b>네트워크 구성</b>
    - <b>본사</b>: 10.224.64.0/22
    - <b>IDC</b>: 172.16.20.0/24
    - <b>Pod CIDR</b>: 10.10.0.0/16
    - <b>Service CIDR</b>: 10.20.0.0/16

## 💬 이슈
Kubernetes의 Pod·Service 네트워크는 기본적으로 클러스터 내부에서만 접근된다. 외부에서 접근하려면 로드밸런서(LoadBalancer)나 인그레스(Ingress) 같은 리소스를 따로 걸어줘야 한다.

그런데 이번 클러스터는 개발·테스트 성격이 강했다. 개발자들이 Port Forwarding 같은 번거로운 절차 없이 사무실에서 Pod나 Service IP로 바로 붙을 수 있으면 좋겠다 싶었다. 즉 별도 리소스를 만들지 않고도 사무실 PC에서 `curl 10.10.1.23:8080` 한 줄이 그냥 동작하는 것, 그게 목표였다.

## 🧗 해결
사무실 네트워크와 IDC의 Kubernetes 클러스터 네트워크를 잇기 위해 <b>BGP(Border Gateway Protocol)</b>를 쓰기로 했다.

### 1. BGP를 선택한 이유

원래 쓰던 정적 라우팅(Static Routing)은 관리자가 모든 경로를 라우터에 직접 박아 넣는 방식이다. Kubernetes에서는 노드가 늘거나 Pod IP 대역이 바뀔 때마다 라우팅 테이블을 손으로 고쳐야 하는데, 이게 관리 부담도 크고 실수가 끼어들 여지도 많다.

반면 BGP는 동적 라우팅 프로토콜(Dynamic Routing Protocol)이라 라우터끼리 경로 정보를 알아서 주고받는다. Cilium의 BGP 기능을 쓰면 클러스터의 Pod CIDR·Service IP 대역을 Fortigate 라우터에 자동으로 광고(Advertise)할 수 있다. 네트워크가 바뀌어도 수동 개입 없이 라우팅이 갱신되니, 확장성이나 운영 편의 면에서 정적 라우팅과 비교가 안 됐다.

무엇보다 BGP를 잘 몰랐다. 이번 기회에 직접 부딪혀보며 배우고 싶다는 마음이 사실 제일 컸다.

### 2. Fortigate 설정

#### IPsec 터널 인터페이스 IP 할당
먼저 사무실과 IDC를 잇는 IPsec 터널에 BGP 연동용 인터페이스 IP를 할당했다. 이 작업은 GUI에서 되지 않아 CLI로 진행했다.

> [!NOTE]
> Fortigate는 GUI가 편하긴 한데, 세부 네트워크 설정은 결국 CLI로 내려가야 하는 경우가 많다.

- 사무실 Fortigate (`10.100.0.1`)
```shell
# config system interface
    edit "to IDC"
        set ip 10.100.0.1 255.255.255.255
        set allowaccess ping
        set type tunnel
        set remote-ip 10.100.0.2 255.255.255.255
        set interface "wan1"
    next
end
```
`to IDC`라는 이름의 터널 인터페이스에 IP `10.100.0.1`을 할당하는 명령이다.

- IDC Fortigate (`10.100.0.2`)
```shell
# config system interface
	edit "to HQ"
        set ip 10.100.0.2 255.255.255.255
        set allowaccess ping
        set type tunnel
        set remote-ip 10.100.0.1 255.255.255.255
        set interface "wan1"
    next
end
```
IDC 장비에도 똑같이 `to HQ` 터널 인터페이스에 IP `10.100.0.2`를 할당했다.

#### BGP 설정
사설 AS(Autonomous System) 번호는 본사를 `64512`, IDC와 Kubernetes 클러스터를 `64520`으로 잡았다. IDC와 클러스터를 같은 AS로 묶어 그 안은 iBGP, 본사와는 eBGP로 맺는 구성이다.

- IDC Fortigate
```shell
# config router bgp
    set as 64520
    set router-id 10.100.0.2
    config neighbor
        # 본사 Fortigate 와의 eBGP 설정
        edit "10.100.0.1"
            set soft-reconfiguration enable
            set remote-as 64512
            set update-source "to HQ"
        next
    end
    config neighbor-group
        # Kubernetes 노드들과의 iBGP 설정
        edit "sf-peers"
            set remote-as 64520
            set route-reflector-client enable
        next
    end
    config neighbor-range
        # Kubernetes 노드 대역을 neighbor-group 으로 묶어 한번에 처리
        edit 1
            set prefix 172.16.20.0 255.255.255.0
            set neighbor-group "sf-peers"
        next
    end
    config network
        # BGP를 통해 광고할 네트워크 대역 (IDC 로컬 LAN)
        edit 1
            set prefix 172.16.20.0 255.255.255.0
        next
    end
    # 다른 라우팅 프로토콜로부터 경로를 가져와 BGP로 재분배
    config redistribute "connected"
    end
    config redistribute "static"
    end
end
```
IDC Fortigate는 본사 Fortigate와 <b>eBGP</b>, Kubernetes 노드들과는 <b>iBGP</b>로 이웃을 맺는다. 여기서 `route-reflector-client` 옵션을 켠 게 포인트다. iBGP 피어(Kubernetes 노드들)가 서로 Full-Mesh로 연결되지 않아도 IDC Fortigate가 경로를 대신 중계해줘서, 노드가 늘어도 피어 구성이 폭발하지 않는다.

- 본사 Fortigate
```shell
# config router bgp
    set as 64512
    set router-id 10.100.0.1
    config neighbor
        edit "10.100.0.2"
            set soft-reconfiguration enable
            set remote-as 64520
            set update-source "to IDC" # IDC 로 향하는 터널 인터페이스
        next
    end
    config network
        edit 1
            set prefix 10.224.64.0 255.255.252.0
        next
    end
    config redistribute "connected"
    end
    config redistribute "static"
    end
end
```
본사 Fortigate는 IDC Fortigate(`10.100.0.2`)를 BGP 피어로 등록해 경로 정보를 받도록 했다.

### 3. Cilium BGP 설정
Cilium 쪽에서도 BGP를 켜고, Pod·Service 네트워크 정보를 IDC Fortigate로 광고하도록 설정했다. Cilium 1.16부터 BGP 설정이 `CiliumBGPClusterConfig`/`CiliumBGPPeerConfig`/`CiliumBGPAdvertisement`로 쪼개졌는데, 아래는 그 세 리소스다.

- <b>CiliumBGPClusterConfig</b> — 클러스터 전역 BGP 인스턴스와 피어를 정의한다.
```yaml
apiVersion: cilium.io/v2alpha1
kind: CiliumBGPClusterConfig
metadata:
  name: cilium-bgp
spec:
  bgpInstances:
  - localASN: 64520
    name: instance-64520
    peers:
    - name: peer-64520-fortigate
      peerASN: 64520
      peerAddress: 172.16.20.1 # IDC Fortigate의 내부 IP
      peerConfigRef:
        group: cilium.io
        kind: CiliumBGPPeerConfig
        name: cilium-peer
```
클러스터의 `localASN`을 `64520`으로 두고, 같은 AS인 IDC Fortigate(`172.16.20.1`)를 iBGP 피어로 등록했다.

- <b>CiliumBGPPeerConfig</b> — BGP 피어의 상세 옵션을 설정한다.
```yaml
apiVersion: cilium.io/v2alpha1
kind: CiliumBGPPeerConfig
metadata:
  name: cilium-peer
spec:
  families:
  - afi: ipv4
    safi: unicast
  gracefulRestart:
    enabled: true
    restartTimeSeconds: 120
```
IPv4 유니캐스트를 쓰고, BGP 세션이 끊겨도 잠시 기존 경로를 유지하는 `gracefulRestart`를 켰다. 세션이 잠깐 튀었다고 트래픽이 바로 끊기지 않게 하는 안전장치다.

- <b>CiliumBGPAdvertisement</b> — 어떤 대역을 외부에 광고할지 정의한다.
```yaml
apiVersion: cilium.io/v2alpha1
kind: CiliumBGPAdvertisement
metadata:
  name: bgp-advertisements
spec:
  advertisements:
  - advertisementType: PodCIDR
  - advertisementType: Service
    service:
      addresses:
      - ClusterIP
```
이 설정으로 Cilium은 Pod CIDR와 ClusterIP 타입 Service 대역을 BGP로 피어에게 광고한다.

### 4. 방화벽 정책 추가
마지막으로 Fortigate에서 BGP 통신(TCP 179번 포트)과 ICMP가 오갈 수 있도록 방화벽 정책을 추가했다. 특히 내부(LAN)에서 터널 인터페이스로 나가는 방향 정책에서 BGP를 열어주지 않으면 피어링이 아예 안 맺어진다. 여기서 한참 헤맸다.

## ✅ 확인
설정을 끝낸 뒤 BGP 세션 상태와 경로 교환이 제대로 되는지 아래 명령어들로 확인했다. 주로 쓴 것들만 추렸다.

<b>Fortigate에서 BGP 상태 확인</b>
```shell
# IPsec 터널 상태 확인
diagnose vpn ike gateway list

# BGP neighbor 상태 및 수신 경로 확인
get router info bgp neighbors <neighbor_ip> received-routes

# 특정 BGP neighbor 에게 전파한 경로 확인
get router info bgp neighbors <neighbor_ip> advertised-routes

# 라우팅 테이블 전체 확인
get router info routing-table all

# 특정 목적지에 대한 상세 라우팅 경로 확인
get router info routing-table details <destination_network/mask>

# 특정 Pod IP로 패킷 추적
diagnose sniffer packet any 'host <pod_ip>' 4
```
이 중 `received-routes`로 Cilium이 광고한 Pod/Service CIDR가 실제로 넘어왔는지 보는 게 핵심이다.

<b>Kubernetes 노드에서 확인</b>
```shell
# Cilium BGP 피어 세션 상태 확인
cilium bgp peers

# eBPF 로드밸런서에 반영된 서비스 목록 확인
cilium bpf lb list
```
`cilium bgp peers`로 세션이 `established`인지, 광고한 경로 수가 맞는지 확인한다.

## 💡 알게된 사실
Fortigate GUI가 편하긴 해도 세부 설정은 결국 CLI로 내려가야 한다는 걸 다시 느꼈다. 터널 인터페이스 IP 할당은 GUI에 메뉴 자체가 없었다.

iBGP에서는 피어로부터 받은 경로를 다른 iBGP 피어에게 다시 광고하지 않는다. 이걸 몰라서 처음엔 노드끼리 경로가 안 도는 이유를 한참 찾았다. 결국 Fortigate에서 `route-reflector-client`를 켜서 IDC 장비가 <b>Route Reflector</b> 역할을 하도록 만들어 해결했는데, 덕분에 iBGP가 왜 이렇게 동작하는지 몸으로 이해하게 됐다.

그리고 설정을 그때그때 적어두지 않으면 나중에 반드시 고생한다는 걸 또 배웠다. (이 글이 그 증거다.)

## 🔗 참고
- [Fortigate Cookbook: Adding addresses to the tunnel interfaces](https://docs.fortinet.com/document/fortigate/5.6.0/cookbook/115120/adding-addresses-to-the-tunnel-interfaces)
- [Fortigate Admin Guide: Basic BGP example](https://docs.fortinet.com/document/fortigate/7.6.2/administration-guide/763341/basic-bgp-example)
- [Cilium BGP Control Plane](https://docs.cilium.io/en/latest/network/bgp-control-plane/bgp-control-plane/)
