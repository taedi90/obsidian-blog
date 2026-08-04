---
title: OIDC 사용자 RBAC을 Helmfile 차트로 관리하기
date: 2025-07-23
draft: false
tags:
  - kubernetes
  - rbac
  - oidc
  - helm
  - helmfile
banner: 
cssclasses: 
description: Entra ID OIDC로 붙은 개인 사용자에게 role·rolebinding을 손으로 붙이는 대신, 권한 정의와 사용자 매핑을 Helmfile 차트로 선언적으로 관리한 구성.
permalink: 
aliases: 
completed: true
type:
  - note
---

## 1. RBAC을 차트로 관리하기

[[OIDC(EntraID) 를 이용한 개인별 인증인가 구성|앞 글]]에서 Entra ID를 API 서버에 OIDC로 연동하고, 사용자별로 `Role`·`RoleBinding`을 붙여 권한을 나눴다. 문제는 그 `Role`·`RoleBinding`을 <b>어떻게 관리하느냐</b>다.

`kubectl apply`로 하나씩 붙이면 금방 엉킨다. 누구에게 무슨 권한을 줬는지가 클러스터 안에만 있고, 사람이 늘거나 클러스터를 다시 세우면 그걸 손으로 재현해야 한다. 결국 인증인가에서 없애려던 "추적 불가"가 권한 쪽에서 되살아난다.

그래서 권한도 <b>선언적으로</b> 관리하기로 했다. 권한 정의와 "누가 무슨 권한을 갖는지"의 매핑을 리포에 두고 Helmfile 차트로 적용한다. git에 이력이 남고, 클러스터를 다시 세워도 같은 매핑이 그대로 재현된다.

## 2. 디렉토리 구조

```text
.
├── addons
│   ├── clusterrole.yaml.gotmpl     # 클러스터 전역 권한 정의(ClusterRole)
│   └── role.yaml.gotmpl            # 네임스페이스 한정 권한 정의(Role)
├── chart
│   ├── Chart.yaml
│   ├── templates
│   │   ├── clusterrolebinding.yaml # 사용자 ↔ ClusterRole 바인딩
│   │   └── rolebinding.yaml        # 사용자 ↔ Role 바인딩
│   └── values.yaml                 # 기본 매핑값
├── environments
│   └── dev
│       └── values.yaml             # 환경(클러스터)별 사용자↔권한 매핑
└── helmfile.yaml                   # addons + chart를 환경별 values로 묶어 적용
```

역할을 둘로 갈라둔 게 핵심이다.

- <b>`addons/` — 권한 정의(무엇을 할 수 있나).</b> `Role`/`ClusterRole`을 `.gotmpl`로 둔다. "개발자는 이 리소스들을 읽고 쓸 수 있다" 같은 <b>권한 묶음</b> 자체다. 사람과 무관하게 재사용된다.
- <b>`chart/templates/` — 바인딩(누구에게 주나).</b> 위에서 정의한 권한을 특정 OIDC 사용자에 잇는 `RoleBinding`/`ClusterRoleBinding`이다.
- <b>`environments/*/values.yaml` — 매핑값.</b> "이 클러스터에서 누가 어떤 role을 갖는지"를 값으로 둔다. 클러스터마다 구성원·권한이 다르니 환경으로 분리한다.
- <b>`helmfile.yaml` — 오케스트레이션.</b> addons(권한 정의)와 chart(바인딩)를 환경별 values와 함께 한 번에 적용한다.

정의(addons)와 배정(chart)을 나눠두니, 권한 묶음은 그대로 두고 "누구에게 줄지"만 values에서 바꾸면 된다.

## 3. OIDC 사용자를 subjects에 어떻게 매핑하는가

RBAC 바인딩의 `subjects`에는 사용자를 뭐라고 적느냐가 관건이다. API 서버가 OIDC 토큰에서 뽑아 <b>내부 username으로 쓰는 값</b>을 그대로 적어야 한다.

API 서버 OIDC 설정에서 username 클레임과 접두사(`--oidc-username-claim`, `--oidc-username-prefix`)를 정하는데, 접두사를 `oidc:`로 두면 사용자는 클러스터 안에서 `oidc:<클레임값>`이라는 이름을 갖는다. 그래서 바인딩의 subject도 그 이름으로 적는다. (아래는 대표 예시다.)

```yaml
# rolebinding.yaml 이 values의 매핑을 돌며 렌더하는 결과의 한 조각(예시).
# subject 이름은 API 서버 OIDC 접두사·클레임에 맞춰 'oidc:<사용자>' 형태.
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: dev-edit-alice
  namespace: team-a
subjects:
- kind: User
  name: "oidc:alice@corp.example"     # API 서버가 OIDC 토큰에서 매핑한 username
  apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: Role
  name: namespace-editor              # addons/role.yaml.gotmpl 이 정의한 권한 묶음
  apiGroup: rbac.authorization.k8s.io
```

`values.yaml`에는 이 매핑을 사람이 읽기 쉬운 형태로 둔다 — 대략 "사용자 → (네임스페이스, role)" 목록이다. chart 템플릿이 그 목록을 돌며 위 같은 바인딩을 찍어낸다. 사람이 하나 늘면 values에 한 줄 추가하고 적용하면 끝이다.

<b>네임스페이스 한정이면 `Role`+`RoleBinding`, 클러스터 전역이면 `ClusterRole`+`ClusterRoleBinding`</b>을 쓴다. 대부분의 개인 권한은 특정 네임스페이스로 한정했고(그래서 `Role` 쪽이 주력), 노드·PV·CRD처럼 네임스페이스에 안 매이는 리소스나 클러스터 관리자급만 `ClusterRole`로 뒀다.

## 4. 이 정도로 잡은 이유

앞 글의 전제 그대로다. 구성원이 50명 안팎이고 네임스페이스가 많이 갈리지 않는 상황이라, 인증인가 플랫폼(Keycloak 등)을 새로 세우는 건 과하다고 봤다. 그래서 <b>이미 있는 것(API 서버 OIDC + 표준 RBAC)만으로</b> 선언적 관리를 얻는 선에서 멈췄다. Helmfile 차트 하나면 "권한 정의 + 사용자 매핑 + 환경 분리"가 다 들어간다.

한계도 분명하다. 지금은 <b>사용자 개인</b>을 role에 바인딩하는 구조라, 사람이 많아지면 values의 매핑이 길어진다. Entra ID의 <b>그룹</b>을 subject(`kind: Group`)로 받아 "그룹 → role"로 묶으면 개인별 바인딩을 크게 줄일 수 있는데, 그건 그룹 클레임 연동까지 손봐야 해서 다음 과제로 남겼다. (앞 글의 "Keycloak 연동 그룹별 권한 관리"와 이어지는 지점이다.)

## 참고

- [[OIDC(EntraID) 를 이용한 개인별 인증인가 구성]]
- [Kubernetes — Using RBAC Authorization](https://kubernetes.io/docs/reference/access-authn-authz/rbac/)
- [Kubernetes — OpenID Connect Tokens](https://kubernetes.io/docs/reference/access-authn-authz/authentication/#openid-connect-tokens)
- [Helmfile](https://helmfile.readthedocs.io/en/latest/)
