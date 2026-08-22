---
title: VXLAN 세컨더리 네트워크 VM의 외부망 접근 설계와 비대칭 라우팅 트러블슈팅
date: 2025-10-21
draft: false
tags:
  - kubevirt
  - multus
  - vxlan
  - networking
  - policy-routing
  - troubleshooting
banner: 
cssclasses: 
description: KubeVirt VM에 고정 IP와 외부 접근 경로를 붙이려고 VXLAN 세컨더리 네트워크를 설계하다, 요청은 가는데 응답이 안 오는 비대칭 라우팅에 발목 잡힌 기록.
permalink: 
aliases: 
completed: true
type:
  - note
---

## 요약

> [!SUMMARY]
> KubeVirt VM에 고정 IP를 부여하고 오피스망에서 직접 접근하려고 VXLAN 세컨더리 네트워크를 구성했다. 게이트웨이 노드에 Proxy ARP와 정책 라우팅을 설정하여 외부 경로를 만들었는데, 외부에서 VM으로 SSH를 시도하면 요청은 도달하지만 응답이 돌아오지 않았다. VM의 default route가 파드 네트워크(eth0)로 향해 있기 때문에, 세컨더리(eth1)로 들어온 트래픽의 응답이 다른 인터페이스로 나가는 비대칭 라우팅이 원인이었고, 여기에 노드 간 VXLAN FDB 누락까지 겹쳐 있었다. VM 쪽 정책 라우팅과 FDB 자동 등록으로 문제를 해결했다.

## 1. 개요

KubeVirt VM은 기본적으로 쿠버네티스 파드 네트워크(우리 환경에서는 Cilium)만 연결하여 실행한다. 그래서 VM 주소는 파드 IP이고, 재스케줄링되면 주소가 바뀐다. 클러스터 외부에서 직접 접근할 방법도 없다. 전체적인 구조는 대략 다음과 같다.

```
[VM] --pod network--> [Pod IP] --NAT--> [Node] --NAT--> [External]
```

이번 작업에 필요했던 것은 그 반대였다.

- VM마다 <b>고정 IP</b>를 주고 재시작해도 유지될 것
- 클러스터 노드에서 그 IP로 바로 붙을 것
- 오피스망(클러스터 밖)에서도 그 IP로 붙을 것

결국 파드 네트워크와 별개로 <b>세컨더리 네트워크</b> 인터페이스를 하나 더 달아야 한다는 뜻이다. Primary는 Cilium 그대로 두고, Secondary는 <b>Multus CNI</b>로 VXLAN 오버레이를 붙이기로 했다. 오버레이 대역은 `10.10.100.0/24`로 잡았다.

## 2. 전체 구조

클러스터 외부에서 내부까지의 경로를 먼저 정리하면 다음과 같다.

```
[오피스망]
     |
[게이트웨이 노드]  -- Proxy ARP + 정책 라우팅
     |
[VXLAN 오버레이: 10.10.100.0/24]
   /            \
[VM-1]          [VM-2]
10.10.100.10    10.10.100.11
```

노드는 여러 대인데 VM은 어떤 노드에든 배치될 수 있다. 그러므로 이 오버레이 대역은 특정 노드에 묶이지 않고 클러스터 전체에 걸쳐 하나의 L2처럼 보여야 한다. VXLAN을 선택한 이유가 바로 이 때문이다.

## 3. VXLAN 브릿지 인터페이스

모든 노드에 VXLAN 인터페이스(`vxlan100`)와 브릿지(`br-vmnet`)를 만들었다. 노드가 늘어날 걸 감안해 DaemonSet의 initContainer에서 처리하도록 했다. 아래는 노드마다 도는 셋업 스크립트의 핵심 부분이다.

```bash
# VNI 100, UDP 8472로 VXLAN 인터페이스 생성 (local은 자기 노드의 첫 IP)
ip link add vxlan100 type vxlan id 100 dstport 8472 local $(hostname -I | awk '{print $1}')
ip link set vxlan100 up

# 브릿지를 만들어 VXLAN을 물린다
ip link add br-vmnet type bridge
ip link set vxlan100 master br-vmnet
ip link set br-vmnet up

# 브릿지에 게이트웨이 IP를 붙여 VM들의 L2 게이트로 쓴다
ip addr add 10.10.100.1/24 dev br-vmnet 2>/dev/null || true
```

## 4. NAD와 고정 IP

Multus가 VM에 세컨더리 인터페이스를 연결하려면 `NetworkAttachmentDefinition`(NAD)이 필요하다. 브릿지 CNI로 `br-vmnet`에 연결하고, IPAM은 `static`으로 지정했다. 이는 주소를 IPAM이 할당하는 것이 아니라 VM별로 직접 지정하겠다는 의미다.

