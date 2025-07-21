---
title: Agpl-3.0 라이선스 검토
date: 2025-06-25
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
  

- prometheus - apache-2.0

- jaeger - apache-2.0

- OpenTelemetry Collector - apache-2.0

- opentelemetry java - apache-2.0

  

- lgtm - agpl-3.0

- minio -

  
  
  

- 고객사에서 Agpl-3.0 오픈소스를 거부할 경우 대응

- 내부망이 아닌 외부 네트워크에 grafana, kibana 또는 iframe 방식으로 임베딩된 자사 웹 페이지를 노출했을 경우에 발생할 이슈

- 라이선스 고지

- (코드 변경시) 소스코드 제공 의무

  
  
  

## 우려되는 시나리오

- 오픈소스를 도입했다가 보안이슈가 발생했으나 오픈소스 제공사에서 긴급 대응을 해주지 않는 경우

- 소스코드 수정을 하면 코드 공개의무 발생

  
  
  
  

https://sktelecom.github.io/guide/use/obligation/agpl-3.0/

  

네트워크 상호작용

- 변경 사항이 있으면 변경 소스코드 다운로드 링크 필요

  

공개 범위 이슈

- grafana 그래프를 iframe 을 이용해 임베딩 할 경우 agpl-3.0 라이센스에 따라 자체 웹 서비스도 소스코드 공개 의무가 발생할까?

  
  
  

- - 저작권 고지

- 라이선스 안내(AGPL-3.0임을 명확히)

- 보증 부인(There is no warranty 등)

- 소스코드 입수 방법 안내

- **구체적 구현 예시**

- 웹 서비스라면, 화면의 눈에 띄는 위치(예: 하단, 메뉴, 별도 "About" 또는 "Source" 링크)에 위 정보를 표시합니다.

- "소스코드 보기" 또는 "S