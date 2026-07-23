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

## 🚀 요약

> [!SUMMARY]
> KubeVirt VM에 고정 IP를 주고 오피스망에서 직접 접근하려고 VXLAN 세컨더리 네트워크를 깔았다. 게이트웨이 노드에 Proxy ARP와 정책 라우팅을 얹어 외부 경로를 냈는데, 외부에서 VM으로 SSH를 하면 요청은 도달하는데 응답이 안 왔다. VM의 default route가 파드 네트워크(eth0)로 향해 세컨더리(eth1)로 들어온 트래픽의 응답이 엉뚱한 인터페이스로 나가는 비대칭 라우팅이 원인이었고, 여기에 노드 간 VXLAN FDB 누락까지 겹쳐 있었다. VM 쪽 정책 라우팅과 FDB 자동 등록으로 정리했다.

## 💡 개요

KubeVirt VM은 기본적으로 쿠버네티스 파드 네트워크(우린 Cilium)만 붙이고 나온다. 그래서 VM 주소는 파드 IP고, 재스케줄링되면 바뀐다. 밖에서 직접 들어올 방법도 없다. 대략 이런 그림이다.

```
[VM] --pod network--> [Pod IP] --NAT--> [Node] --NAT--> [External]
```

이번에 필요했던 건 반대였다.

- VM마다 <b>고정 IP</b>를 주고 재시작해도 유지될 것
- 클러스터 노드에서 그 IP로 바로 붙을 것
- 오피스망(클러스터 밖)에서도 그 IP로 붙을 것

결국 파드 네트워크와 별개로 <b>세컨더리 네트워크</b> 인터페이스를 하나 더 달아야 한다는 뜻이다. Primary는 Cilium 그대로 두고, Secondary는 <b>Multus CNI</b>로 VXLAN 오버레이를 붙이기로 했다. 오버레이 대역은 `10.10.100.0/24`로 잡았다.

## 1. 전체 구조

밖에서 안까지 경로를 먼저 그려두면 이렇다.

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

노드는 여러 대인데 VM은 아무 노드에나 뜬다. 그러니 이 오버레이 대역은 특정 노드에 묶이지 않고 클러스터 전체에 걸쳐 하나의 L2처럼 보여야 한다. VXLAN을 고른 이유가 그거다.

## 2. VXLAN 브릿지 인터페이스

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

## 3. NAD와 고정 IP

Multus가 VM에 세컨더리 인터페이스를 붙이려면 `NetworkAttachmentDefinition`(NAD)이 있어야 한다. 브릿지 CNI로 `br-vmnet`에 물리고, IPAM은 `static`으로 뒀다. 주소를 IPAM이 굴리는 게 아니라 VM별로 내가 박겠다는 뜻이다.

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

여기서 한 번 삽질했다. config 안의 `name` 필드(`vmnet`)가 NAD의 `metadata.name`과 다르면 CNI가 조용히 오작동한다. 에러도 안 뱉고 인터페이스만 안 붙는 종류라 원인 찾는 데 시간을 꽤 썼다. 둘을 똑같이 맞추는 게 전제 조건이다.

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

이 시점에서 같은 노드에 뜬 VM끼리는 `10.10.100.x`로 서로 핑이 됐다. 그런데 다른 노드의 VM으로는 안 갔다. 이 얘기는 뒤에서 다시 한다.

## 4. 게이트웨이 노드: Proxy ARP와 정책 라우팅

오피스망에서 `10.10.100.0/24`로 들어오게 하려면 이 대역을 대신 받아줄 노드가 필요하다. 노드 한 대를 게이트웨이로 정하고 세 가지를 걸었다.

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

여기에 오피스망 라우터에도 `10.10.100.0/24`의 다음 홉을 이 게이트웨이 노드로 잡는 static route를 넣었다(라우터 설정은 장비마다 다르다). 이제 밖에서 VM 주소로 패킷을 쏘면 게이트웨이 노드까지는 온다.

## 5. 요청은 가는데 응답이 안 온다

구성이 다 됐다 싶어 오피스망 노트북에서 VM으로 SSH를 걸었다. 그런데 멈춰버렸다. 게이트웨이 노드에서 `tcpdump`를 떠보니 요청 SYN은 VM까지 잘 도착한다. VM 안에서도 SYN이 들어오는 게 보인다. 그런데 응답(SYN-ACK)이 밖으로 안 나온다. 정확히는 <b>비대칭 라우팅</b>(asymmetric routing)이었다.

VM에는 인터페이스가 둘이다. `eth0`은 파드 네트워크, `eth1`이 VXLAN 세컨더리다. 그리고 VM의 default route는 `eth0`을 향한다. 그러니 `eth1`으로 들어온 SSH 요청에 응답할 때, VM은 목적지(오피스망)를 라우팅 테이블에서 찾다가 default route를 타고 응답을 `eth0`으로 내보낸다. 들어온 문과 나가는 문이 다른 것이다. 그 응답은 파드 네트워크로 새어나가 오피스망에 닿지 못하거나 리버스 패스 필터에 걸려 버려진다.

