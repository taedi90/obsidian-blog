---
title: Istio 서비스 메시 학습기
date: 2026-04-15
draft: false
tags:
  - istio
  - service-mesh
  - kubernetes
  - envoy
  - mtls
banner: 
cssclasses: 
description: 앱이 떠안던 mTLS·라우팅·인가·복원력·관측을 사이드카가 대신 처리하는 서비스 메시를, OCI k3s에서 운영에 쓰는 기능부터 Ambient까지 직접 재현하며 배운 것. 데이터플레인 원리부터 day-2 트러블슈팅 도구까지.
permalink: 
aliases: 
completed: true
type:
  - note
---

## 요약

> [!SUMMARY]
> 운영 클러스터가 Istio로 해결하던 것들(서비스 간 mTLS·경로 라우팅·인가 위임·타임아웃/재시도)을 그동안 제대로 살펴보지 못했다. 그래서 OCI 단일 노드 k3s에 Istio를 직접 올려 실제 서비스가 사용하는 기능을 하나씩 재현하고, 운영 수준(egress·관측·day-2·Ambient)까지 확장해 보았다. 서비스 메시의 핵심은 앱이 떠안았던 네트워크 로직(암호화·라우팅·인가·복원력·관측)을 사이드카(Envoy)가 트래픽을 가로채서 앱 밖에서 처리하는 것이다.

## 1. 데이터플레인: 사이드카 주입

Istio는 base(CRD) → istiod(컨트롤 플레인) → gateway 순으로 helm 차트 세 개로 설치된다. <b>istiod가 Mutating Webhook으로 Pod에 `istio-proxy`(Envoy)를 주입</b>하며, 그 프록시가 iptables로 파드 트래픽을 전부 가로챈다. 주입 트리거는 네임스페이스 라벨(`istio-injection=enabled`)이다.

주입 방식은 두 가지가 있는데, 여기서 k3s 특유의 문제를 그대로 겪었다.

- <b>init-container 모드(기본)</b> — 주입된 Pod에 `istio-init` 컨테이너가 `NET_ADMIN` 권한으로 iptables 리다이렉트를 설정한다.
- <b>CNI 모드</b> — `istio-cni-node` DaemonSet이 노드 CNI 체인에 끼어 Pod 네트워크 셋업 때 iptables를 설정한다. Pod에 `istio-init`·`NET_ADMIN`이 불필요해 권한을 줄일 수 있다(운영 클러스터가 쓰는 방식).

CNI를 k3s에 적용하면서 겪은 문제는 두 가지였다.

- <b>CNI 바이너리 경로.</b> `cni.cniBinDir` 값은 `/opt/cni/bin`이 아니라 <b>`/var/lib/rancher/k3s/data/cni`</b>여야 한다. k3s containerd가 실제로 탐색하는 경로가 여기이므로, 잘못 지정하면 신규 Pod가 `failed to find plugin "istio-cni"` 오류로 무한 `Init` 상태에 머문다. (오류 메시지의 검색 경로가 정답을 알려 준다.)
- <b>CNI를 켜는 값.</b> istiod에서 CNI 주입을 활성화하는 값은 `istio_cni.enabled`가 아니라 <b>`pilot.cni.enabled: true`</b>다. 엉뚱한 값을 지정하면 `helm get values` 결과에는 반영된 듯 보여도 injector가 실제로 읽는 configmap에는 `False`로 남아 여전히 `istio-init`이 주입된다. <b>injector가 실제로 읽는 값</b>(`istio-sidecar-injector` configmap)을 확인해야 한다.

교훈이 하나 있다. istio-cni는 `chained` 플러그인이라 설치되는 순간부터 <b>모든 Pod sandbox 생성에 관여</b>한다. 그래서 경로 설정이 틀리면 주입 여부와 무관하게 해당 노드의 신규 Pod 생성 자체가 막힌다.

## 2. 트래픽 라우팅: Gateway와 VirtualService

외부 진입은 리스너를 담당하는 <b>Gateway</b>(포트·프로토콜·host, L4~L6)와 L7 규칙을 담당하는 <b>VirtualService</b>(`match.uri` → `rewrite` → `route.destination`)로 나뉜다. Gateway가 외부 접근 경로를 열고, VirtualService가 그 경로에 붙어 "어느 경로를 어느 백엔드로 보낼지"를 결정한다. 운영 클러스터는 백엔드마다 prefix 라우트를 나열하고(`/api/admin/`→admin 서비스 등), rewrite로 접두 부분을 제거해서 백엔드에 넘긴다.

