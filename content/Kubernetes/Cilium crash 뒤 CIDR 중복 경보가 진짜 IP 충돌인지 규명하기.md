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
> Cilium이 crash 뒤 자동복구되지 않고 수동 rollout이 반복적으로 필요했다. 동시에 노드 두 대가 같은 PodCIDR(`10.42.4.0/22`)을 들고 있다는 경보가 떴다. CiliumNode CR에는 실제로 중복이 찍혀 있었지만, 살아있는 파드 IP를 전수 대조하니 충돌하는 주소가 한 쌍도 없었다. 이 버전(v1.17.4)엔 옛 중복 CIDR 버그(#21482)도 이미 수정돼 있었다. 결국 중복은 CRD 메타데이터만 낡은 <b>cosmetic</b> 문제였고, 자동복구 실패의 원인은 control plane(etcd·API server) 불안정이었다. IPAM을 갈아엎는 대신 control plane 모니터링을 강화하는 것으로 끝냈다.

## 1. 환경

- Kubernetes 클러스터, 노드 11대(마스터 3, 워커 8)
- CNI: Cilium v1.17.4, 데이터패스 veth, 터널 vxlan
- IPAM 모드: `cluster-pool` (operator가 클러스터 풀에서 노드별 PodCIDR을 잘라주는 방식)
- 클러스터 풀 `10.42.0.0/16`, 노드당 `/22` (이하 IP·노드명은 전부 가상값)
- 노드 네트워크는 `10.0.0.0/16`로 파드 대역과 겹치지 않음

## 2. 이슈

Cilium이 crash한 뒤 데이터패스가 스스로 정상으로 돌아오지 않았다. 파드는 뜨는데 통신이 군데군데 끊기고, 손으로 `rollout restart`를 걸어야 겨우 살아났다. 그것도 한 번이 아니라 반복적으로.

여기에 경보가 하나 더 붙었다. <b>노드간 PodCIDR 중복 취득</b>. 노드 두 대(`store-13`, `store-14`)가 같은 `10.42.4.0/22`를 할당받았다는 내용이었다. IPAM 관점에서 이게 사실이면 꽤 심각하다. 두 노드가 같은 파드 대역에서 IP를 나눠주면 주소가 겹치고, 그 순간부터 라우팅이 조용히 썩기 시작한다.

문제는 두 증상이 같이 뜨니 인과가 헷갈린다는 거였다. "CIDR이 겹쳐서 네트워크가 crash에서 못 살아나는 건가?" 싶었다. 그렇게 믿고 IPAM 풀을 다시 잡거나 노드를 CIDR째 재발급하는 쪽으로 갔으면 며칠짜리 대공사에 다운타임까지 났을 거다. 그래서 손대기 전에 이 경보가 진짜 IP 충돌을 말하는 건지부터 확인하기로 했다.

## 3. 해결

### 1. 중복 경보가 실제 충돌인가

`cluster-pool` 모드에서 노드별 PodCIDR은 `CiliumNode` 커스텀 리소스의 `spec.ipam.podCIDRs`에 적힌다. operator가 여기에 노드별 대역을 기록하고, 각 노드 agent는 그 대역 안에서 파드 IP를 나눠준다. 그러니 경보가 뭘 근거로 겹쳤다고 하는지부터 봐야 했다.

```bash
# 노드별로 CiliumNode CR에 기록된 PodCIDR을 나열한다.
kubectl get ciliumnodes \
  -o custom-columns=NAME:.metadata.name,PODCIDR:.spec.ipam.podCIDRs
```

경보는 거짓말이 아니었다. `store-13`과 `store-14`가 CR 상으로 진짜 둘 다 `10.42.4.0/22`를 들고 있었다. 여기까지만 보면 "그럼 진짜 충돌 아닌가" 싶다. 하지만 CR 필드는 <b>기록된 배정</b>이지 지금 이 순간 나눠준 IP가 아니다. 실제로 부딪히는 파드가 있어야 진짜 사고다. 그래서 살아있는 파드 IP를 전부 긁어 같은 주소가 두 노드에 걸쳐 나오는지 봤다.

```bash
# 실행 중인 파드의 IP와 소속 노드를 모아, 동일 IP가 두 노드에 중복으로
# 잡히는 경우가 있는지 확인한다.
kubectl get pods -A -o wide \
  --field-selector status.phase=Running \
  | awk '{print $7, $8}' | sort | uniq -c | sort -rn | head
```

결과가 흥미로웠다. `store-13`과 `store-14`의 파드는 정말로 둘 다 `10.42.4.x`~`10.42.7.x`, 즉 문제의 `/22` 안에서 IP를 받고 있었다. 그런데 <b>같은 IP를 쥔 파드는 한 쌍도 없었다</b>. `store-13`은 `10.42.4.76`·`10.42.5.193`·`10.42.7.64`를, `store-14`는 `10.42.4.216`·`10.42.6.65`·`10.42.7.177`을 쓰는 식으로, 같은 대역을 공유하면서도 개별 주소는 깔끔하게 갈려 있었다.

결국 노드별 대역을 적어둔 CR 필드는 겹쳐 있어도, 실제로 IP를 나눠주는 operator 내부 allocator는 겹치지 않게 잘 세고 있었다. operator 메모리 안의 할당 상태가 실제 출처였고, 그쪽은 멀쩡했다.

> [!NOTE]
> IPAM 경보는 "무엇을 근거로 겹쳤다고 말하는가"를 먼저 봐야 한다. CR의 `podCIDRs`는 기록이고, 실제 사고는 같은 IP를 쥔 파드가 두 개 있을 때 난다. CR 필드가 겹쳐도 실물 IP가 안 겹치면, 중복은 메타데이터에만 남은 낡은 기록이다.

### 2. 알려진 IPAM 버그의 잔재인가

CR에 중복이 찍혀 있다는 건 사실이니, 이게 Cilium의 알려진 IPAM 버그인지도 확인해야 했다. `cluster-pool` operator가 중복 CIDR을 발급하던 <b>#21482</b>가 떠올랐다. 그런데 이 버그는 v1.10~v1.12 계열 얘기고, 이 중복 발급을 잡은 <b>PR #21526</b>이 v1.13.0부터 들어갔다. 지금 쓰는 v1.17.4엔 당연히 포함돼 있다. 즉 발급 로직 자체가 중복을 만드는 그 고전 버그는 이 버전엔 없다.

그럼 CR엔 왜 중복이 남았나. `store-13`의 `CiliumNode`를 뜯어보니 답이 나왔다. `creationTimestamp`가 초기 클러스터 구성 시점이 아니라 며칠 전으로, `bootid`도 바뀌어 있었다. 노드가 한 번 재생성된 흔적이었다. 재생성 과정에서 operator가 이 노드에 대역을 다시 기록하는데, 이때 `store-14`가 이미 쓰던 `/22`가 CR 필드에 그대로 눌러앉았다. operator의 내부 allocator는 재수렴하면서 실제 IP는 겹치지 않게 유지했지만, `CiliumNode` CRD의 `spec` 텍스트만 낡은 값으로 남은 것이다. control plane이 출렁일 때 이 CRD 동기화가 어긋나면 충분히 생길 수 있는 그림이다.

> [!INFO]
> 곁다리로 `store-14` CR엔 `unable to allocate CIDR [fd00::700/120]` 류의 IPv6 할당 에러도 찍혀 있었다. IPv6를 안 쓰는 환경인데 CRD에 IPv6 CIDR 잔재가 남아 나던 에러라, IPv4 통신엔 영향이 없었다. 이런 것까지 세면 "경보"는 여러 개인데, 실제로 트래픽을 아프게 하는 건 하나도 없었다.

### 3. cluster-pool 모드는 CIDR을 어떻게 나누나

착시가 왜 생기는지는 이 모드의 동작을 알면 납득이 된다. `cluster-pool`에서 노드 CIDR을 발급하는 주체는 <b>cilium-operator 하나</b>다. operator가 클러스터 풀(`10.42.0.0/16`)을 노드 단위 `/22`로 쪼개 노드가 붙을 때마다 배정하고 `CiliumNode` CR에 적는다. 발급자가 하나이니 정상 상태에서 두 노드가 같은 대역을 받을 일은 원칙적으로 없다.

여기서 헷갈리기 딱 좋은 함정이 하나 더 있다. 쿠버네티스에도 `Node.spec.podCIDR`이라는 필드가 있는데, `cluster-pool`에서는 <b>Cilium이 이 값을 아예 참조하지 않는다</b>. 실제로 대조해보면 두 값이 서로 다르다.

```text
노드         K8s Node.spec.podCIDR    CiliumNode.spec.ipam.podCIDRs
store-13     10.42.20.0/22            10.42.4.0/22   ← 서로 다름
store-14     10.42.16.0/22            10.42.4.0/22   ← 다름 + 중복
```

이 불일치를 처음 보면 "동기화가 깨졌다"고 오해하기 쉽지만, `cluster-pool` 모드에선 이게 정상이다. 쿠버네티스 컨트롤러가 매기는 `podCIDR`은 무시하고 Cilium operator가 독립적으로 대역을 관리하도록 설계돼 있기 때문이다. 그러니 K8s 쪽 값과 안 맞는다고 손댈 일이 아니다. 이런 배경을 모르면 "중복" 경보에 "불일치"까지 겹쳐 보이면서 상황이 실제보다 훨씬 심각하게 읽힌다.

발급 자체는 멀쩡했다. 꼬여 보이던 건 관측(중복 CR 필드, K8s와의 불일치, IPv6 잔재)이고, crash라는 소란 속에서 만들어진 착시였다. 실제 double allocation이 났다면 operator가 나눠준 IP에서 충돌이 보였을 텐데, 거긴 조용했다.

### 4. 그럼 자동복구는 왜 안 됐나

CIDR이 범인이 아니라면 crash에서 못 살아난 이유는 따로 있다. 로그를 되짚으니 crash 전후로 control plane이 같이 흔들렸다. API server가 `etcd failed: reason withheld`를 뱉으며 일시 장애를 겪었고, 그 사이 cilium-operator가 재시작·리더 재선출을 돌았다. 네트워크 상태를 재동기화하는 이 과정에서 데이터패스가 어정쩡한 상태로 굳어버렸다.

그럼 그동안 손으로 걸던 `rollout restart`는 왜 먹혔나. CIDR을 고쳐서가 아니었다. operator·agent가 새로 뜨면서 routing table을 다시 깔고 control plane과의 통신을 회복하니 네트워크가 정상으로 돌아온 것뿐이다. 재기동 뒤에도 `CiliumNode` CR의 중복 필드는 그대로 남아 있었다. rollout은 증상(끊긴 통신)을 걷어냈지, 경보(중복 CIDR)를 고친 건 아니었다. 둘은 애초에 다른 문제였다.

crash에서 자동으로 안 낫는 것 자체도 어느 정도는 의도된 동작이다. API server가 잠깐 죽어도 각 노드의 Cilium agent는 기존 데이터패스를 유지하도록 돼 있어서, control plane이 출렁일 때 파드가 죽지 않는다. 대신 control plane이 오래 불안정하면 상태가 낡은 채로 굳고, 쿠버네티스의 자가 치유(파드 재시작)는 "죽지 않고 떠는" 이 상태를 고장으로 보지 않으니 발동하지 않는다. 그냥 두면 알아서 안 낫는 종류였다.

### 5. 고친 것과 그냥 둔 것

할 일이 명확해졌다.

- <b>CIDR 중복은 그냥 뒀다.</b> cosmetic 메타데이터라 실제 IP 할당·라우팅엔 영향이 없고, 재생성됐던 노드가 향후 교체되면 자연히 정리된다. 굳이 지금 `CiliumNode`를 지웠다 다시 만드는 건 멀쩡한 걸 건드리는 리스크만 진다.
- <b>조치는 control plane 쪽</b>이었다. etcd 클러스터 상태와 API server 가용성 모니터링·알림을 붙여 근본 원인인 불안정을 먼저 잡기로 했다. cilium-operator는 이미 replica 2로 HA가 잡혀 있어 여기는 추가로 손댈 게 없었다.

원래 의심하던 IPAM 풀 재설계나 노드 CIDR 재발급은 하나도 하지 않았다. 경보가 가리키던 곳이 아니라 아픈 곳을 고쳤을 뿐이다.

> [!INFO]- 중복 감지 스크립트 (선택)
> 굳이 중복 자체를 추적하고 싶다면 CR 필드만 주기적으로 훑어 경보를 내는 정도면 충분하다. 자동 remediation(중복 노드 CR 삭제)까지 넣고 싶은 유혹이 있는데, cosmetic 문제에 자동 삭제를 걸면 오히려 멀쩡한 노드를 흔든다. 프로덕션에선 감지까지만 두고 조치는 수동 승인으로 남겨두는 편이 낫다.
> ```bash
> # CiliumNode CR에서 같은 PodCIDR을 든 노드가 있는지만 감지한다.
> kubectl get ciliumnodes \
>   -o jsonpath='{range .items[*]}{.spec.ipam.podCIDRs[0]}{"\n"}{end}' \
>   | sort | uniq -d
> ```

## 4. 확인

가장 확실한 검증은 결국 실제 IP가 안 겹치는지다. 1번에서 봤던 대로 살아있는 파드 IP를 다시 긁어 같은 주소가 두 노드에 나오지 않는지 대조했다. 그다음 Cilium 자체 상태를 봤다.

```bash
# agent 파드 안에서 Cilium의 종합 상태와 IPAM 할당 현황을 확인한다.
POD=$(kubectl -n kube-system get pod -l k8s-app=cilium \
  -o jsonpath='{.items[0].metadata.name}')
kubectl -n kube-system exec "$POD" -c cilium-agent -- \
  cilium-dbg status --all-addresses
```

`cilium-dbg status`가 KVStore·Kubernetes·데이터패스를 전부 OK로 보고하고, IPAM 섹션의 할당 IP가 노드 대역 안에서 정상 카운트되면 됐다. 파드 통신을 몇 개 실제로 걸어 끊김이 없는지도 확인했다. `CiliumNode` CR의 중복 필드는 여전히 남아 있었지만, 그건 애초에 고칠 대상이 아니었으니 문제가 아니다.

경보 두 개 중 하나(중복 CIDR)는 손댈 필요조차 없는 낡은 메타데이터였다. 그걸 확인하는 데 든 명령은 몇 줄이었고, 그 몇 줄이 IPAM 재설계라는 헛수고를 막았다.

## 참고

- [Cilium — Cluster Scope (Default) IPAM](https://docs.cilium.io/en/stable/network/concepts/ipam/cluster-pool/)
- [Cilium — IPAM 개요](https://docs.cilium.io/en/stable/network/concepts/ipam/)
- [Cilium — Troubleshooting](https://docs.cilium.io/en/stable/operations/troubleshooting/)
- [Issue #21482 — cluster-pool operator handing out duplicate CIDRs](https://github.com/cilium/cilium/issues/21482) (v1.13.0+에서 수정, 지금 버전엔 해당 없음)
- [PR #21526 — operator가 죽은 사이 노드가 붙을 때 생기던 중복 PodCIDR 할당 수정](https://github.com/cilium/cilium/pull/21526)
- [[CNI 구현체 선정]] — 이 클러스터가 Cilium을 쓰게 된 배경
