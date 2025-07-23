---
title: OIDC(EntraID) 를 이용한 개인별 인증인가 구성
date: 2025-07-16
draft: true
tags:
  - oidc
  - entraid
  - authentication
  - kubernetes
banner: 
cssclasses: 
description: 
permalink: 
aliases: 
completed: 
type:
  - note
---
현재 entra ID 를 kubernetes api server 에 oidc 로 연동하고 개인별로 role 과 rolebinding 을 적용해서 클러스터를 관리하고있어.


이전에 클러스터를 구성했을때는 모두가 admin 계정을 사용해 클러스터의 모든 리소스에 대한 권한을 가지고 있었다. 
굳이 변명하자면 클러스터를 여러 목적을 가지고 사용하지 않았고 자사의 솔루션을 프로비저닝 하는데에만 사용했기 때문에 
사실은 RBAC 와 쿠버네티스의 인증인가 방식에 대한 구조적 이해가 꽤나 어려웠던 것 같다. X.509 인증서라던지 CA 에 왜 하나의 인증서로 모든 것을 사용하지 않는지 등등등 머리가 지끈거렸었다. 

하지만 이번엔 클러스터의 사용자와 프로젝트가 다양하기 때문에 권한을 세세하게 관리하는 것이 좋을거라 판단했다.

가급적이면 새로운 인증용 플랫폼(keyCloak 등) 없이 사용자가 현재 사용하고 있는 것 (예 - VCS 계정, 메신저 계정) 을 활용해서 사용성을 확보할 수 있도록 고민했고, 사내 메신저인 팀즈 플랜에서 Entra ID OIDC 및 oAuth 를 사용할 수 있음을 확인하고 

### 상황
- 구성원의 수가 많지 않다. (50명 내외, 개발 인력은 더 작은편)
- 네임스페이스가 많이 분리되지 않을 것이다. 

때문에 닭잡는데 소잡는 칼을 쓰는건 아닌가 싶어서
> 현재 사용하고 있는 범위 내에서 플러그인 도입을 최소화 하는 방안에서 설계했다.


### 작업
- entra ID 연동
- OIDC 지원 애플리케이션들에는 설정을, 미지원 애플리케이션은 oAuth2proxy 적용
- clusterRole, role 은 helm chart 로 관리

### 후기
사실 현재까지는 관리에 큰 어려움이 없으나, 향후 인원, 네임스페이스, 권한 세분화가 필요하다면 좀 더 고민이 필요할 것 같다.

### 해보지 못한 것
다음 사항들은 추가로 시간이 나면 진행해보려 하고있다.
- Entra ID 와 Keycloak 를 연동하여 그룹별 권한 관리
- **Rancher**, **HashiCorp Vault** 등 관리 플랫폼 도입 검토