```yaml
# nad-vmnet.yaml
apiVersion: k8s.cni.cncf.io/v1
kind: NetworkAttachmentDefinition
metadata:
  name: vmnet
  namespace: kubevirt-vms
spec:
  config: |
    {
      "cniVersion": "0.3.1",
      "name": "vmnet",
      "type": "bridge",
      "bridge": "br-vmnet",
      "isGateway": false,
      "isDefaultGateway": false,
      "ipam": { "type": "static" }
    }
```

여기서 한 번 시간을 허비했다. config 안의 `name` 필드(`vmnet`)가 NAD의 `metadata.name`과 다르면 CNI가 별도의 오류 메시지 없이 오작동한다. 에러를 출력하지 않으면서 인터페이스만 연결되지 않는 종류의 문제라서, 원인을 찾는 데 상당한 시간을 소비했다. 두 값을 일치시키는 것이 전제 조건이다.

VM 쪽은 default(파드 네트워크)와 vmnet(세컨더리) 두 개를 붙이고, 세컨더리 IP를 어노테이션으로 고정했다.

```yaml
# kubevirt-vm.yaml (일부)
metadata:
  annotations:
    k8s.v1.cni.cncf.io/networks: |
      [{ "name": "vmnet", "namespace": "kubevirt-vms", "ips": ["10.10.100.10/24"] }]
spec:
  template:
    spec:
      domain:
        devices:
          interfaces:
            - name: default
              masquerade: {}   # Primary: 파드 네트워크
            - name: vmnet
              bridge: {}       # Secondary: VXLAN 네트워크
        networks:
          - name: default
            pod: {}
          - name: vmnet
            multus:
              networkName: vmnet
```

이 시점에서 같은 노드에 배치된 VM끼리는 `10.10.100.x`로 서로 통신이 됐다. 그런데 다른 노드의 VM으로는 접근되지 않았다. 이 문제는 뒤에서 다시 다룬다.

## 5. 게이트웨이 노드: Proxy ARP와 정책 라우팅

오피스망에서 `10.10.100.0/24`로 들어오게 하려면 이 대역을 대신 처리해 줄 노드가 필요하다. 노드 한 대를 게이트웨이로 지정하고 세 가지 설정을 적용했다.

```bash
# 게이트웨이 노드에서 실행

# 오피스망에서 VM IP로 ARP를 쏘면 게이트웨이가 대신 "나야" 하고 응답한다
echo 1 > /proc/sys/net/ipv4/conf/eth0/proxy_arp

# VM 대역에서 나가는 트래픽은 별도 테이블을 태워 오피스망으로 보낸다
ip rule add from 10.10.100.0/24 table 100
ip route add default via <external-gateway-ip> table 100

# 노드가 패킷을 포워딩하도록 허용
echo 1 > /proc/sys/net/ipv4/ip_forward
```

여기에 오피스망 라우터에도 `10.10.100.0/24`의 다음 홉을 이 게이트웨이 노드로 지정하는 static route를 추가했다(라우터 설정은 장비마다 다르다). 이제 외부에서 VM 주소로 패킷을 보내면 게이트웨이 노드까지는 도착한다.

## 6. 요청은 가는데 응답이 안 온다

구성이 완료되었다고 판단하여 오피스망 노트북에서 VM으로 SSH를 시도했다. 그런데 연결이 응답 없이 멈췄다. 게이트웨이 노드에서 `tcpdump`로 확인하니 요청 SYN은 VM까지 정상적으로 도착한다. VM 안에서도 SYN이 들어오는 것을 확인할 수 있다. 그런데 응답(SYN-ACK)이 외부로 나가지 않는다. 정확히는 <b>비대칭 라우팅</b>(asymmetric routing) 문제였다.

VM에는 인터페이스가 두 개다. `eth0`은 파드 네트워크이고, `eth1`은 VXLAN 세컨더리다. 그리고 VM의 default route는 `eth0`을 향한다. 그러므로 `eth1`으로 들어온 SSH 요청에 응답할 때, VM은 목적지(오피스망)를 라우팅 테이블에서 찾다가 default route를 따라 응답을 `eth0`으로 내보낸다. 들어온 경로와 나가는 경로가 다른 것이다. 그 응답은 파드 네트워크로 흘러가 오피스망에 도달하지 못하거나 리버스 패스 필터에 걸려 폐기된다.

해결 방법은 "eth1로 들어온 흐름의 응답은 eth1로 내보낸다"고 명시하는 것이다. VM 안에서 정책 라우팅을 설정했다.

```bash
# VM 내부 — 세컨더리 대역에서 나가는 트래픽은 전용 테이블을 태운다
ip rule add from 10.10.100.10 table 200
ip route add default via 10.10.100.1 dev eth1 table 200
```

