---
title: Opentelemetry Collector 를 도입해야 할까?
date: 2025-05-13
draft: false
tags:
  - kubernetes
  - observability
  - opentelemetry
  - signoz
banner: 
cssclasses: 
description: 처음에는 불필요하게 느껴졌던 Opentelemetry Collector를 도입하고 나서야 비로소 그 진가를 깨닫게 된 경험을 공유합니다.
permalink: 
aliases: 
completed: true
type:
  - note
---
## 1. 개요

솔직히 말해, 처음에는 <b>Opentelemetry Collector</b>가 왜 필요한지 전혀 이해하지 못했다. 관측 가능성(Observability) 스택을 구성하면서 마주친 Collector는 그저 <b>데이터 파이프라인 중간에 끼어있는 불필요하고 복잡한 계층</b>처럼 보였다. 애플리케이션에서 데이터를 바로 APM이나 로그 저장소로 보내면 될 텐데, 왜 굳이 Collector라는 것을 거쳐야 하는지 의문이었다.

하지만 실제로 여러 관측가능성 스택을 비교 테스트하는 과정에서 <b>Collector의 진정한 가치</b>를 깨닫게 되었다. 벤더 종속성 제거와 파이프라인 유연성이라는, 처음에는 보이지 않았던 핵심 이점들이 드러났기 때문이다.

> 처음에는 불필요한 중간 계층이라 생각했던 Opentelemetry Collector가, 실제 사용해보니 벤더 종속성을 완벽히 제거하고 관측 가능성 파이프라인의 유연성을 극대화하는 핵심 컴포넌트임을 깨닫게 되었다. 초기 러닝커브는 오히려 장기적인 운영 효율성으로 돌아왔다.

## 2. 초기 우려와 고민

### Opentelemetry Collector란?

<b>OpenTelemetry Collector</b>는 관측가능성 데이터(로그, 메트릭, 트레이스)를 수집(Receive), 처리(Process), 내보내기(Export)하는 벤더 중립적 프록시다. 애플리케이션과 백엔드 저장소 사이에서 데이터를 가공하고 라우팅하는 역할을 한다.

![OpenTelemetry Collector 구조](https://opentelemetry.io/docs/collector/img/otel-collector.svg)

<b>주요 구성 요소:</b>
- <b>Receiver</b>: 다양한 소스로부터 데이터를 수집 (OTLP, Prometheus, Jaeger 등)
- <b>Processor</b>: 데이터 필터링, 변환, 배치 처리 등 수행
- <b>Exporter</b>: 처리된 데이터를 백엔드 시스템으로 전송

### 초기 우려사항

1. <b>복잡성 증가</b>: 단순한 직접 연결 대신 중간 계층을 추가하는 것이 과연 필요한가?
2. <b>성능 오버헤드</b>: 추가적인 홉(hop)으로 인한 지연시간과 리소스 사용량 증가
3. <b>러닝커브</b>: Receiver, Processor, Exporter 개념과 설정 방법 습득의 어려움
4. <b>관리 포인트 증가</b>: 애플리케이션 외에 Collector까지 관리해야 하는 부담

> 당시 생각은 'Collector는 오버헤드만 유발할 뿐' 이라는 불신에 가까웠다. 러닝커브와 관리 포인트만 늘어날 것이라고 예상했다.

### 실무진의 고민

- <b>OTLP 프로토콜</b> 지원: Jaeger나 여러 관측가능성 툴에서 OTLP를 직접 지원하기 때문에 사실 Collector 없이도 OpenTelemetry 표준은 유지할 수 있지 않나?
- <b>직접 연결의 단순함</b>: 애플리케이션 → 백엔드 직접 연결이 더 간단하고 명확해 보이는데?

## 3. 테스트 과정에서 발견한 가치

검토하던 `SigNoz`가 Collector를 기본 아키텍처로 채택하고 있었기에, 마지못해 Collector를 테스트 환경에 구성하게 되었다. 파이프라인의 개념(Receiver, Processor, Exporter)을 익히는 것은 역시나 쉽지 않았다.

<b>하지만 진짜 깨달음은 다른 모니터링 스택을 추가로 테스트하는 과정에서 찾아왔다.</b>

### 스택 교체 시의 편의성

[[관측가능성 스택 선정|관측가능성 스택 선정]]을 할 때 Collector의 진정한 가치를 체감했다. 여러 관측가능성 스택을 비교하기 위해 클러스터에 다양한 모니터링 도구를 설치하며 테스트했는데, 이때마다 <b>관측가능성 데이터 수집에서 시각화까지 전범위의 파이프라인을 수정하는 것이 아니라 수집 이후 단계만 설정</b>해주면 되는 것이었다.

<b>구체적인 경험:</b>
- ELK 스택 → LGTM 스택 → SigNoz 스택으로 변경할 때
- 애플리케이션 코드나 데이터 수집 설정은 전혀 건드리지 않음
- Collector의 Exporter 설정만 변경하면 백엔드 전환 완료
- 각 백엔드별 프로토콜 차이나 인증 방식을 Collector가 모두 추상화

### 벤더 독립성 확보

```yaml
# Collector 설정 예시 - Exporter만 변경하면 백엔드 교체 완료
exporters:
  # Jaeger로 전송
  jaeger:
    endpoint: jaeger-collector:14250
  
  # SigNoz로 전송  
  otlp:
    endpoint: signoz-otel-collector:4317
  
  # Grafana Tempo로 전송
  otlp/tempo:
    endpoint: tempo:4317
```

이 구조 덕분에 <b>애플리케이션은 백엔드 변경을 전혀 인지하지 못했다</b>. 완벽한 벤더 독립성이 실현된 순간이었다.

### 운영상의 유연성

<b>데이터 라우팅</b>: 동일한 데이터를 여러 백엔드로 동시 전송 가능
```yaml
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [jaeger, otlp/signoz]  # 두 곳으로 동시 전송
```

<b>데이터 필터링</b>: 민감한 정보나 불필요한 데이터를 전송 전에 제거
```yaml
processors:
  attributes:
    actions:
      - key: password
        action: delete  # 민감한 속성 제거
```

## 4. 최종 도입과 활용

### 아키텍처 표준화

이 경험을 통해 Collector에 대한 불신을 완전히 거두고 확신을 갖게 되었다. 즉시 모든 노드에 <b>Collector를 데몬셋(DaemonSet)으로 배포</b>하여 클러스터의 모든 데이터가 Collector를 통해 흐르도록 아키텍처를 표준화했다.

<b>현재 운영 구조:</b>
```
애플리케이션 → Node Collector (DaemonSet) → Gateway Collector → 백엔드
```

### 예상치 못한 추가 이점들

1. <b>중앙화된 설정 관리</b>: 모든 관측가능성 설정을 Collector ConfigMap에서 통합 관리
2. <b>네트워크 트래픽 최적화</b>: 노드별 Collector가 로컬에서 배치 처리 후 전송
3. <b>장애 격리</b>: 백엔드 장애 시 Collector가 큐잉하여 데이터 손실 방지
4. <b>비용 최적화</b>: 불필요한 데이터 필터링으로 백엔드 스토리지 비용 절약

초기에 우려했던 러닝커브와 복잡성은, 오히려 <b>장기적인 관점에서의 비교할 수 없는 유연성과 운영 효율성</b>으로 되돌아왔다. 지금은 Opentelemetry Collector 없는 관측 가능성 파이프라인은 상상할 수 없을 정도로 매우 만족하며 사용하고 있다.

## 참고
- [OpenTelemetry Docs - Collector](https://opentelemetry.io/docs/collector/)
