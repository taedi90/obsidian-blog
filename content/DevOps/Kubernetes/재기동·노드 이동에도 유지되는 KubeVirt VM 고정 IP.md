---
title: 재기동·노드 이동에도 유지되는 KubeVirt VM 고정 IP (Multus Static IPAM)
date: 2025-10-16
draft: false
featured: true
tags:
  - kubernetes
  - kubevirt
  - multus
  - cni
  - networking
  - static-ipam
banner: 
cssclasses: 
description: VM을 재기동할 때마다 secondary IP가 바뀌던 문제를, KubeVirt의 업스트림 제약을 확인하고 Multus Static IPAM으로 우회해 노드 위치와 무관한 고정 IP로 수렴시킨 구성 기록.
permalink: 
aliases: 
completed: true
type:
  - architecture
---

## 🚀 요약

> [!SUMMARY]
> KubeVirt VM에 붙인 secondary IP가 재기동할 때마다 바뀌는 게 문제였다. Pod 애노테이션으로 IP를 고정하려 했지만 KubeVirt가 VM을 launcher 파드로 넘길 때 `ips` 필드를 지워버려서 먹히지 않았다. 결국 VXLAN 브리지로 노드 간 L2를 확장하고, 그 위에 Multus NAD를 VM별로 하나씩 두면서 <b>Static IPAM</b>으로 주소를 NAD에 박아두는 쪽으로 우회했다. IP가 파드가 아니라 선언(NAD)에 묶이니, VM을 껐다 켜거나 다른 노드로 옮겨도 같은 주소를 유지한다.

## 💡 개요

앞서 [[kubevirt-setting|KubeVirt로 오프라인 테스트 환경 만들기]] 글 끝에 "고정 IP 할당은 실패했다, Multus 쓰면 된다는데 복잡해서 접었다"고 적어뒀다. 그 접어둔 걸 다시 폈다.

KubeVirt VM은 실제로는 특수한 파드(virt-launcher) 안에서 돌아간다. 그래서 기본 네트워크는 파드 네트워크를 그대로 받는데, 파드 IP는 파드가 다시 뜨면 바뀐다. VM 입장에서 `virtctl stop` 후 `start`를 하면 launcher 파드가 새로 뜨고, 그때마다 secondary IP도 딸려 바뀌었다. (재부팅은 좀 다르다. VM 안에서 `init 6`로 게스트만 재부팅하면 파드는 그대로라 IP도 안 바뀐다. 문제가 되는 건 파드 자체가 재생성되는 경우다.)

VM을 다른 VM이나 외부에서 <b>고정된 주소로 계속 찾아야 하는</b> 용도라면 이건 곤란하다. IP가 바뀔 때마다 붙는 쪽 설정을 고쳐야 하니까. 그래서 "재기동을 하든, VM이 다른 노드로 스케줄되든 항상 같은 IP"라는 조건을 만족시키고 싶었다.

## 📋 선정 배경

요구사항은 세 줄로 정리됐다.

- VM을 껐다 켜도(=launcher 파드 재생성) secondary IP가 유지될 것
- VM이 어느 노드로 스케줄되든 같은 IP가 그대로 붙을 것 (노드 위치 무관)
- 구성이 선언적이라 IaC로 그대로 재현될 것

제약도 있었다. 클러스터 CNI는 <b>Cilium</b>이고, secondary 네트워크는 <b>Multus</b>로 얹는 구조다. Cilium 위에 Multus를 태우려면 Cilium이 CNI를 독점하지 않도록 `cni.exclusive: false`를 꺼줘야 하고, NAD의 `type`으로 쓰는 플러그인 바이너리가 각 노드의 `/opt/cni/bin`에 실제로 있어야 한다.