두 가지가 인상 깊었다.

- <b>`gateways: [mesh]`는 인그레스가 아니라 사이드카 간(east-west) 트래픽에 규칙을 건다.</b> `mesh`는 예약어다. 내부 서비스 호출에 타임아웃과 재시도를 적용할 때 이것을 사용한다. `gateways`를 생략하면 기본값이 `mesh`이므로 내부 트래픽에만 규칙이 적용된다.
- <b>TCP passthrough.</b> HTTP가 아닌 raw TCP(MySQL 3306, MongoDB 27017, RabbitMQ 5672 같은 것)도 Gateway에 `protocol: TCP` 포트를 열고 VirtualService의 `tcp.match.port`로 메시 인그레스에 노출할 수 있다. L7 라우팅은 없고 포트 매칭만 된다.

## 3. 복원력: 앱이 짜던 재시도·회로차단을 선언으로

앱 코드에 흩어져 있던 신뢰성 로직을 전부 메시 설정으로 옮길 수 있다는 점이 컸다.

- <b>timeout / retries.</b> `timeout`은 요청 전체 상한이고, `perTryTimeout`은 개별 시도 1회의 상한이다. 먼저 도달하는 상한이 적용된다. `retries.attempts` + `retryOn`(예: `5xx,reset,connect-failure`)으로 재시도한다. 흥미로웠던 점은 <b>재시도가 응답 코드에는 나타나지 않는다</b>는 것이다. 최종 503은 동일하고 기본 stats 트리밍 때문에 카운터에도 잡히지 않는다. <b>서버 측 사이드카 access log</b>에서 "클라이언트 1회 호출 → inbound N건" 형태로 확인해야 한다(attempts=3이면 inbound가 4건 발생한다).
- <b>회로차단.</b> `connectionPool` 상한을 넘는 요청은 즉시 503으로 <b>빠르게 실패</b>시킨다(느린 업스트림이 호출자를 계속 붙잡지 않게 하기 위함이다). `outlierDetection`은 연속으로 5xx를 반환한 인스턴스를 LB 풀에서 일시적으로 배출한다. 두 설정 모두 `DestinationRule.trafficPolicy`에 속한다.
- <b>fault injection / mirror.</b> 지정 비율만큼 인위적 오류와 지연을 주입해서(요청은 업스트림에 도달하지 않고 Envoy가 즉시 반환한다) 재시도와 타임아웃 동작을 검증할 수 있다. `mirror`로 실제 트래픽을 새 버전에 <b>복제(shadow)</b>하여 응답은 폐기하면서 안전하게 시험해 본다.
- <b>카나리.</b> `DestinationRule.subsets`로 버전별 subset을 정의하고, `VirtualService.route[].weight`로 트래픽 비율을 분배한다(v1:80/v2:20). 지표를 관찰하면서 새 버전의 비중을 올려 나간다.

## 4. 보안: mTLS·JWT·외부 인가 위임

서비스 메시를 도입하는 가장 큰 이유 중 하나가 보안인데, 세 겹으로 정리되었다.

- <b>STRICT mTLS.</b> `PeerAuthentication`이 워크로드 사이드카의 <b>inbound mTLS 요구 수준</b>을 결정한다. `STRICT`로 설정하면 mTLS 연결만 받고 평문 연결은 리셋된다(실측: 메시 밖 평문 클라이언트→`000`, 메시 내부 호출은 자동 mTLS로 200). 기본값인 `PERMISSIVE`는 평문도 통과시켜 레거시 호환성을 유지하지만, STRICT로 전환하면 메시 밖 접근이 끊기므로 단계적 전환이 필요하다.
- <b>JWT.</b> 여기서 헷갈리기 쉬운 점이 있다. `RequestAuthentication`은 토큰이 <b>있으면 검증하고 없으면 통과</b>시킨다. 즉, 그것만으로 인증 강제가 아니다. "JWT 필수" 요구사항은 `AuthorizationPolicy`(ALLOW + `requestPrincipals`)로 별도로 구현해야 한다. 실측 결과는 토큰 없음→403(RBAC), 위조→401(검증 실패), 유효→200으로 갈렸다.
- <b>ext_authz(외부 인가 위임).</b> `meshConfig.extensionProviders`에 외부 인증 서버를 등록하고, `AuthorizationPolicy action: CUSTOM`으로 매칭되는 요청을 그 서버에 위임한다. 서버가 2xx를 반환하면 허용하면서 <b>업스트림에 사용자 식별 헤더를 주입</b>하고, 4xx를 반환하면 거부한다. 운영 클러스터는 모든 인증을 내부 admin API에 위임하고, 허용 시 사용자 헤더를 백엔드에 넣어 주기 때문에 <b>백엔드가 자체 인증 코드 없이</b> 그 헤더로 사용자를 식별한다. JWT(표준·무상태·자체검증)와 ext_authz(중앙 위임·동적 정책)는 함께 사용할 수도 있다.

