---
title: Argo CD 차트 구성과 OIDC 연동
date: 2025-07-23
draft: false
tags:
  - argocd
  - gitops
  - oidc
  - kubernetes
banner: 
cssclasses: 
description: Argo CD를 Helmfile로 배포하고, Entra ID OIDC로 인증을 붙이고, private 레지스트리와 Bitbucket 리포를 연동한 구성.
permalink: 
aliases: 
completed: 
type:
  - note
---

Argo CD는 GitOps 배포 도구다. Helmfile로 관리하는 차트 중 하나로, 자체 Helmfile에 올려서 배포했다.

## 차트 구성

`argo-cd` 디렉토리 구조는 다른 플러그인 컴포넌트와 동일하다.

```
argo-cd/
├── helmfile.yaml
├── chart/
│   ├── Chart.yaml
│   ├── values.yaml
│   └── templates/
└── environments/
    ├── dev/
    │   └── values.yaml
    └── offline_test/
        └── values.yaml
```

helmfile.yaml은 공통 패턴을 따른다. 환경별 values를 오버레이로 먹이고, presync/postsync 훅으로 pre-install.sh, post-install.sh를 실행한다.

```yaml
releases:
  - name: argocd
    namespace: cd
    chart: ./chart
    values:
      - ./chart/values.yaml
      - ./environments/{{ env "ENV_DIR" | default "default" }}/values.yaml
```

## OIDC 연동 (Entra ID)

Argo CD의 `configs.cm.oidc.config`에 Entra ID 발급자 정보를 넣는다. kube-apiserver에 OIDC를 붙인 것과 같은 issuer/clientID를 쓴다.

```yaml
configs:
  cm:
    oidc.config: |
      name: EntraID
      issuer: "https://login.microsoftonline.com/{tenant}/v2.0"
      clientID: {client-id}
      clientSecret: {secret}
      requestedIDTokenClaims:
        groups:
          essential: false
      requestedScopes:
        - openid
        - profile
        - email
```

> [!NOTE]
> `clientSecret`은 values에 평문으로 두지 말고 Secret으로 빼는 게 좋다. 지금은 개발 환경이라 그냥 두고 있지만, 프로덕션에는 externalSecret이나 Sealed Secrets로 관리해야 한다.

## RBAC

Argo CD 자체 RBAC은 `configs.rbac`에서 설정한다. 현재는 개발 환경이라 기본을 `role:all-access`로 열어두고, 프로덕션에서는 그룹 기반으로 갈 예정이다.

```yaml
configs:
  rbac:
    policy.default: role:all-access
    policy.csv: |
      p, role:all-access, applications, *, */*, allow
      p, role:all-access, applicationsets, *, *, allow
      p, role:all-access, clusters, *, *, allow
      p, role:all-access, repositories, *, *, allow
      p, role:all-access, projects, *, *, allow
      p, role:all-access, logs, get, *, allow
      p, role:all-access, exec, create, */*, allow
```

## 리포지토리 연동

Argo CD가 배포할 차트와 매니페스트가 있는 리포를 등록한다. 두 개를 연동했다.

- <b>Harbor (Helm OCI 차트)</b>: `enableOCI: 'true'`로 OCI 레지스트리로 사용. Harbor의 robot 계정으로 인증.
- <b>Bitbucket (git)</b>: 앱 비밀번호로 인증.

```yaml
configs:
  repositories:
    private-helm-repo:
      url: repo.example.com/charts
      name: harbor
      type: Helm
      enableOCI: 'true'
      username: robot$ci
      password: {password}
    private-bitbucket-repo:
      url: https://bitbucket.org/org/project-chart.git
      name: bitbucket
      type: git
      username: {user}
      password: {token}
```

## ApplicationSet 네임스페이스

Argo CD가 Application 리소스를 어떤 네임스페이스까지 허용할지 지정한다.

```yaml
configs:
  params:
    applicationsetcontroller.namespaces: app-v3
    application.namespaces: app-v3
```

이렇게 하면 `app-v3` 네임스페이스에 Application을 만들 수 있다. 기본적으로는 Argo CD가 설치된 네임스페이스(`cd`)만 허용하니, 다른 네임스페이스에 Application을 두려면 이 설정이 필요하다.