고치는 방법은 "eth1로 들어온 흐름의 응답은 eth1로 내보내라"고 못박는 거다. VM 안에서 정책 라우팅을 걸었다.

```bash
# VM 내부 — 세컨더리 대역에서 나가는 트래픽은 전용 테이블을 태운다
ip rule add from 10.10.100.10 table 200
ip route add default via 10.10.100.1 dev eth1 table 200
```

이렇게 하면 세컨더리 IP를 소스로 하는 응답은 table 200을 타고 `eth1` → 브릿지 게이트웨이(`10.10.100.1`)로 나간다. VM의 원래 default route(파드 네트워크)는 건드리지 않는다. 이 설정은 cloud-init에 넣어 VM이 뜰 때 자동으로 걸리게 했다. 넣고 나니 SSH가 붙었다.

## 6. 다른 노드의 VM만 안 되는 문제

앞에서 미뤄둔 얘기. 같은 노드 VM끼리는 되는데 다른 노드 VM으로는 통신이 안 됐다. VXLAN 오버레이인데 왜 노드를 넘으면 끊기나.

VXLAN은 오버레이 프레임을 상대 노드의 <b>VTEP</b>(VXLAN Tunnel Endpoint)로 UDP 캡슐화해 보낸다. 문제는 "이 MAC은 어느 노드로 보내야 하나"를 알아야 한다는 거다. 그게 <b>FDB</b>(Forwarding Database)다. 우리 구성엔 각 노드의 VXLAN 인터페이스에 다른 노드 VTEP이 등록돼 있지 않았다. 그러니 같은 노드(로컬 브릿지) 안에서는 되고, 노드를 넘어가는 순간 보낼 곳을 몰라 조용히 버려졌다.

각 노드의 FDB에 나머지 노드 IP를 브로드캐스트 엔트리로 등록해줬다. 노드가 추가·삭제될 때마다 손으로 하면 반드시 빠뜨리니, 이것도 DaemonSet으로 주기적으로 맞추게 했다.

```bash
# 각 노드에서 — 자기를 뺀 나머지 노드 IP를 VTEP으로 FDB에 등록
LOCAL_IP=$(hostname -I | awk '{print $1}')
kubectl get nodes \
  -o jsonpath='{.items[*].status.addresses[?(@.type=="InternalIP")].address}' | \
  tr ' ' '\n' | grep -v "$LOCAL_IP" | while read NODE_IP; do
    bridge fdb add 00:00:00:00:00:00 dev vxlan100 dst "$NODE_IP" 2>/dev/null || true
done
```

`00:00:00:00:00:00`은 "모르는 목적지는 이 VTEP들로 다 뿌려라"는 브로드캐스트/언노운 유니캐스트용 엔트리다. 이걸 노드 수만큼 깔아두면 오버레이 안에서 서로를 찾아간다. 11대짜리 클러스터라면 노드마다 10개 엔트리가 잡히는 게 정상이다.

## ✅ 확인

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

같은 노드든 다른 노드든 VM에 붙고, 오피스망에서도 고정 IP로 SSH가 붙으면 끝이다. 고정 IP를 줬어도 사람이 외울 주소는 아니라, 이후엔 VM 레코드를 DNS에 올려 이름으로 접근하게 했다.

돌아보면 설계 자체는 그림 몇 개로 끝나는데, 실제로 시간을 잡아먹은 건 "요청은 가는데 응답이 안 온다"였다. 패킷이 어느 인터페이스로 들어와 어디로 나가는지를 눈으로 따라가기 전까지는 감이 안 왔다. 세컨더리 인터페이스를 붙일 땐 IP만 주면 되는 게 아니라 응답이 나갈 문까지 정해줘야 한다는 걸, 이번에 몸으로 배웠다.

## 🔗 참고

- [Multus CNI](https://github.com/k8snetworkplumbingwg/multus-cni)
- [KubeVirt — Interfaces and Networks](https://kubevirt.io/user-guide/network/interfaces_and_networks/)
- [CNI bridge plugin](https://www.cni.dev/plugins/current/main/bridge/)
- [ip-rule(8) — 정책 라우팅](https://man7.org/linux/man-pages/man8/ip-rule.8.html)
- [bridge(8) — FDB 관리](https://man7.org/linux/man-pages/man8/bridge.8.html)
- [[재기동·노드 이동에도 유지되는 KubeVirt VM 고정 IP|같은 VM의 고정 IP 유지 설계]]
- [[흩어진 KubeVirt·Multus 매니페스트를 기능별 단일 트리로 통합]]
