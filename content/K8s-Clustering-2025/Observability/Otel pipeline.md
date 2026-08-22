---
title: OpenTelemetry Collector 파이프라인 구성
date: 2025-07-16
draft: false
tags:
  - opentelemetry
  - otel-collector
  - observability
  - kubernetes
banner: 
cssclasses: 
description: 앱·노드·파드의 trace·메트릭·로그를 한 경로로 모으는 otel-collector 파이프라인 구성. receivers→processors→exporters의 뼈대와, agent(DaemonSet)+gateway 2단 구조로 나눈 이유.
permalink: 
aliases: 
completed: true
type:
  - note
---

## 요약

> [!SUMMARY]
> 관측 데이터(trace·메트릭·로그)를 SigNoz(ClickHouse)로 보내는 길목이 otel-collector다. 파이프라인은 <b>receivers(받기) → processors(가공) → exporters(내보내기)</b>의 세 토막이고, 신호(traces/metrics/logs)마다 이 조합을 `service.pipelines`에 따로 엮는다. 그리고 collector를 <b>agent(DaemonSet, 노드마다)</b>와 <b>gateway(Deployment, 중앙)</b> 2단으로 나눠, 노드-로컬 수집과 클러스터-레벨 집계·전송을 분리했다.

수집을 앱이 직접 백엔드로 쏘게 두지 않고 collector라는 중간 계층을 둔 덕에, 백엔드가 바뀌거나 가공 규칙이 늘어도 앱은 그대로다.

## 1. 파이프라인의 뼈대: receivers → processors → exporters

otel-collector 설정은 크게 네 블록이다.

```yaml
receivers:               # 어디서 받나
  otlp:                  # 앱이 OTLP(gRPC 4317 / HTTP 4318)로 보낸 trace·메트릭·로그
processors:              # 어떻게 가공하나
  memory_limiter:        # 메모리 상한 — collector 자신이 OOM 나지 않게 먼저 방어
  batch:                 # 배치로 묶어 전송 효율↑
exporters:               # 어디로 내보내나
  otlp: ...              # SigNoz(ClickHouse) 백엔드
service:
  pipelines:             # 위 블록들을 신호별로 엮는다
    traces:  { receivers: [otlp], processors: [memory_limiter, batch], exporters: [...] }
    metrics: { receivers: [otlp], processors: [memory_limiter, batch], exporters: [...] }
    logs:    { receivers: [otlp], processors: [memory_limiter, batch], exporters: [...] }
```

핵심은 `service.pipelines`다. 블록을 정의만 해두면 아무 일도 일어나지 않고, <b>파이프라인에 엮어야</b> 그 경로가 동작한다. traces·metrics·logs가 각자의 파이프라인을 가지되 processor는 공유할 수 있다. 순서도 의미가 있어서, `memory_limiter`를 `batch`보다 앞에 두면 collector가 밀릴 때 먼저 배압을 걸게 된다.

앱 쪽은 이 receiver의 OTLP 엔드포인트만 알면 된다([[자바 메트릭 설정|자바 앱]]도 javaagent가 여기로 쏜다). 백엔드가 SigNoz든 다른 것이든, 바뀌는 건 exporter 한 곳이라 앱은 건드릴 일이 없다.

## 2. agent + gateway 2단으로 나눈 이유

collector를 한 덩어리로 두지 않고 역할을 둘로 갈랐다.

```text
[각 노드] app ──OTLP──▶ otel-collector agent (DaemonSet)   ← 노드/파드 로컬 수집
                              │  노드 메트릭·파드 로그·앱 OTLP를 모아
                              ▼  OTLP로 전달
[중앙]                  otel-collector gateway (Deployment)  ← 클러스터 레벨 집계
                              │
                              ▼
                          SigNoz (ClickHouse)
```

- <b>agent(DaemonSet)</b>: 노드마다 하나씩 떠서, 그 노드의 파드가 보낸 OTLP를 가까이서 받고 노드/파드 로컬 지표(kubelet·호스트 메트릭, 파일 로그)를 붙여 gateway로 넘긴다. 앱 입장에서는 "가장 가까운 노드-로컬 수신처"라서 네트워크 경로가 짧다.
- <b>gateway(Deployment/StatefulSet)</b>: 중앙에서 모아 클러스터 단위 가공(리소스 속성 정리 등)을 하고 백엔드로 내보낸다. 부하에 따라 스케일하는 지점도 여기다.

이렇게 나누면 노드-로컬 관심사(그 노드에서만 아는 것)와 클러스터 관심사(모아서 봐야 아는 것)가 분리된다. 부작용도 있는데, 두 계층이 같은 대상을 이중으로 긁으면 메트릭이 중복된다. 이 문제는 [[otel-collector 중복 스크래핑 이슈|따로]] 겪고 정리했다.

## 참고

- [[자바 메트릭 설정|자바 메트릭 수집 설정]]
- [[otel-collector 중복 스크래핑 이슈]]
- [[알람 구성|SigNoz 알람 구성]]
- [OpenTelemetry Collector — Configuration](https://opentelemetry.io/docs/collector/configuration/)