이렇게 하면 세컨더리 IP를 소스로 하는 응답은 table 200을 따라 `eth1`을 거쳐 브릿지 게이트웨이(`10.10.100.1`)로 나간다. VM의 원래 default route(파드 네트워크)는 변경하지 않는다. 이 설정은 cloud-init에 넣어 VM이 시작될 때 자동으로 적용되게 했다. 설정 후 SSH 연결이 정상화되었다.

## 7. 다른 노드의 VM만 안 되는 문제

앞에서 미뤄둔 문제를 다룬다. 같은 노드 VM끼리는 통신이 되는데 다른 노드 VM으로는 통신이 안 됐다. VXLAN 오버레이인데 왜 노드를 넘으면 통신이 끊기는가.

VXLAN은 오버레이 프레임을 상대 노드의 <b>VTEP</b>(VXLAN Tunnel Endpoint)로 UDP 캡슐화하여 보낸다. 문제는 "이 MAC은 어느 노드로 보내야 하는가"를 알아야 한다는 점이다. 그 정보를 관리하는 것이 <b>FDB</b>(Forwarding Database)다. 우리 구성에는 각 노드의 VXLAN 인터페이스에 다른 노드 VTEP이 등록되어 있지 않았다. 그러므로 같은 노드(로컬 브릿지) 안에서는 통신이 되고, 노드를 넘어가는 순간 보낼 곳을 알지 못해 패킷이 폐기되었다.

각 노드의 FDB에 나머지 노드 IP를 브로드캐스트 엔트리로 등록했다. 노드가 추가·삭제될 때마다 수동으로 작업하면 반드시 누락되므로, 이 작업도 DaemonSet으로 주기적으로 동기화하게 했다.

```bash
# 각 노드에서 — 자기를 뺀 나머지 노드 IP를 VTEP으로 FDB에 등록
LOCAL_IP=$(hostname -I | awk '{print $1}')
kubectl get nodes \
  -o jsonpath='{.items[*].status.addresses[?(@.type=="InternalIP")].address}' | \
  tr ' ' '\n' | grep -v "$LOCAL_IP" | while read NODE_IP; do
    bridge fdb add 00:00:00:00:00:00 dev vxlan100 dst "$NODE_IP" 2>/dev/null || true
done
```

`00:00:00:00:00:00`은 "알 수 없는 목적지는 이 VTEP들로 모두 전달한다"는 브로드캐스트/언노운 유니캐스트용 엔트리다. 이것을 노드 수만큼 등록해 두면 오버레이 안에서 서로를 찾아간다. 11대 규모의 클러스터라면 노드마다 10개의 엔트리가 등록되는 것이 정상이다.

## 8. 확인

노드 간 오버레이 통신부터 봤다.

```bash
# 다른 노드 VTEP이 FDB에 잡혀 있는지 (노드 수 - 1 만큼 있어야 정상)
bridge fdb show dev vxlan100
```

그다음 실제 접근을 단계별로 확인했다.

```bash
# 노드에서 VM으로 핑·SSH (같은 노드 / 다른 노드 VM 모두)
ping 10.10.100.10
ssh user@10.10.100.10

# 오피스망 노트북에서 게이트웨이 노드를 거쳐 VM으로 SSH
ssh user@10.10.100.10
```

같은 노드든 다른 노드든 VM에 연결되고, 오피스망에서도 고정 IP로 SSH가 연결되면 구성은 완료된다. 고정 IP를 부여했어도 사람이 외우기 쉬운 주소는 아니므로, 이후에는 VM 레코드를 DNS에 등록하여 이름으로 접근하게 했다.

돌아보면 설계 자체는 몇 개의 그림으로 정리되지만, 실제로 시간을 소비한 부분은 "요청은 가는데 응답이 안 온다"는 문제였다. 패킷이 어느 인터페이스로 들어와 어디로 나가는지를 직접 확인하기 전까지는 원인을 파악할 수 없었다. 세컨더리 인터페이스를 연결할 때는 IP만 지정하면 되는 것이 아니라 응답이 나갈 경로까지 지정해야 한다는 점을, 이번 작업에서 직접 확인했다.

## 참고

- [Multus CNI](https://github.com/k8snetworkplumbingwg/multus-cni)
- [KubeVirt — Interfaces and Networks](https://kubevirt.io/user-guide/network/interfaces_and_networks/)
- [CNI bridge plugin](https://www.cni.dev/plugins/current/main/bridge/)
- [ip-rule(8) — 정책 라우팅](https://man7.org/linux/man-pages/man8/ip-rule.8.html)
- [bridge(8) — FDB 관리](https://man7.org/linux/man-pages/man8/bridge.8.html)
- [[재기동·노드 이동에도 유지되는 KubeVirt VM 고정 IP|같은 VM의 고정 IP 유지 설계]]
- [[흩어진 KubeVirt·Multus 매니페스트를 기능별 단일 트리로 통합]]