> [!NOTE]
> `cni.exclusive`를 안 끄면 Cilium이 `/etc/cni/net.d`를 자기 것만 남기고 정리해버려서 Multus 체인이 통째로 무시된다. Multus를 얹는데 secondary 인터페이스가 아예 안 생긴다면 여기부터 의심하는 게 빠르다. 그리고 `bridge`, `static` 같은 플러그인은 [containernetworking/plugins](https://github.com/containernetworking/plugins)에서 받아 `/opt/cni/bin`에 깔아둬야 한다.

## 📊 비교

고정 IP를 만드는 방법을 순서대로 시도했다. 결과부터 표로.

| 시도 | 방식 | 결과 |
| --- | --- | --- |
| 기본 IPAM (host-local/DHCP) | NAD에 IPAM만 걸고 IP는 자동 할당 | 재기동마다 IP 변동. 애초에 고정이 목적이 아님 |
| Pod 애노테이션 `ips` 요청 | `k8s.v1.cni.cncf.io/networks`에 원하는 IP를 명시 | KubeVirt가 launcher 파드로 넘길 때 `ips` 필드를 제거 → 무시됨 |
| NAD에 Static IPAM | 주소를 NAD 안에 직접 박고, VM별로 NAD를 하나씩 | 고정 IP 유지. 채택 |

가운데 줄이 이 글의 핵심 삽질이다. Multus로 secondary 네트워크에 특정 IP를 요청하는 정석은, 파드(여기선 VM 템플릿)에 이런 애노테이션을 다는 것이다.

```yaml
# 정석대로라면 이렇게 networkName과 ips를 함께 요청한다.
# 하지만 KubeVirt VM에서는 ips가 무시된다.
annotations:
  k8s.v1.cni.cncf.io/networks: |
    [{ "name": "vm-fixed", "namespace": "vm", "ips": ["10.20.30.11/24"] }]
```

일반 파드였으면 이걸로 끝이다. 그런데 VM에 걸면 요청한 IP가 안 잡혔다. 한참 헤매다 확인한 건, KubeVirt가 VM 스펙을 실제 launcher 파드 스펙으로 변환하면서 이 네트워크 요청의 <b>`ips` 필드를 떼어낸다</b>는 점이다. VM의 네트워크는 KubeVirt가 자체적으로 관리하는 영역이라, 파드 레벨에서 IP를 지정해 넣는 이 경로를 그대로 통과시켜주지 않는다. 업스트림 동작이 그래서, 내 설정이 틀린 게 아니라 이 경로 자체가 VM에는 막혀 있던 거였다. (설정을 스무 번쯤 고쳐본 뒤에야 "내 문제가 아니구나"를 받아들였다.)

그러면 IP를 파드가 아니라 <b>NAD 자체</b>에 박아두면 된다. 요청하는 주체가 사라지니 떼일 필드도 없다. Static IPAM이 딱 그 용도다.

## ✅ 선정 사유

정리된 구성은 이렇다. 노드 위에 VXLAN 브리지를 깔아 L2를 확장하고, 그 브리지를 쓰는 Multus NAD를 VM마다 하나씩 만들되 IPAM은 static으로 고정한다.

### 1. VXLAN 브리지로 노드 간 L2 확장

노드 위치와 무관하게 같은 IP가 붙으려면, 그 IP가 사는 L2 세그먼트가 노드 하나에 갇혀 있으면 안 된다. 그래서 각 노드에 VXLAN 인터페이스를 만들고 리눅스 브리지(`br-vxlan0`)에 물려, 모든 노드가 같은 오버레이 L2를 공유하게 했다. VM이 어느 노드에 스케줄되든 이 브리지에 붙기만 하면 같은 대역 안에서 통신한다. (이 부분은 노드 프로비저닝 단계에서 한 번 깔아두는 밑작업이다.)

### 2. VM별 NAD에 Static IPAM

브리지가 준비됐으면 그 위에 NAD를 얹는다. `type`은 `bridge`로 이 VXLAN 브리지를 가리키고, `ipam`은 `static`으로 줄 주소를 직접 적는다. 고정하고 싶은 VM마다 이런 NAD를 하나씩 둔다.

```yaml
# VM 한 대에 대응하는 고정 IP용 NAD.
# bridge 플러그인이 노드의 br-vxlan0(=VXLAN 오버레이)에 인터페이스를 붙이고,
# static IPAM이 이 주소를 그대로 부여한다. IP가 파드가 아니라 이 선언에 묶인다.
apiVersion: k8s.cni.cncf.io/v1
kind: NetworkAttachmentDefinition
metadata:
  name: vm-fixed-master-01
  namespace: vm
spec:
  config: |
    {
      "cniVersion": "0.3.1",
      "type": "bridge",
      "bridge": "br-vxlan0",
      "ipam": {
        "type": "static",
        "addresses": [
          { "address": "10.20.30.11/24", "gateway": "10.20.30.1" }
        ]
      }
    }
```

Static IPAM은 NAD 하나당 주소가 고정이라, VM별로 다른 IP를 주려면 NAD도 그만큼 만들어야 한다. 파드 오토스케일 같은 데는 안 맞지만, "정해진 몇 대의 VM에 정해진 주소"라는 이 상황엔 오히려 단순해서 좋았다. NAD가 곧 IP 대장 역할을 한다.

### 3. VM에 secondary로 붙이기

VM 템플릿에서는 기본 파드 네트워크는 그대로 두고(외부 egress·클러스터 통신용), 위 NAD를 secondary 인터페이스로 추가한다.

```yaml
# 기본(default)은 파드 네트워크, fixed가 위에서 만든 고정 IP용 secondary.
spec:
  template:
    spec:
      domain:
        devices:
          interfaces:
            - name: default
              masquerade: {}
            - name: fixed
              bridge: {}
      networks:
        - name: default
          pod: {}
        - name: fixed
          multus:
            networkName: vm/vm-fixed-master-01
```

이렇게 하면 IP를 결정하는 게 launcher 파드의 수명이 아니라 NAD라는 선언이 된다. `virtctl stop`/`start`로 파드가 새로 떠도, 스케줄러가 VM을 다른 노드에 올려도, 붙는 NAD가 같으면 IP도 같다. 요구했던 세 조건이 다 여기서 나온다. 처음엔 그럴듯해 보였던 Pod 애노테이션 경로를 버리고 NAD로 옮긴 게 IaC와도 잘 맞았다. VM 정의와 NAD 정의를 같이 커밋해두면 클러스터를 다시 세워도 주소 배치가 그대로 재현된다.

한계도 분명하다. VM 대수만큼 NAD가 늘고, 주소를 사람이 직접 관리해야 한다. 대수가 크게 늘면 Whereabouts 같은 IPAM으로 넘어가는 게 맞겠지만, 지금 규모에선 눈에 보이는 Static이 관리하기 편했다.

## 🔗 참고

- [KubeVirt — Interfaces and Networks](https://kubevirt.io/user-guide/network/interfaces_and_networks/)
- [KubeVirt Issue #4564 — static ip on multus controlled interface](https://github.com/kubevirt/kubevirt/issues/4564)
- [CNI static IPAM plugin](https://www.cni.dev/plugins/current/ipam/static/)
- [CNI bridge plugin](https://www.cni.dev/plugins/current/main/bridge/)
- [Multus CNI](https://github.com/k8snetworkplumbingwg/multus-cni)
- [[kubevirt-setting|KubeVirt로 오프라인 테스트 환경 만들기]]
- [[VXLAN 세컨더리 네트워크 VM의 외부망 접근 설계와 비대칭 라우팅|같은 VM의 세컨더리 네트워크 외부망 접근 설계]]
