---
title: Fortigate로 SSH 포트포워딩 브루트포스 차단하기 (VIP·정책 순서의 함정)
date: 2025-04-18
draft: false
tags:
  - fortigate
  - network-security
  - ssh
  - brute-force
  - troubleshooting
banner: 
cssclasses: 
description: 본사 서버가 느려진 원인이 SSH 무차별 대입 공격이었고, Fortigate에서 대역을 차단하려다 VIP와 정책 순서 때문에 두 번 헛발질한 기록.
permalink: 
aliases: 
completed: true
type:
  - issue
---

## 🚀 요약

> [!SUMMARY]
> 본사 서버가 느려지고 SSH가 잘 안 붙는다는 제보를 받아 `btmp`와 Fortigate `diagnose sniffer`로 특정 해외 대역의 SSH 무차별 대입 공격을 확인했다. 인바운드 정책에서 국가·서브넷을 차단하려 했는데, 차단 규칙을 허용 규칙보다 <b>순서상 위</b>에 두고, 포트포워딩(VIP) 트래픽은 destination을 `all`이 아니라 <b>VIP 정책</b>으로 지정해야 실제로 막혔다.

## ⚙️ 환경

- Fortigate (인바운드 정책 + Virtual IP 포트포워딩 구성)
- 본사 애플리케이션 서버 `app-01` (SSH를 공인 IP의 비표준 포트로 포트포워딩 중)
- 공인 IP `203.0.113.35`, 외부 노출 포트 `39022` → 내부 `app-01:22`로 DNAT

## 💬 이슈

"본사 `app-01` 서버가 느려지고 SSH도 잘 안 붙는다"는 제보를 받았다. 처음엔 서버 부하 문제인 줄 알았는데, 로그인 실패 로그부터 봤더니 그림이 달라졌다.

```bash
# 로그인 실패 시도를 실시간으로 본다. btmp에는 실패한 접속 기록이 쌓인다.
tail -f /var/log/btmp
```

특정 해외 대역에서 SSH 계정을 갈아 끼우며 무차별로 접속을 때리고 있었다. 서버가 느려진 건 부하 문제가 아니라 이 무차별 대입(brute force) 시도가 SSH 데몬과 네트워크를 갉아먹고 있어서였다.

문제는 이 SSH가 공인 IP의 비표준 포트(`39022`)로 열려 있었다는 점이다. 포트를 바꿔둔다고 안 걸리는 게 아니라, 스캐너는 그냥 열린 포트를 전수로 훑는다. 결국 방화벽 단에서 공격 대역 자체를 끊어야 했다.

## 🧗 해결

### 1. 공격 트래픽 특정

먼저 어디서 오는지부터 정확히 봤다. Fortigate GUI에서는 <b>FortiView → Sources</b>의 `Traffic From WAN` 탭으로 외부에서 들어오는 소스 IP를 정렬해봤고, CLI에서는 sniffer로 해당 포트만 필터링했다.

```bash
# 인터페이스 무관, 39022 포트 트래픽만 캡처. 마지막 인자 a는 사람이 읽는 형식으로 출력.
diagnose sniffer packet any 'port 39022' 4 0 a
```

소스가 특정 해외 국가 2곳과, 그중 유독 집요하게 때리던 `198.51.100.0/24` 서브넷으로 좁혀졌다. 이걸 인바운드에서 끊기로 했다.

### 2. 인바운드 차단 규칙 추가

Fortigate에서 국가(Geo) 오브젝트와 서브넷 주소 오브젝트를 만들어, 이들을 source로 하는 <b>deny 정책</b>을 WAN 인바운드에 넣었다. 여기까지는 평범하다. 그런데 넣고 나서도 `btmp`에 실패 로그가 계속 쌓였다. 차단이 안 먹은 것이다. 여기서 두 가지 함정에 걸렸다.

### 3. 함정 하나: 정책 평가 순서

