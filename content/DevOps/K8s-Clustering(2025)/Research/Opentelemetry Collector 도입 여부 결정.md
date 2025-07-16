---
title: Opentelemetry Collector 도입 여부 결정
date: 2025-07-16
draft: true
tags: 
banner: 
cssclasses: 
description: 
permalink: 
aliases: 
completed: 
type:
  - issue
  - note
  - comparison
---

## 장점 (왜 써야하는가?)

- 데이터 표준화: 다양한 데이터 형식(트레이스, 메트릭, 로그 등)을 하나의 표준(OpenTelemetry 프로토콜)으로 통합 처리할 수 있다.
    
- 벤더 중립성: 특정 벤더에 종속되지 않고, 다양한 백엔드(APM, 로그 저장소, 시각화 도구 등)로 데이터를 내보낼 수 있다.
    
    - 관측 데이터를 여러 백엔드로 전송하는 것도 가능하다.
        
- 컴포넌트 단일화/축소: 여러 개별 수집기(예: Prometheus Exporter, Fluent-bit 등)를 하나로 통합 운영할 수 있어, 관리 복잡도가 크게 줄어든다.
    
- 다양한 언어|플랫폼 지원
    
    - 벤더 종속적 수집/분석 도구의 스펙에 구애받지 않고 메트릭을 수집, 전송하는데 용이
        

## 꼭 써야하는가?

- 데이터 표준화 측면: 최근 많은 오픈소스들이 otlp를 지원해서 사실 otel collector를 반드시 도입하지 않아도 향후 컴포넌트 변경이 어렵지 않을 것으로 보인다.
    
- 성능 및 학습 측면: 백엔드가 단독으로 처리할 수 있는 것을 불가피하게 레이어가 추가되어 오히려 성능 오버헤드를 가져오거나 러닝커브를 가져올 우려도 있다.
    

## 서비스 구조

opentelemetry collector 를 사용하기 위해서는 서비스를 구성해야 함

- service(pipeline)
    
    - extensions
        
    - pipeline
        
        - receiver: 외부에서 데이터를 수집 (OTLP, Jaeger, Prometheus 등 다양한 프로토콜 지원)
            
        - processor: 데이터 처리 및 변환 (batch, memory_limiter, transform 등)
            
        - exporter: 처리된 데이터를 외부 백엔드로 전송 (Jaeger, Prometheus, Zipkin 등)
            

이후 외부 backend 로 전송

## 문제점

- prometheus 의 경우에 각 메트릭이 정상적인지 UI 로 직관적으로 확인할 수 있지만, Otel Collector 를 경유할 경우 로그를 통해 파악을 하거나 config 를 지나치게 복잡하게 구성해야하는 문제가 있음
    
- 성능 오버헤드
    

## 기타

- 기본버전과 contrib 버전 차이