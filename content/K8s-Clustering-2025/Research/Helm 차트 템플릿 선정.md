---
title: Helm 차트 템플릿 선정
date: 2025-04-25
draft: false
aliases:
tags:
  - helm
  - kubernetes
  - devops
  - msa
description: MSA 솔루션의 공통 Helm 차트 템플릿으로 Bitnami 대신 Helmet 래퍼 차트를 고른 이유.
type:
  - comparison
---

## 🚀 요약

> [!SUMMARY]
> MSA 솔루션을 표준화된 방식으로 배포하려고 Helm 차트 템플릿을 비교했고, <b>Helmet</b> 라이브러리 차트를 감싼 래퍼 차트 구조로 정했다. Bitnami보다 설정이 간결하고 라이선스가 자유롭다는 점이 결정적이었다.
> - 실제 차트 구조는 [helmet-extended 저장소](https://github.com/taedi90/helmet-extended)에서 볼 수 있다.

## 💡 개요

회사 솔루션을 <b>Helm 패키징</b>하려면 공통 포맷이 필요했다. 솔루션이 <b>MSA(Microservices Architecture)</b>라 부서마다 따로 개발하는데, 공통 틀을 안 잡아두면 배포 방식이 부서 수만큼 갈라질 게 뻔했기 때문이다.

## 📋 선정 배경

### 공통으로 필요한 Kubernetes 리소스

Manifest 기준으로 이 정도는 거의 매번 필요하다고 봤다.

- `Deployment`
- `StatefulSet`
- `ConfigMap`
- `Secret`
- `PVC`
- `Service`

### values.yaml에 미리 있으면 하는 항목

- `fullnameOverride`
- `image`
- `replicaCount`
- `config`
- `nodeSelector`
- `podAntiAffinity`
- `livenessProbe`, `readinessProbe`, `startupProbe`
- `resources`
- `podSecurityContext`, `containerSecurityContext`
- `service`
- `persistence`

서비스마다 같은 구조의 차트를 쓰되, 서비스별 특성에 맞는 커스터마이징은 열어둬야 했다. 이 둘을 동시에 만족하는 게 관건이었다.

## 📊 비교

### Bitnami 차트

예전에 Bitnami 차트를 많이 써봤는데 쿠버네티스 버전 대응이나 리소스 커버리지가 만족스러웠던 기억이 있어, [차트 템플릿](https://github.com/bitnami/charts/tree/main/bitnami)부터 봤다. 실제로 필요에 맞게 커스텀하고 스크립트도 짜봤지만 결국 접었다. 이유는 둘이다.

- 기능이 너무 많다. 바꿔 말하면 복잡하다.
- 리포지토리 라이선스가 `Apache-2.0`이라, 솔루션 차트 프로젝트에 라이선스와 수정 사항을 명시해야 한다.

### Helmet 라이브러리 차트

그러다 만난 게 <b>Helmet</b>이라는 차트다. Helm의 <b>라이브러리 차트(Library Chart)</b>(Helm 3에서 도입됐다고 한다)를 이용해, 필요한 리소스만 values에 정의하면 되는 방식이었다.

#### 사용 방식

Helmet을 서브차트로 등록하고 템플릿에서 아래 한 줄만 부르면 된다.

```yaml
{{ include "helmet.app" . }}
```

나머지는 `values.yaml`에서 채운다.

#### helmet.app 내부 구조

`helmet.app`은 이렇게 정의돼 있다. `values`에 값이 있는 리소스만 조건부로 생성하는 구조라, 정의한 것만 렌더된다.

```yaml
{{- define "helmet.app" -}}
{{- if .Values.configMap.data }}
{{ include "helmet.configmap" . }}
{{- end }}

{{- if .Values.image.repository }}
{{ include "helmet.deployment" . }}
{{- end }}

{{ include "helmet.persistence" . }}
{{ include "helmet.hpa" . }}
{{ include "helmet.ingress" . }}

{{- if or .Values.secret.data .Values.secret.stringData }}
{{ include "helmet.secret" . }}
{{- end }}

{{ include "helmet.tls.secrets" . }}
{{ include "helmet.tls.selfsigned" . }}

{{- if and .Values.ports .Values.service.ports }}
{{ include "helmet.service" . }}
{{- end }}

{{ include "helmet.serviceaccount" . }}
{{ include "helmet.servicemonitor" . }}
{{ include "helmet.cronjob" . }}
{{ include "helmet.podmonitor" . }}
{{- end }}
```

### 두 차트 비교

| 항목 | Bitnami 차트 | Helmet 차트 |
| --- | --- | --- |
| 복잡도 | 높음 (기능이 다양함) | 낮음 (필요한 것만 선택) |
| values.yaml 크기 | 크고 복잡 | 간결 |
| 라이선스 제약 | Apache-2.0 (고지 의무) | 비교적 자유로움 |
| 커스터마이징 | 제한적 | 유연 |
| 학습 곡선 | 가파름 | 완만 |
| 유지보수성 | 복잡 | 단순 |

Bitnami는 기능이 풍부한 게 오히려 오버스펙이었고, 라이선스 고지 의무도 부담스러웠다. 이번 용도에는 Helmet 쪽이 맞았다.

### Helmet의 단점과 보완

물론 Helmet도 아쉬운 게 있었다.

- `StatefulSet`을 지원하지 않는다.
- Bitnami의 `extraList`처럼 차트에 정의되지 않은 리소스를 끼워 넣을 수 없다 (CR을 따로 배포해야 하는 경우 등에 대비).

그래서 <b>Helmet을 래핑(Wrapping)하는 차트</b>를 만들어 이 부분을 채웠다. 최종 구성은 이렇게 됐다.

```
Application Chart → Helmet Wrapper Chart → Helmet → (Bitnami Common Chart)
```

## ✅ 선정 사유

이 구조로 간 이유는 이렇다.

1. <b>간결성</b>: values.yaml에 필요한 것만 담아 짧아진다.
2. <b>선택적 리소스 생성</b>: 정의 안 한 리소스는 안 만들어진다.
3. <b>라이선스 자유도</b>: 서브차트 의존성만 걸면 되니 별도 고지가 필요 없다.
4. <b>확장성</b>: 래퍼 차트로 StatefulSet과 추가 리소스를 얹을 수 있다.
5. <b>표준화</b>: 모든 MSA 서비스가 같은 구조를 쓴다.

구성 자체는 좀 복잡해졌지만, 개발팀 편의성과 배포 표준화를 생각하면 남는 장사라고 봤다.

## 🔗 참고

- [Bitnami Charts Repository](https://github.com/bitnami/charts)
- [Helmet Charts Repository](https://github.com/companyinfo/helm-charts)
- [Helm Library Charts Documentation](https://helm.sh/docs/topics/library_charts/)