Fortigate는 방화벽 정책을 <b>위에서 아래로 순차 평가</b>하다가 처음 매칭되는 규칙에서 멈춘다. 정책 ID 숫자가 작다고 먼저 적용되는 게 아니다. GUI 목록에 보이는 <b>순서</b>가 곧 평가 순서다.

내가 만든 deny 정책이 기존 허용(allow) 정책보다 <b>아래</b>에 있었다. 그러니 공격 트래픽이 위쪽 허용 정책에 먼저 매칭돼 통과하고, 아래의 deny까지 도달하지 못했다. deny 규칙을 해당 허용 규칙보다 위로 끌어올리자 그제야 평가 순서상 먼저 걸렸다.

> [!IMPORTANT]
> 차단 규칙은 그걸 무력화하는 허용 규칙보다 반드시 <b>순서상 위</b>에 둬야 한다. 정책 ID(번호)가 아니라 목록에서의 위치가 기준이다. 이거 하나로 한참 헤맸다.

### 4. 함정 둘: VIP(DNAT) 트래픽의 destination

순서를 고쳤는데도 SSH 대역은 여전히 뚫렸다. 이유는 이 SSH가 <b>Virtual IP(VIP)</b>를 통한 포트포워딩, 즉 Destination NAT였기 때문이다.

Fortigate에서 포트포워딩은 `Policy & Objects → Virtual IPs`에서 외부 IP·포트를 내부로 매핑하는 VIP 오브젝트를 만들고, 이 VIP를 정책의 <b>destination</b>에 지정해야 성립한다. 방화벽은 인바운드 정책을 평가할 때, 이 VIP 트래픽의 목적지를 일반 `all`이 아니라 <b>그 VIP 오브젝트</b>로 인식한다.

내가 처음 만든 deny 정책은 destination이 `all`이었다. VIP를 거쳐 들어오는 SSH 트래픽은 `all`에 매칭되지 않아 이 규칙을 그냥 지나쳤고, 뒤이어 VIP를 destination으로 가진 허용 정책에 걸려 통과했다. deny 정책의 destination을 `all`에서 해당 <b>VIP 정책(오브젝트)</b>으로 바꾸고, 순서도 허용 정책 위에 두자 그제야 공격 트래픽이 실제로 drop되기 시작했다.

정리하면 차단이 먹으려면 두 조건을 동시에 만족해야 했다.

- deny 정책이 허용 정책보다 순서상 <b>위</b>에 있을 것
- 포트포워딩 트래픽 차단이면 destination을 `all`이 아니라 <b>VIP 오브젝트</b>로 지정할 것

## ✅ 확인

차단 직후 다시 `btmp`를 봤다. 해당 대역발 실패 로그가 더는 쌓이지 않았다.

```bash
# 차단 이후로 공격 대역의 새 실패 시도가 멈췄는지 확인.
tail -f /var/log/btmp
```

sniffer로도 재차 봤다. 차단한 서브넷에서 `39022`로 들어오던 패킷이 사라졌고, 서버 응답 속도도 원래대로 돌아왔다.

```bash
# 차단 대역 소스 IP를 필터로 걸어 더는 들어오지 않는지 확인.
diagnose sniffer packet any 'src net 198.51.100.0/24 and port 39022' 4 0 a
```

정책 자체는 처음부터 있었다. 순서와 destination 두 군데를 동시에 맞추기 전까지는 "규칙은 넣었는데 왜 안 막히지"만 반복했을 뿐이다.

## 🔗 참고

- [FortiGate Firewall policies (정책 평가 순서)](https://docs.fortinet.com/document/fortigate/7.4.0/administration-guide/954635/firewall-policies)
- [FortiGate Virtual IPs (DNAT·포트포워딩)](https://docs.fortinet.com/document/fortigate/7.4.0/administration-guide/948208/virtual-ips)
- [FortiGate Using the packet sniffer](https://docs.fortinet.com/document/fortigate/7.4.0/administration-guide/566442/using-the-packet-sniffer)
