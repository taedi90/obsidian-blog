---
title: Harbor 레지스트리 구성
date: 2025-07-23
draft: false
tags:
  - harbor
  - registry
  - kubernetes
  - helm
banner: 
cssclasses: 
description: Harbor를 Cilium LB-IPAM으로 외부에 노출하고, 영속 볼륨과 업데이트 전략을 설정한 구성.
permalink: 
aliases: 
completed: 
type:
  - note
---

Harbor는 컨테이너 레지스트리다. GitLab 내장 registry를 쓰다가 보안 스캔(trivy)과 멀티 테넌시가 필요해져서 옮겼다.

## 1. 차트 구성

Harbor 공식 차트를 로컬 `chart/`에 두고 환경별 values로 오버레이한다. 다른 컴포넌트와 동일한 패턴이다.

## 2. 외부 노출: Cilium LB-IPAM

Harbor를 외부에 노출할 때 Cilium의 LB-IPAM으로 IP를 고정했다. MetalLB 대신 Cilium이 LoadBalancer를 처리하니, Cilium 어노테이션으로 IP를 지정한다.

```yaml
expose:
  type: loadBalancer
  tls:
    enabled: false
  loadBalancer:
    name: harbor
    annotations: 
      io.cilium/lb-ipam-ips: 10.30.0.20
```

> [!NOTE]
> TLS를 Harbor 앞단이 아닌 Gateway API 레벨에서 처리하기 위해 `tls.enabled: false`로 뒀다. Gateway API에서 HTTPS를 종료하고 Harbor에는 평문 HTTP로 넘긴다.

## 3. 영속 볼륨

Harbor는 registry, jobservice, database, redis, trivy 다섯 곳에 영속 볼륨이 필요하다. 스토리지 클래스는 지정하지 않고 기본 StorageClass를 쓴다.

```yaml
persistence:
  enabled: true
  resourcePolicy: "keep"  # helm delete 시 PVC를 보존
  persistentVolumeClaim:
    registry:
      size: 200Gi
    jobservice:
      jobLog:
        size: 1Gi
    database:
      size: 10Gi
    redis:
      size: 1Gi
    trivy:
      size: 5Gi
```

`resourcePolicy: "keep"` 설정은 차트를 삭제해도 PVC를 남겨둔다. 재설치 시 데이터가 삭제되는 상황을 방지하기 위한 안전장치다.

## 4. 업데이트 전략

```yaml
updateStrategy:
  type: Recreate
```

RWM(ReadWriteMany) 볼륨이 아니면 RollingUpdate가 안 된다. NFS가 아닌 로컬 스토리지를 쓰기 때문에 `Recreate`로 두고, 파드를 내렸다 올린다.

## 5. OIDC

Harbor 자체 OIDC 설정은 values에서 `oidc` 섹션으로 넣는다. Entra ID와 연동하면 Harbor 로그인 시 Entra ID로 인증된다. (현재 설정 중이라 별도 정리 예정.)