주의할 점이 하나 있다. `AuthorizationPolicy`는 적용 후 사이드카에 반영되기까지 <b>10~15초</b>가 걸린다. 적용 직후에 테스트하면 아직 정책이 적용되지 않아 통과되므로, 충분히 대기한 후에 검증해야 한다.

## 5. EnvoyFilter와 Lua: API로 안 되는 걸 저수준으로

VirtualService·AuthorizationPolicy가 노출하지 않는 Envoy 설정은 <b>EnvoyFilter</b>로 직접 패치한다. `applyTo`(HTTP_FILTER 등) + `match.context`(GATEWAY / SIDECAR_INBOUND / SIDECAR_OUTBOUND) + `patch.operation`(MERGE / INSERT_BEFORE) 조합으로 특정 지점만 수정한다.

- <b>MERGE로 저수준 파라미터를 조정한다.</b> 게이트웨이 HCM에 `stream_idle_timeout`을 MERGE하는 식이다. 장시간 스트리밍(SSE·LLM 응답)은 기본 idle timeout(5분)에 걸려 끊기기 쉬우므로, 운영 클러스터는 이 값을 길게 유지한다. 랩에서는 반대로 3초로 줄여서 idle 스트림이 3초에 끊기는 동작을 확인했다(`/delay/10`→504@3.0s, `/delay/1`→200). 기준이 데이터가 흐르지 않는 idle 상태이므로, 데이터가 계속 흐르면 적용되지 않는다.
- <b>Lua HTTP 필터로 헤더를 주입한다.</b> `envoy.lua`의 `inlineCode`에서 `envoy_on_request`로 헤더를 추가한다. `SIDECAR_OUTBOUND` + 대상 포트 조건으로 특정 호출의 아웃바운드에만 적용할 수 있다(실측: 특정 백엔드 호출에 `x-lua-injected` 헤더 주입을 확인했다). 운영 환경에서는 이런 방식으로 특정 내부 호출에 인증 헤더를 추가한다. 반드시 `router` 필터 앞(INSERT_BEFORE)에 배치해야 라우팅 전에 반영된다.

적용 시 표시되는 `IST0133`("EnvoyFilter는 내부 구현을 노출하므로 업그레이드 시 주의") 경고는 정상적인 안내다. 저수준 설정이라 버전 불일치에 민감하므로, API로 가능한 작업은 API로 처리하고 정말 불가능한 경우에만 EnvoyFilter로 내려간다.

## 6. Egress 통제와 사이드카 스코핑

기본 egress 정책은 <b>ALLOW_ANY</b>(임의 외부 통신 허용)다. 데이터 유출 방지와 컴플라이언스를 위해 <b>REGISTRY_ONLY</b>로 바꾸면 레지스트리에 등록된 대상만 나갈 수 있다(실측: 미등록 도메인→502 BlackHole, `ServiceEntry` 등록 후→200). 여기에 `Sidecar` 리소스로 워크로드가 인지하는 호스트 범위를 제한하면 <b>사고 영향 반경과 사이드카 메모리 사용량</b>이 줄어든다(실측: sleep 사이드카의 cluster 수가 49→27로 감소). 기본값이 전체 메시이므로 클러스터가 커질수록 사이드카 설정도 비례해서 커지는데, 스코핑으로 이 증가를 억제하는 것이다.

## 7. 관측: 골든 시그널이 기본으로 딸려온다

