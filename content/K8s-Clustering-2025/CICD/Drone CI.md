---
title: Drone CI 차트 구성과 k8s 러너
date: 2025-07-23
draft: false
tags:
  - drone
  - ci
  - kubernetes
  - helm
banner: 
cssclasses: 
description: Drone CI를 Helmfile로 배포하고, k8s 러너로 파드를 돌려 빌드 잡을 실행하는 구성.
permalink: 
aliases: 
completed: 
type:
  - note
---

Drone CI는 가벼운 CI 도구다. Jenkins의 무거움이 싫어서 도입했다. (Jenkins도 여전히 쓰고 있지만, 조금 더 간결한 도구를 도입해보고 싶었다.)

## 1. 차트 구성

`drone-stack` 디렉토리는 server와 runner-kube 차트를 하위 의존성으로 묶어서 하나의 helmfile release로 관리한다.

```
drone-stack/
├── chart/
│   ├── Chart.yaml          # drone + drone-runner-kube 의존성
│   ├── charts/
│   │   ├── drone-0.6.5.tgz
│   │   └── drone-runner-kube-0.1.10.tgz
│   └── values.yaml         # 공통 기본값
├── environments/
│   └── dev/
│       ├── values.yaml    # 환경 오버레이
│       └── addons.yaml
├── helmfile.yaml
├── post-install.sh
└── post-destroy.sh
```

## 2. 주요 설정

server와 runner를 같은 release에 묶어서 한 번에 배포한다. server는 ClusterIP로만 열고, 외부 접근은 Gateway API나 Ingress로 처리한다.

```yaml
drone:
  nameOverride: "core"  # server로 지으면 포트 충돌 오류가 난다

  service:
    type: ClusterIP
    port: 80

  persistentVolume:
    enabled: true
    size: 8Gi

  env:
    DRONE_SERVER_HOST: ci.example.com
    DRONE_SERVER_PROTO: https
```

> [!NOTE]
> `nameOverride`를 `server`로 지으면 Drone server 컨테이너와 Kubernetes Service 이름이 충돌해서 "Invalid port configuration" 오류가 난다. 이걸 모르고 한참 헤맸다. `core` 같은 다른 이름을 쓰면 된다.

## 3. k8s 러너

Drone의 kubernetes runner를 쓰면 빌드 잡을 파드로 돌린다. 러너가 각 파이프라인 단계마다 파드를 생성하고, 끝나면 지운다. 빌드 노드를 따로 관리할 필요가 없다.

러너 설정은 차트의 values에서 `drone-runner-kube` 부분을 건드린다. RBAC, serviceAccount, 리소스 제한을 여기서 잡는다.

## 4. post-install / post-destroy

helmfile의 postsync 훅으로 `post-install.sh`와 `post-destroy.sh`를 실행한다. 설치 후 후속 작업(라벨 추가, 인증 정보 주입 등)이 필요하면 여기에 넣는다.
