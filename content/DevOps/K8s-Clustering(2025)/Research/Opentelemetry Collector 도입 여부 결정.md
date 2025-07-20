---
title: Opentelemetry Collector, 불신에서 확신으로
date: 2025-07-16
draft: true
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

> [!SUMMARY]
> 처음에는 불필요한 중간 계층이라 생각했던 Opentelemetry Collector가, 실제 사용해보니 벤더 종속성을 완벽히 제거하고 관측 가능성 파이프라인의 유연성을 극대화하는 핵심 컴포넌트임을 깨닫게 되었다. 초기 러닝커브는 오히려 장기적인 운영 효율성으로 돌아왔다.

## 1. 도입 검토와 초기 우려
솔직히 말해, 처음에는 Opentelemetry Collector가 왜 필요한지 전혀 이해하지 못했다. 관측 가능성(Observability) 스택을 구성하면서 마주친 Collector는 그저 **데이터 파이프라인 중간에 끼어있는 불필요하고 복잡한 계층**처럼 보였다. 애플리케이션에서 데이터를 바로 APM이나 로그 저장소로 보내면 될 텐데, 왜 굳이 Collector라는 것을 거쳐야 하는지 의문이었다.

> [!IMPORTANT]
> 당시 우리의 생각은 'Collector는 오버헤드만 유발할 뿐' 이라는 불신에 가까웠다. 러닝커브와 관리 포인트만 늘어날 것이라고 예상했다.

## 2. 테스트 과정에서 발견한 가치
우리가 검토하던 `SigNoz`가 Collector를 기본 아키텍처로 채택하고 있었기에, 우리는 마지못해 Collector를 테스트 환경에 구성하게 되었다. 파이프라인의 개념(Receiver, Processor, Exporter)을 익히는 것은 역시나 쉽지 않았다.

**하지만 진짜 깨달음은 다른 모니터링 스택을 추가로 테스트하는 과정에서 찾아왔다.**

기존 계획대로라면 새로운 모니터링 도구를 테스트하기 위해 각 애플리케이션의 데이터 전송 로직을 변경하거나, 별도의 에이전트를 또 설치해야 했을 것이다. 하지만 Opentelemetry Collector를 사용하자, 상황이 완전히 달라졌다.

**단지 Collector의 `otel-collector-config.yaml` 파일에 새로운 Exporter 설정을 몇 줄 추가하는 것만으로,** 모든 원격 측정 데이터를 새로운 백엔드로 손쉽게 보낼 수 있었다. 애플리케이션은 Collector의 존재조차 모른 채 평소처럼 데이터를 보낼 뿐인데, 운영자는 파이프라인 뒤단에서 데이터의 흐름을 자유자재로 제어할 수 있게 된 것이다.

> [!NOTE]
> 바로 이 순간, '특정 벤더에 종속되지 않는 유연한 구조'라는 말이 이론이 아닌 현실로 다가왔다. Collector가 제공하는 추상화 계층의 강력함을 온몸으로 체감했다.

## 3. 최종 도입과 활용
이 경험을 통해 우리는 Collector에 대한 불신을 완전히 거두고 확신을 갖게 되었다. 즉시 모든 노드에 Collector를 데몬셋(DaemonSet)으로 배포하여 클러스터의 모든 데이터가 Collector를 통해 흐르도록 아키텍처를 표준화했다.

초기에 우려했던 러닝커브와 복잡성은, 오히려 **장기적인 관점에서의 비교할 수 없는 유연성과 운영 효율성**으로 되돌아왔다. 지금은 Opentelemetry Collector 없는 관측 가능성 파이프라인은 상상할 수 없을 정도로 매우 만족하며 사용하고 있다.