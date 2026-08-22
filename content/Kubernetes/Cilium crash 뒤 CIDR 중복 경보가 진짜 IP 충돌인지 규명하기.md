---
title: Cilium crash 뒤 CIDR 중복 경보가 진짜 IP 충돌인지 규명하기
date: 2025-10-02
draft: false
tags:
  - kubernetes
  - cilium
  - cni
  - ipam
  - troubleshooting
banner: 
cssclasses: 
description: Cilium이 crash에서 스스로 못 살아나고 노드 두 대가 같은 PodCIDR을 들고 있다는 경보까지 떴을 때, 그게 진짜 IP 충돌인지 메타데이터 노이즈인지 따져보고 IPAM 대공사를 접은 기록.
permalink: 
aliases: 
completed: true
type:
  - issue
---

## 요약

> [!SUMMARY]
> Cilium이 crash 후 자동 복구되지 않아 수동 rollout이 반복적으로 필요했다. 동시에 노드 두 대가 같은 PodCIDR(`10.42.4.0/22`)을 보유하고 있다는 경보도 발생했다. CiliumNode CR에는 실제로 중복이 기록되어 있었지만, 실행 중인 파드 IP를 전수 대조하니 충돌하는 주소는 한 쌍도 없었다. 이 버전(v1.17.4)에는 과거 중복 CIDR 버그(#21482)에 대한 수정도 이미 포함되어 있었다. 결국 중복은 CRD 메타데이터만 오래된 <b>cosmetic</b> 문제였고, 자동 복구 실패의 원인은 control plane(etcd·API server) 불안정이었다. IPAM을 재설계하는 대신 control plane 모니터링을 강화하는 것으로 마무리했다.

## 1. 환경

- Kubernetes 클러스터, 노드 11대(마스터 3, 워커 8)
- CNI: Cilium v1.17.4, 데이터패스 veth, 터널 vxlan
- IPAM 모드: `cluster-pool` (operator가 클러스터 풀에서 노드별 PodCIDR을 잘라주는 방식)
- 클러스터 풀 `10.42.0.0/16`, 노드당 `/22` (이하 IP·노드명은 전부 가상값)
- 노드 네트워크는 `10.0.0.0/16`로 파드 대역과 겹치지 않음

## 2. 이슈

Cilium이 crash된 뒤 데이터패스가 스스로 정상으로 돌아오지 않았다. 파드는 시작되지만 통신이 부분적으로 끊기고, 수동으로 `rollout restart`를 실행해야 겨우 복구되었다. 그것도 한 번이 아니라 반복적이었다.

여기에 경보가 하나 더 발생했다. <b>노드 간 PodCIDR 중복 취득</b>이다. 노드 두 대(`store-13`, `store-14`)가 같은 `10.42.4.0/22`를 할당받았다는 내용이었다. IPAM 관점에서 이것이 사실이라면 상당히 심각하다. 두 노드가 같은 파드 대역에서 IP를 할당하면 주소가 겹치고, 그 순간부터 라우팅이 조용히 망가지기 시작한다.

문제는 두 증상이 동시에 나타나니 인과 관계가 헷갈린다는 점이었다. "CIDR이 겹쳐서 네트워크가 crash에서 복구되지 못하는 것인가"라는 의문이 들었다. 그렇게 판단하고 IPAM 풀을 다시 구성하거나 노드 CIDR을 재발급하는 방향으로 진행했다면 며칠 규모의 작업과 다운타임까지 감수했을 것이다. 그래서 수정에 앞서 이 경보가 진짜 IP 충돌을 의미하는 것인지부터 확인하기로 했다.

## 3. 해결

### 1. 중복 경보가 실제 충돌인가

`cluster-pool` 모드에서 노드별 PodCIDR은 `CiliumNode` 커스텀 리소스의 `spec.ipam.podCIDRs`에 기록된다. operator가 여기에 노드별 대역을 기록하고, 각 노드 agent는 그 대역 안에서 파드 IP를 할당한다. 그러므로 경보가 무엇을 근거로 중복이라고 판단했는지부터 확인해야 했다.

```bash
# 노드별로 CiliumNode CR에 기록된 PodCIDR을 나열한다.
kubectl get ciliumnodes \
  -o custom-columns=NAME:.metadata.name,PODCIDR:.spec.ipam.podCIDRs
```

경보 내용은 사실이었다. `store-13`과 `store-14`가 CR 상으로 실제로 모두 `10.42.4.0/22`를 보유하고 있었다. 여기까지만 보면 "그렇다면 진짜 충돌 아닌가" 싶다. 하지만 CR 필드는 <b>기록된 배정</b>일 뿐 지금 이 순간 할당한 IP가 아니다. 실제로 충돌하는 파드가 존재해야 진짜 장애다. 그래서 실행 중인 파드 IP를 전부 수집하여 같은 주소가 두 노드에 걸쳐 나타나는지 확인했다.

```bash
# 실행 중인 파드의 IP와 소속 노드를 모아, 동일 IP가 두 노드에 중복으로
# 잡히는 경우가 있는지 확인한다.
kubectl get pods -A -o wide \
  --field-selector status.phase=Running \
  | awk '{print $7, $8}' | sort | uniq -c | sort -rn | head
```

결과는 흥미로웠다. `store-13`과 `store-14`의 파드는 실제로 모두 `10.42.4.x`~`10.42.7.x`, 즉 문제의 `/22` 안에서 IP를 받고 있었다. 그런데 <b>같은 IP를 사용하는 파드는 한 쌍도 없었다</b>. `store-13`은 `10.42.4.76`·`10.42.5.193`·`10.42.7.64`를, `store-14`는 `10.42.4.216`·`10.42.6.65`·`10.42.7.177`을 사용하는 방식으로, 같은 대역을 공유하면서도 개별 주소는 깔끔하게 나뉘어 있었다.

결국 노드별 대역을 기록한 CR 필드는 겹쳐 있어도, 실제로 IP를 할당하는 operator 내부 allocator는 중복이 생기지 않도록 정확하게 관리하고 있었다. operator 메모리 안의 할당 상태가 실제 출처였고, 그 부분은 정상이었다.

> [!NOTE]
> IPAM 경보에서는 "무엇을 근거로 중복이라고 판단했는가"를 먼저 확인해야 한다. CR의 `podCIDRs`는 기록일 뿐이고, 실제 장애는 같은 IP를 사용하는 파드가 두 개 존재할 때 발생한다. CR 필드가 겹쳐도 실제 IP가 겹치지 않으면, 그 중복은 메타데이터에만 남은 오래된 기록이다.

### 2. 알려진 IPAM 버그의 잔재인가

CR에 중복이 기록되어 있다는 것은 사실이므로, 이것이 Cilium의 알려진 IPAM 버그인지도 확인해야 했다. `cluster-pool` operator가 중복 CIDR을 발급하던 <b>#21482</b>가 떠올랐다. 그런데 이 버그는 v1.10~v1.12 계열의 문제였고, 이 중복 발급을 수정한 <b>PR #21526</b>은 v1.13.0부터 포함되었다. 현재 사용 중인 v1.17.4에는 당연히 포함되어 있다. 즉 발급 로직 자체가 중복을 만드는 그 고전 버그는 이 버전에는 존재하지 않는다.

그렇다면 CR에는 왜 중복이 남았을까. `store-13`의 `CiliumNode`를 분석하니 답이 나왔다. `creationTimestamp`가 초기 클러스터 구성 시점이 아니라 며칠 전이고, `bootid`도 변경되어 있었다. 노드가 한 번 재생성된 흔적이었다. 재생성 과정에서 operator가 이 노드에 대역을 다시 기록하는데, 이때 `store-14`가 이미 사용하던 `/22`가 CR 필드에 그대로 남게 되었다. operator의 내부 allocator는 재수렴하면서 실제 IP가 겹치지 않도록 유지했지만, `CiliumNode` CRD의 `spec` 텍스트만 오래된 값으로 남은 것이다. control plane이 불안정할 때 이 CRD 동기화가 어긋나면 충분히 발생할 수 있는 상황이다.

> [!INFO]
> 덧붙여 `store-14` CR에는 `unable to allocate CIDR [fd00::700/120]` 류의 IPv6 할당 에러도 기록되어 있었다. IPv6를 사용하지 않는 환경인데 CRD에 IPv6 CIDR 잔재가 남아 발생하던 에러라서, IPv4 통신에는 영향이 없었다. 이것까지 세면 "경보"는 여러 개지만, 실제로 트래픽에 영향을 준 것은 하나도 없었다.

### 3. cluster-pool 모드는 CIDR을 어떻게 나누나

착시가 왜 생기는지는 이 모드의 동작을 알면 납득할 수 있다. `cluster-pool`에서 노드 CIDR을 발급하는 주체는 <b>cilium-operator 하나</b>다. operator가 클러스터 풀(`10.42.0.0/16`)을 노드 단위 `/22`로 분할하여 노드가 추가될 때마다 배정하고 `CiliumNode` CR에 기록한다. 발급자가 하나이므로 정상 상태에서 두 노드가 같은 대역을 받을 일은 원칙적으로 없다.

여기서 헷갈리기 쉬운 함정이 하나 더 있다. 쿠버네티스에도 `Node.spec.podCIDR`이라는 필드가 있는데, `cluster-pool` 모드에서는 <b>Cilium이 이 값을 아예 참조하지 않는다</b>. 실제로 대조해 보면 두 값이 서로 다르다.

```text
노드         K8s Node.spec.podCIDR    CiliumNode.spec.ipam.podCIDRs
store-13     10.42.20.0/22            10.42.4.0/22   ← 서로 다름
store-14     10.42.16.0/22            10.42.4.0/22   ← 다름 + 중복
```

이 불일치를 처음 보면 "동기화가 깨졌다"고 오해하기 쉽지만, `cluster-pool` 모드에서는 이것이 정상이다. 쿠버네티스 컨트롤러가 부여하는 `podCIDR`을 무시하고 Cilium operator가 독립적으로 대역을 관리하도록 설계되어 있기 때문이다. 그러므로 K8s 쪽 값과 일치하지 않는다고 해서 수정할 대상이 아니다. 이런 배경을 모르면 "중복" 경보에 "불일치"까지 겹쳐 보이면서 상황이 실제보다 훨씬 심각하게 읽힌다.

발급 자체는 정상이었다. 복잡해 보였던 것은 관측(중복 CR 필드, K8s와의 불일치, IPv6 잔재)이었고, crash라는 혼란 속에서 만들어진 착시였다. 실제 double allocation이 발생했다면 operator가 할당한 IP에서 충돌이 나타났을 것이지만, 그 부분에는 문제가 없었다.

### 4. 그럼 자동복구는 왜 안 됐나

CIDR이 원인이 아니라면 crash에서 복구되지 못한 이유는 따로 있다. 로그를 다시 확인하니 crash 전후로 control plane이 함께 불안정했다. API server가 `etcd failed: reason withheld`를 출력하며 일시 장애를 겪었고, 그 사이 cilium-operator가 재시작·리더 재선출을 거쳤다. 네트워크 상태를 재동기화하는 이 과정에서 데이터패스가 불완전한 상태로 고정되었다.

그렇다면 그동안 수동으로 실행하던 `rollout restart`는 왜 효과가 있었을까. CIDR을 수정했기 때문이 아니었다. operator·agent가 새로 시작되면서 routing table을 다시 구성하고 control plane과의 통신을 회복하니 네트워크가 정상으로 돌아온 것뿐이다. 재기동 후에도 `CiliumNode` CR의 중복 필드는 그대로 남아 있었다. rollout은 증상(끊긴 통신)을 해소했을 뿐, 경보(중복 CIDR)를 수정한 것이 아니었다. 둘은 애초에 다른 문제였다.

crash에서 자동으로 복구되지 않는 것 자체도 어느 정도는 의도된 동작이다. API server가 잠시 중단되어도 각 노드의 Cilium agent는 기존 데이터패스를 유지하도록 설계되어 있어서, control plane이 불안정할 때 파드가 종료되지 않는다. 대신 control plane이 오래 불안정하면 상태가 오래된 채로 고정되고, 쿠버네티스의 자가 치유(파드 재시작)는 "종료되지 않고 불안정한" 이 상태를 고장으로 인식하지 않으므로 발동하지 않는다. 방치하면 스스로 복구되지 않는 종류의 문제였다.

### 5. 고친 것과 그냥 둔 것

할 일이 명확해졌다.

- <b>CIDR 중복은 그대로 두었다.</b> cosmetic 메타데이터이므로 실제 IP 할당·라우팅에는 영향이 없고, 재생성되었던 노드가 향후 교체되면 자연히 정리된다. 굳이 지금 `CiliumNode`를 삭제했다가 다시 생성하는 것은 정상 상태를 건드리는 리스크만 감수하는 행동이다.
- <b>조치는 control plane 쪽</b>이었다. etcd 클러스터 상태와 API server 가용성 모니터링·알림을 붙여 근본 원인인 불안정을 먼저 잡기로 했다. cilium-operator는 이미 replica 2로 HA가 잡혀 있어 여기는 추가로 손댈 게 없었다.

처음에 의심했던 IPAM 풀 재설계나 노드 CIDR 재발급은 하나도 수행하지 않았다. 경보가 가리키던 곳이 아니라 실제로 문제가 있는 곳을 수정했을 뿐이다.

> [!INFO]- 중복 감지 스크립트 (선택)
> 굳이 중복 자체를 추적하고 싶다면 CR 필드만 주기적으로 확인하여 경보를 발생시키는 정도로도 충분하다. 자동 remediation(중복 노드 CR 삭제)까지 넣고 싶어질 수 있는데, cosmetic 문제에 자동 삭제를 적용하면 오히려 정상적인 노드까지 영향을 받게 된다. 프로덕션 환경에서는 감지까지만 구성하고 조치는 수동 승인으로 남겨 두는 편이 안전하다.
> ```bash
> # CiliumNode CR에서 같은 PodCIDR을 든 노드가 있는지만 감지한다.
> kubectl get ciliumnodes \
>   -o jsonpath='{range .items[*]}{.spec.ipam.podCIDRs[0]}{"\n"}{end}' \
>   | sort | uniq -d
> ```

## 4. 확인

가장 확실한 검증은 결국 실제 IP가 겹치지 않는지 확인하는 것이다. 앞서 살펴본 방식으로 실행 중인 파드 IP를 다시 수집하여 같은 주소가 두 노드에 나타나지 않는지 대조했다. 그다음 Cilium 자체의 상태를 점검했다.

```bash
# agent 파드 안에서 Cilium의 종합 상태와 IPAM 할당 현황을 확인한다.
POD=$(kubectl -n kube-system get pod -l k8s-app=cilium \
  -o jsonpath='{.items[0].metadata.name}')
kubectl -n kube-system exec "$POD" -c cilium-agent -- \
  cilium-dbg status --all-addresses
```

`cilium-dbg status`가 KVStore·Kubernetes·데이터패스를 모두 OK로 보고하고, IPAM 섹션의 할당 IP가 노드 대역 안에서 정상적으로 집계되면 통과한다. 파드 통신을 몇 개 실제로 구성하여 끊김이 없는지도 확인했다. `CiliumNode` CR의 중복 필드는 여전히 남아 있었지만, 그것은 애초에 수정할 대상이 아니었으므로 문제가 아니다.

경보 두 개 중 하나(중복 CIDR)는 손댈 필요조차 없는 오래된 메타데이터였다. 이를 확인하는 데 사용한 명령은 몇 줄이었고, 그 몇 줄이 IPAM 재설계라는 불필요한 작업을 막았다.

## 참고

- [Cilium — Cluster Scope (Default) IPAM](https://docs.cilium.io/en/stable/network/concepts/ipam/cluster-pool/)
- [Cilium — IPAM 개요](https://docs.cilium.io/en/stable/network/concepts/ipam/)
- [Cilium — Troubleshooting](https://docs.cilium.io/en/stable/operations/troubleshooting/)
- [Issue #21482 — cluster-pool operator handing out duplicate CIDRs](https://github.com/cilium/cilium/issues/21482) (v1.13.0+에서 수정, 지금 버전엔 해당 없음)
- [PR #21526 — operator가 죽은 사이 노드가 붙을 때 생기던 중복 PodCIDR 할당 수정](https://github.com/cilium/cilium/pull/21526)
- [[CNI 구현체 선정]] — 이 클러스터가 Cilium을 쓰게 된 배경
