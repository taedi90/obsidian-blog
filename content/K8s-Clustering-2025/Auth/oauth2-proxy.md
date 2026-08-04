---
title: oauth2-proxy로 인증 없는 서비스 앞에 SSO 세우기
date: 2025-07-16
draft: false
tags:
  - oauth2-proxy
  - authentication
  - keycloak
  - kubernetes
banner: 
cssclasses: 
description: 자체 인증이 없는 대시보드·내부 도구 앞에 oauth2-proxy를 세워 Keycloak(OIDC) SSO로 막고, 인증된 사용자 정보를 헤더로 백엔드에 넘긴 구성.
permalink: 
aliases: 
completed: true
type:
  - note
---

## 요약

> [!SUMMARY]
> 자체 로그인이 없는 대시보드·내부 도구(모니터링 UI 등)를 그냥 열어둘 수 없어서, 앞에 <b>oauth2-proxy</b>를 세우고 Keycloak을 OIDC 공급자로 붙였다. 사용자는 Keycloak SSO로 한 번 로그인하고, oauth2-proxy가 통과시킨 요청에는 사용자 식별 정보가 헤더로 실려 백엔드에 전달된다. 접근 제어는 Keycloak <b>role</b>로 하고, 인그레스의 `auth_request`로 여러 서비스 앞단에 공통으로 끼웠다.

인증을 각 서비스가 따로 구현하는 대신, 문 앞에 SSO 게이트 하나를 두는 방식이다.

## 1. 도입 배경

클러스터에 붙는 관리용 UI들(대시보드·관측 도구 등)은 자체 인증이 없거나 빈약하다. 이걸 사내망에 그대로 노출하면 누구나 접근할 수 있다. 서비스마다 인증을 새로 구현하긴 부담이라, <b>공통 인증 게이트</b>를 앞에 두기로 했다. oauth2-proxy는 요청을 OIDC 공급자(여기선 Keycloak)로 리다이렉트해 로그인시키고, 인증된 세션만 뒤로 통과시키는 리버스 프록시다.

## 2. Keycloak OIDC 연동 설정

핵심 실행 인자는 이렇다(민감값은 시크릿으로 주입, 도메인·realm은 예시).

```text
--provider=keycloak-oidc
--oidc-issuer-url=https://sso.example/auth/realms/corp
--client-id=oauth2-proxy
--client-secret=$(CLIENT_SECRET)
--cookie-secret=$(COOKIE_SECRET)
--redirect-url=https://app.example/oauth2/callback
--email-domain=*
--skip-provider-button=true          # 공급자 선택 화면 없이 바로 Keycloak 로그인으로
--reverse-proxy=true                  # 인그레스 뒤에 있으니 X-Forwarded-* 신뢰
--upstream=static://200               # auth_request 전용 — 자기가 프록시하지 않고 200만 반환
--set-xauthrequest=true               # 인증 정보를 X-Auth-Request-* 헤더로
--set-authorization-header=true
--pass-access-token=true
--allowed-role=admin
--allowed-role=analyst
--allowed-role=viewer
```

몇 가지가 포인트다.

- <b>`provider=keycloak-oidc`.</b> Keycloak 전용 provider라 realm의 role 클레임을 읽어 인가에 쓸 수 있다. `--allowed-role`로 Keycloak에서 그 role을 가진 사용자만 통과시킨다. 접근 권한이 앱이 아니라 <b>Keycloak role</b>에 모인다.
- <b>`skip-provider-button=true`.</b> "어느 공급자로 로그인?" 중간 화면을 건너뛰고 곧장 Keycloak으로 보낸다. 공급자가 하나뿐이니 불필요한 클릭을 없앤다.
- <b>`upstream=static://200`.</b> oauth2-proxy가 트래픽을 직접 프록시하지 않고, 인증 여부만 판정해 200/401을 돌려주는 <b>auth_request 전용 모드</b>다. 실제 프록시는 인그레스가 한다(3절).

## 3. 인그레스 auth_request로 여러 서비스에 공통 적용

oauth2-proxy를 서비스마다 앞에 붙이는 대신, 인그레스(nginx)의 <b>external auth</b>로 한 번에 끼웠다. 보호할 인그레스에 auth 관련 annotation을 걸면, nginx가 매 요청마다 oauth2-proxy에 "이 사용자 통과시켜도 되나"를 부속 요청(auth_request)으로 물어본다.

```yaml
metadata:
  annotations:
    nginx.ingress.kubernetes.io/auth-url: "https://app.example/oauth2/auth"
    nginx.ingress.kubernetes.io/auth-signin: "https://app.example/oauth2/start?rd=$escaped_request_uri"
    # 인증 통과 시 백엔드로 넘길 헤더
    nginx.ingress.kubernetes.io/auth-response-headers: "X-Auth-Request-User,X-Auth-Request-Email,Authorization"
```

- `auth-url`로 oauth2-proxy의 `/oauth2/auth`에 물어 2xx면 통과, 401이면 `auth-signin`으로 로그인 흐름을 시작한다.
- `set-xauthrequest`로 만들어진 `X-Auth-Request-User`·`X-Auth-Request-Email`(그리고 `Authorization`)을 백엔드로 넘겨, <b>백엔드는 자체 인증 코드 없이</b> 이 헤더로 사용자를 안다. (같은 "인증을 위임하고 헤더로 신원 전달"이라는 아이디어를 서비스 메시에선 ext_authz로 하는데, 그 얘기는 Istio 쪽에 있다.)

## 4. 남은 것

지금은 통과/차단과 role 기반 접근까지다. 더 세밀한 <b>서비스별 권한</b>(같은 로그인이라도 A 도구는 admin만, B는 viewer도)은 인그레스별 `--allowed-role`을 다르게 두거나 role별 그룹을 나눠 확장할 여지가 있다. 쿠키·세션 보안(`cookie-secure`, 도메인 스코프)은 실제 HTTPS 도메인에 맞춰 조여야 한다.

## 참고

- [[OIDC(EntraID) 를 이용한 개인별 인증인가 구성]]
- [oauth2-proxy](https://oauth2-proxy.github.io/oauth2-proxy/)
- [Keycloak OIDC provider](https://oauth2-proxy.github.io/oauth2-proxy/configuration/providers/keycloak_oidc)
