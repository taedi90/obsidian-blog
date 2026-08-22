---
title: otel-collector 중복 스크래핑 이슈
date: 2025-07-16
draft: false
tags:
  - otel-collector
  - opentelemetry
  - scraping
  - troubleshooting
banner: 
cssclasses: 
description: agent(DaemonSet)와 gateway가 같은 대상을 둘 다 긁어 메트릭이 중복 수집되던 문제. 노드-로컬 스코프로 스크래핑을 나눠 해결한 기록.
permalink: 
aliases: 
completed: true
type:
  - issue
---

## 요약

> [!SUMMARY]
> otel-collector를 [[Otel pipeline|agent(DaemonSet)+gateway]] 2단으로 나눈 뒤, 같은 대상을 두 계층이 <b>둘 다 스크래핑</b>해서 메트릭이 중복으로 들어오는 문제가 있었다. 카운트가 부풀고 집계와 알람이 틀어졌다. 해결 방법은 "누가 무엇을 긁을지"를 명확히 나누는 것이다. 노드-로컬 대상(kubelet·파드 등)은 <b>자기 노드 것만</b> agent가 긁도록 스코프를 걸고, 클러스터 단위 대상은 gateway 한 곳에서만 긁게 했다.

수집기를 늘리면 커버리지가 좋아지지만, 스코프를 안 정하면 같은 걸 여러 번 세게 된다.

## 1. 증상

메트릭 값이 실제보다 크게 잡혔다. 특히 파드/노드 단위 카운터가 배수로 부풀었다. DaemonSet인 agent가 노드마다 떠 있는데, 각 agent가 <b>노드-로컬이 아니라 전체 대상</b>을 긁거나, agent와 gateway가 동일 대상을 각자 스크래핑하면, 같은 샘플이 여러 경로로 들어와 중복 집계된다.

이게 위험한 건 값이 "그럴듯하게" 커진다는 점이다. 완전히 깨지면 바로 알아채지만, 2배·3배로 부푸는 건 알람 임계치나 용량 산정을 조용히 오염시킨다.

## 2. 원인: 스코프 없는 스크래핑

2단 구조에서 스크래핑 대상을 나눠두지 않으면 이렇게 겹친다.

- <b>DaemonSet agent가 노드 스코프를 걸지 않았을 때</b>: 노드가 N개면 같은 클러스터-와이드 대상을 N개 agent가 각각 긁으므로 그대로 N중 중복이 된다.
- <b>agent와 gateway가 같은 대상을 둘 다 긁을 때</b>: 계층은 나눴지만 스크래핑 책임을 나누지 않아서 이중 수집이 된다.

## 3. 해결: 누가 무엇을 긁을지 나눈다

원칙은 "<b>노드-로컬은 자기 노드 것만, 클러스터-와이드는 한 곳에서만</b>"이다.

- <b>노드-로컬 대상</b>(kubelet/파드 지표 등)은 DaemonSet agent가 <b>자기 노드에 속한 대상만</b> 긁도록 스코프를 건다. 스크래핑 대상 발견에 노드 이름 필터(파드의 `spec.nodeName`이 자기 노드인 것만)를 걸어, 각 agent가 남의 노드 파드를 긁지 않게 한다.
- <b>클러스터-와이드 대상</b>(클러스터 전역에서 한 번만 보면 되는 것)은 agent에서 빼고 <b>gateway(또는 단일 수집 지점)에서만</b> 긁는다.

정리하면 중복은 "수집기를 여럿 둔 것" 자체가 아니라 "그 여럿에게 같은 일을 시킨 것"이 원인이었다. 계층을 나눴으면 스크래핑 책임도 같이 나눠야 한다.

## 참고

- [[Otel pipeline]]
- [[SigNoz infra monitoring 에서 메모리가 높게 뜨는 증상]]
- [OpenTelemetry — Kubernetes collector](https://opentelemetry.io/docs/platforms/kubernetes/collector/)