사이드카가 `istio_requests_total`(요청수·코드·src/dst), `istio_request_duration_milliseconds`(지연) 같은 <b>표준 메트릭</b>을 자동으로 노출한다. Prometheus로 스크레이프하고 <b>Kiali</b>로 서비스 그래프·트래픽·헬스를 시각화하면, 트래픽/에러/지연이라는 골든 시그널이 별도 계측 없이 대시보드가 된다. 더 세밀하게는 <b>Telemetry API</b>(CR)로 metrics/tracing/accessLog를 mesh/namespace/workload 범위별로 조절한다(실측: `tagOverrides`로 메트릭에 커스텀 태그를 추가해서 Prometheus 시리즈에 반영했다). 다만 주의할 점이 하나 있다. meshConfig 전역 `accessLogFile`이 설정되어 있으면 Telemetry로 워크로드 로그를 끄려 해도 그 전역 로거는 꺼지지 않는다.

## 8. Day-2: 무중단 업그레이드와 트러블슈팅

운영 환경에서 가장 중요한 과제는 결국 <b>istiod를 어떻게 무중단으로 업그레이드할 것인가</b>였다.

- <b>revision 카나리 업그레이드.</b> 인플레이스 업그레이드 대신 <b>새 리비전 istiod를 병렬로 설치</b>하고(`--set revision=canary`), 워크로드가 속한 ns의 라벨을 `istio.io/rev=canary`로 바꾼 뒤 <b>재시작</b>하면서 점진적으로 이전한다. 아직 옮기지 않은 워크로드는 이전 컨트롤 플레인을 유지하므로 롤백이 쉽다. 주의할 점: `istioctl proxy-status`는 default 리비전만 조회하기 때문에 이전된 프록시가 목록에 보이지 않을 수 있다. 따라서 `proxy-config bootstrap`의 `discoveryAddress`로 어느 istiod에 연결되었는지 확인하는 편이 정확하다.
- <b>istioctl 트러블슈팅 흐름.</b> `analyze`(정적 분석: 잘못된 참조·주입 누락을 지적하며, 실측에서 존재하지 않는 host를 `IST0101`로 정확히 짚음) → `proxy-status`(istiod 동기화 상태) → `proxy-config {clusters|routes|bootstrap|...}`(실제 Envoy 설정 덤프: "왜 이런 라우팅/차단이 일어나는가"를 사실로 확인). API 수준으로 확인되지 않는 문제에 한해서만 EnvoyFilter나 버전 불일치를 의심한다.

## 9. Ambient: 사이드카 없는 다음 세대

마지막으로 <b>Ambient 모드</b>를 활성화해 보았다. 사이드카를 파드마다 심는 대신, L4는 노드당 <b>ztunnel</b>(DaemonSet)이 mTLS로 처리하고 L7은 필요한 위치에만 <b>waypoint</b> 프록시를 둔다. `istio.io/dataplane-mode: ambient` 라벨만으로 <b>사이드카 없이(앱 수정·재시작 없이)</b> 워크로드가 메시에 편입되었고, ztunnel이 파드 간 트래픽을 HBONE(HTTP/2 CONNECT mTLS 터널)으로 암호화했다. L7 정책이 필요할 때에만 waypoint를 추가하므로(실측: waypoint로 `/deny-me`→403을 사이드카 없이 집행했다) <b>비용을 계층적으로</b> 지불하는 구조다. 사이드카 메시와 공존(additive)할 수 있으므로 ns 단위로 선택 가능하다. 현재 운영 환경은 사이드카+CNI 조합이라 Ambient를 사용하지 않지만, 사이드카 오버헤드가 부담인 신규·대규모 환경에는 확실한 대안으로 보였다.

## 10. 한계

mTLS·재시도·인가·egress 통제·관측이 전부 앱 밖 선언으로 내려오므로 앱에는 비즈니스 로직만 남는다. 대신 데이터플레인이라는 새 레이어의 복잡도(주입·리비전·정책 전파 지연·EnvoyFilter)를 떠안게 되며, 그것을 다루는 도구가 `istioctl`이라는 점도 이번에 익혔다. 다음 과제는 tracing 백엔드(Jaeger) 연동과 Ambient를 실제 운영 환경에 적용해 보는 것이다. (서비스 간 mTLS 불일치로 실제로 발생했던 장애는 [[clickhouse istio mTLS 불일치 이슈|따로]] 정리해 두었다.)

## 참고

- [[clickhouse istio mTLS 불일치 이슈]]
- [[CNI 구현체 선정]]
- [[OpenBao로 DB 자격증명 동적 발급하기]]
- [Istio](https://istio.io/latest/docs/)
- [Istio — Ambient Mesh](https://istio.io/latest/docs/ambient/)
