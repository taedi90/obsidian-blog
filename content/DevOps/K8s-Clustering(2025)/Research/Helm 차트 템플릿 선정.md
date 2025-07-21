---
title: Helm 차트 템플릿 선정
date: 2025-04-25
draft: false
tags:
  - helm
  - kubernetes
  - devops
  - msa
description: MSA 환경에서 표준화된 Helm 차트 템플릿 선정 과정과 Bitnami vs Helmet 비교 분석
type:
  - comparison
---

## 🚀 요약

> [!SUMMARY]
> MSA 환경에서 표준화된 배포를 위해 Helm 차트 템플릿을 비교 분석한 결과, Helmet 라이브러리 차트를 기반으로 한 래퍼 차트 구조를 선택했다. Bitnami 대비 간결한 설정과 라이선스 자유도가 결정적 요인이었다.

## 💡 개요

회사 솔루션을 <b>Helm 패키징</b>하기 위해 공통된 포맷이 필요했다. 솔루션은 <b>MSA(Microservices Architecture)</b>로 각 부서에서 개발하고 있기 때문에 공통 포맷을 만들지 않으면 배포 방식이 제각각이 되어버릴 수 있었기 때문이다.

## 📋 선정 배경

### 필수 Kubernetes 리소스 요구사항

Manifest 기준으로 다음 항목들이 거의 공통적으로 필요하다고 판단했다.

- `Deployment`
- `StatefulSet`
- `ConfigMap`
- `Secret`
- `PVC`
- `Service`

### Values.yaml 필수 설정 항목

차트 `values.yaml` 기준으로는 다음 항목들이 사전에 정의되어 있으면 좋겠다고 판단했다.

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

> [!INFO]
> MSA 환경에서는 각 서비스마다 동일한 구조의 차트가 필요하지만, 서비스별 특성에 맞는 커스터마이징도 가능해야 했다.

## 📊 비교

### Bitnami 차트 템플릿

기존에 Bitnami 차트를 많이 사용해봤었는데 쿠버네티스 버전에 대한 대응과 다양한 리소스에 대한 대응이 만족스러웠던 경험이 있어 [템플릿](https://github.com/bitnami/charts/tree/main/template)도 확인해보았다.

실제로 필요사항에 맞춰 템플릿을 커스텀하고 스크립트를 만들어보기도 했었는데 결정적으로 포기한 사유는 다음과 같다.

- 차트가 기능이 많음 (다른 말로 복잡함)
- 차트 리포지토리 라이선스가 `APACHE-2.0`이기 때문에 솔루션 차트 프로젝트에 라이선스와 수정사항을 명시해야 하기 때문

### Helmet 라이브러리 차트

그러다 확인한 것이 <b>Helmet</b>이라는 차트였다. 이 차트는 Helm의 <b>라이브러리 차트(Library Chart)</b>를 이용해서 (Helm 3에서 도입되었다고 한다) 필요한 리소스만 values에 정의하고 사용할 수 있었다.

#### 사용 방식

Helmet을 서브차트로 등록하고 템플릿에 아래와 같이 정의하면 된다.

```yaml
{{ include "helmet.app" . }}
```

그리고 `values.yaml`을 정의해주면 된다.

#### Helmet.app 내부 구조

`helmet.app`은 다음과 같이 정의되어 있다.

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

이 구조는 조건부로 리소스를 생성하는 방식으로, 필요한 설정만 정의하면 해당 리소스만 생성된다.

### 상세 비교 분석

| 항목 | Bitnami 차트 | Helmet 차트 |
|------|-------------|-------------|
| **복잡도** | 높음 (다양한 기능 포함) | 낮음 (필요한 기능만 선택적 사용) |
| **Values.yaml 크기** | 크고 복잡함 | 간결함 (필요한 내용만 작성) |
| **라이선스 제약** | APACHE-2.0 (고지 의무) | 비교적 자유로움 |
| **커스터마이징** | 제한적 | 유연함 |
| **학습 곡선** | 가파름 | 완만함 |
| **유지보수성** | 복잡함 | 단순함 |

> [!IMPORTANT]
> Bitnami 차트는 기능이 풍부하지만 우리 환경에서는 오버스펙이라고 판단했다. 특히 라이선스 고지 의무가 부담스러웠다.

### Helmet의 단점과 보완

하지만 Helmet에도 아쉬운 점이 있었다.

- `StatefulSet`을 지원하지 않음
- Bitnami의 `extraList`와 같이 차트에 정의되지 않은 리소스를 추가할 수 없었다 (CR을 배포해야 하는 경우 등에 대비)

이러한 한계점을 해결하기 위해 <b>Helmet을 래핑(Wrapping)하는 차트</b>를 만들고 해당 부분을 추가로 구성했다.

최종적으로 다음과 같은 구성이 되었다:

```
Application Chart → Helmet Wrapper Chart → Helmet → (Bitnami Common Chart)
```

## ✅ 선정 사유

이 구조를 선택한 이유는 다음과 같다.

1. **간결성**: Values.yaml이 필요한 내용만 포함하여 간결해짐
2. **선택적 리소스 생성**: 정의하지 않은 리소스는 생성되지 않는 방식
3. **라이선스 자유도**: 서브차트 의존성만 정의하면 되어 별도 고지 불필요
4. **확장성**: 래퍼 차트를 통해 StatefulSet과 추가 리소스 지원 가능
5. **표준화**: 모든 MSA 서비스에서 동일한 구조 사용 가능

> [!NOTE]
> 구성은 다소 복잡해졌지만 개발팀의 편의성과 배포 표준화 측면에서 많은 이점을 얻을 수 있을 것으로 예상했다.

## 🔗 참고

- [Bitnami Charts Repository](https://github.com/bitnami/charts)
- [Helmet Charts Repository](https://github.com/companyinfo/helm-charts)
- [Helm Library Charts Documentation](https://helm.sh/docs/topics/library_charts/)