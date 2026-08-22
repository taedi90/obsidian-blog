---
title: LLM 관측성(Langfuse) 아키텍처 설계 - OTLP 페이로드 한계, Media API, ClickHouse 분리
date: 2026-05-12
draft: false
tags:
  - observability
  - langfuse
  - opentelemetry
  - clickhouse
  - llm-observability
  - architecture
banner: 
cssclasses: 
description: 채팅·LLM 응답 trace가 OTLP 페이로드 한계에서 잘리는 문제를, Media API 경로와 OTLP 경로로 나누고 ClickHouse를 분리해 설계한 기록.
permalink: 
aliases: 
completed: true
type:
  - comparison
---

## 요약

> [!SUMMARY]
> LLM 트레이싱을 <b>Langfuse</b>로 연결하려는데, 채팅 본문과 LLM 응답이 OTLP 페이로드 한계에 걸려 trace가 잘렸다. 그래서 256KB를 넘는 페이로드는 <b>Media API</b>로 S3/MinIO에 오프로드하고 나머지는 OTLP로 보내는 두 경로로 나눴고, 저장 부하을 감안해서 <b>ClickHouse</b>도 따로 분리했다.

## 1. 개요

이미 사내 관측성 스택은 OTel Collector + ClickHouse + SigNoz로 운영되고 있었다. 로그·메트릭·트레이스를 한곳에서 보는 인프라 관측성 쪽은 그것으로 충분했다. 이 글은 거기에 더하는 이야기가 아니라, 성격이 다른 <b>LLM 트레이싱(LLM tracing)</b>을 어떻게 연결할지 설계한 기록이다.

LLM 트레이싱은 일반 분산 추적과 바라보는 각도가 다르다. 인프라 관측성이 "어느 서비스에서 몇 ms 걸렸나"를 본다면, LLM 트레이싱은 "이 요청에 어떤 프롬프트가 들어갔고, 모델이 무엇이라고 답했고, 그 답이 얼마나 괜찮았나(score)"를 본다. 프롬프트·응답 본문 자체가 관측 대상이라는 점이 결정적으로 다르다. 그래서 LLM 전용 도구인 Langfuse를 따로 두기로 했다.

Langfuse를 선택한 이유는 단순하다. OTel 기반으로 연결할 수 있어 벤더에 덜 묶이고(계약상으로도 OpenAPI·OCI·OpenTelemetry·MLflow 같은 개방형 표준으로 벤더 종속을 최소화하라는 조항이 있었다), 프롬프트 관리와 LLM-as-a-judge 같은 후처리가 한 도구 안에 들어 있었다. 문제는 연결하자마자 나타났다. (처음에는 OTLP 하나로 모두 보내려 했지만, 이것이 장벽이었다.)

## 2. OTLP 페이로드 한계

연결해 보니 채팅 trace의 input/output이 통째로 사라지거나 잘려서 들어왔다. 원인은 페이로드 크기였다.

두 층위의 한계가 있다.

- <b>Langfuse 수집(ingestion) API의 본문 한계</b>: Langfuse 서버가 받아주는 요청 한 건의 본문에는 4.5MB 상한이 있다. OTLP 프로토콜 자체의 한계가 아니라 Langfuse 수집 엔드포인트에 하드코딩된 값이라, 환경변수로 올려 잡히지도 않는다. 소스를 수정해 다시 빌드하지 않는 한 변경할 수 없는 제약이었다.
- <b>Langfuse의 input/output 오프로드 기준</b>: 그 아래에서 Langfuse SDK는 기본적으로 span의 input/output이 256KB(`LANGFUSE_INPUT_OUTPUT_MAX_SIZE`)를 넘으면 본문을 그대로 보내지 않고 별도 경로로 분리한다.

문제는 채팅이다. 멀티턴 대화 이력에 첨부·컨텍스트까지 실리면 본문은 <b>256KB를 쉽게 넘긴다</b>. LLM 응답도 길어지면 마찬가지다. 결국 "OTLP 하나로 다 보내겠다"는 방안은 성립하지 않았다. S3 오프로드 경로를 사용하지 않고 OTLP 단일 경로를 유지할 옵션이 있는지 한참 찾아봤지만 없었다.

## 3. OTLP 경로와 Media API 경로

그래서 크기를 기준으로 경로를 둘로 나눴다.

<b>256KB 이하: OTLP 경로.</b> 서비스가 OTLP/HTTP로 Langfuse에 직접 전송하고, 메타데이터는 PostgreSQL에, 본문은 ClickHouse에 그대로 저장된다. span의 input/output이 본문째 DB에 저장되므로 Langfuse UI에서 텍스트 검색·필터·정렬이 모두 가능하고, LLM-as-a-judge나 score 같은 후처리도 본문에 접근할 수 있다. 이것이 가장 편한 정상 경로다.

```text
서비스 ──[OTLP/HTTP]──> langfuse-web ──> PostgreSQL(메타) + ClickHouse(본문)
# input/output이 본문째 저장 → UI 검색·필터·정렬·score 후처리 모두 가능
```

<b>256KB 초과: Media API 경로.</b> Langfuse SDK가 첨부 업로드를 처리하는 부분에서 자동으로 발동한다. 흐름은 3단계다.

```text
1) POST  /api/public/media        → mediaId + presigned uploadUrl 발급
2) PUT   {uploadUrl}              → S3/MinIO에 직접 업로드 (Langfuse 서버 미경유)
3) PATCH /api/public/media/{id}   → 업로드 완료 통보
```

여기서 중요한 점은 실제 본문이 <b>Langfuse 서버를 거치지 않고</b> presigned URL로 S3/MinIO에 바로 올라간다는 것이다. PostgreSQL에는 메타데이터만 남는다(`mediaId`, `contentType`, `contentLength`, `sha256Hash`, `traceId`, `field`, `uploadedAt`). trace에는 본문 대신 참조 토큰이 기록되고, 조회할 때 그 토큰으로 원본을 불러온다.

대가가 하나 있다. 오프로드된 본문은 DB에 텍스트로 존재하지 않으니 <b>Langfuse UI의 텍스트 검색 대상에서 빠진다</b>. 처음에는 이 점이 걸렸지만, 대상이 대화 본문이라 그대로 진행하기로 했다. 대화는 traceId·세션·사용자·시간으로 찾지 본문 문자열로 전문 검색할 일이 실무에서 거의 없었다. (물론 "언젠가 필요하면?"이라는 미래의 내가 떠오르긴 했다.)

전제가 하나 붙는다. Media API가 동작하려면 Langfuse가 <b>S3/MinIO 백엔드를 공유</b>하고 있어야 한다. 다행히 기존 LLM 서비스용 오브젝트 스토리지 버킷을 재사용하면 되었으므로, 이 전제는 이미 충족되어 있었다.

## 4. Media API가 필요한 모듈

모든 모듈에 Media API를 켤 필요는 없다. 판단 기준은 하나였다. <b>사용자 페이로드(채팅·LLM 응답·분석 결과)를 trace에 실어 보내는가</b>. 실어 보내면 256KB를 넘길 수 있으므로 필요하고, trace를 만들지 않거나 읽기 전용이면 불필요하다.

역할별로 보면 이렇다(내부 서비스명은 역할로 일반화했다).

| 서비스 역할 | 연결 방식 | Media API | 비고 |
| --- | --- | --- | --- |
| 채팅 API | OTEL + 요청/응답 캡처 미들웨어 | 필요 | 채팅 본문·SSE 스트리밍, 256KB 쉽게 초과 |
| 서빙 게이트웨이 | OTEL + 서빙 span 필터 | 필요 | LLM 응답이 대용량 가능 |
| 데이터 분석 API | OTEL + 미들웨어 | 필요 | 분석 결과 페이로드가 큼 |
| 포털 API | OTEL + 미들웨어 | 조건부 | 일반 요청 위주, 일부 LLM 호출만 초과 |
| 워크플로우 서비스 | OTEL | 필요 | 중간 결과 누적 |
| 관리 API | Proxy 엔드포인트만 제공 | 불필요 | trace 생성 안 함, URL 생성·조회만 |
| Langfuse 프록시 | iframe 게이트웨이 | 불필요 | trace 송신 없음, 세션 변환·CSP 처리 전용 |
| OSS 워크플로우 빌더 | Langfuse JS SDK (프롬프트 조회) | 불필요 | 읽기 전용 |

정리하자면 사용자 본문을 trace에 싣는 채팅·서빙·분석·워크플로우 쪽만 Media API를 켜고, trace를 만들지 않는 프록시류와 프롬프트만 읽는 모듈은 그대로 두었다.

## 5. ClickHouse 분리와 데이터 유실 대비

Langfuse는 본문을 ClickHouse에 넣는다. 사내 관측성 스택(SigNoz)도 ClickHouse를 사용한다. 하나로 합칠까 고민했지만, <b>ClickHouse를 별도로 분리</b>하는 쪽이 안정적이라고 판단했다. LLM trace의 쓰기 부하와 인프라 관측성 데이터가 한 DB에서 섞이면 서로 성능에 영향을 주고, 스키마·TTL·백업 정책도 성격이 달라 함께 묶을 이유가 없었다. 노드 간 스키마 불일치 같은 번거로운 문제도 분리해 두면 영향 범위가 줄어든다.

수집 파이프라인에는 <b>OTel Collector</b>를 둔다. 서비스가 Collector로 보내고 Collector가 다시 내보내는 구조인데, 벤더 중립성 말고도 Collector의 큐가 완충 역할을 한다는 점이 컸다.

여기서 계속 신경 쓴 것은 <b>데이터 유실 대비</b>였다. LLM trace는 결국 나중에 모델을 평가하고 개선하는 근거가 되는데, 조용히 유실되면 근거가 비게 된다. "어느 수준까지의 유실을 감수할 것인가"를 기준으로 방어선을 여러 겹 두고 살펴봤다.

- Langfuse 자체 스케일링으로 수집 측 병목 완화
- 코드 레벨 retry
- OTel Collector의 큐(버퍼)
- Langfuse가 내부적으로 쓰는 Redis 큐(BullMQ)가 죽으면 큐가 통째로 날아갈 수 있으니, Redis persistence를 켜서 그 구멍을 막는다

어디서 어떻게 누수되는지 파악하고 감당 가능한 선까지 막아 두는 것으로 충분했다. (Kafka까지 앞단에 두는 방안도 검토했지만, 지금 트래픽에서는 과했다.)

## 6. 시각화 도구 비교

Langfuse UI는 LLM 디버깅·프롬프트 관리에는 좋지만, 그 옆에서 ClickHouse에 쌓이는 로그·메트릭·트레이스를 프론트에 임베드해서 보여줄 도구가 따로 필요했다. `otel-collector-contrib`의 `clickhouseexporter`로 넣은 데이터를 그대로 재활용하는 것이 핵심이었으므로, <b>OSS 라이선스</b>와 <b>`clickhouseexporter` 스키마 호환성</b>을 중심으로 후보를 비교했다.

| 도구 | OSS 라이선스 | `clickhouseexporter` 스키마 호환 | 강점 | 약점 |
| --- | --- | --- | --- | --- |
| HyperDX (ClickStack) | MIT(UI) + Apache 2.0 | ⚠️ schema-agnostic 옵션, 자체 스키마 권장 | 세션 리플레이, ClickHouse 본가 지원 | 신생이라 아직 판단이 안 됨, MongoDB를 얹어야 |
| Grafana + ClickHouse plugin | AGPLv3 / Apache 2.0 | ✅ 완전 호환 | 성숙, 패널 임베드, 생태계 | 관측성 전용 UX는 아님 |
| Uptrace | AGPLv3 | ❌ 자체 스키마 | 자동 대시보드 | contrib exporter 데이터 재사용이 안 됨 |
| SigNoz | MIT | ❌ 자체 스키마 | APM 화면 강력 | 임베드가 안 되고 스키마 종속 |

Uptrace와 SigNoz는 자체 스키마를 사용하므로, `clickhouseexporter`로 넣어 둔 데이터를 그대로 읽지 못한다. 특히 프론트 임베드가 요건이었는데, SigNoz는 패널 단위 iframe 임베드를 지원하지 않고 대시보드 단위 공유만 가능했다(이미 사내 인프라 관측성용으로 SigNoz를 사용하고 있었지만, 임베드 요건은 별개 문제였다). HyperDX는 매력적이지만 신생이고, 무엇보다 별도로 MongoDB를 요구했다.

## 7. 도입안

일단 <b>Grafana + ClickHouse plugin</b>으로 가기로 했다.

- `clickhouseexporter` 스키마와 완전 호환이므로 넣어 둔 데이터를 그대로 활용한다.
- 패널 단위 iframe 임베드가 돼서 프론트 연동 요건을 만족한다.
- 이미 익숙하고 생태계가 두껍다.

HyperDX 도입은 미뤘다. 세션 리플레이 같은 기능은 매력적이지만 MongoDB를 새로 추가해야 하고, 지금은 Grafana로 요건이 충족된다. 대신 Grafana는 ClickHouse 플러그인 때문에 <b>별도 이미지</b>가 필요하다는 점은 감수한다. 메트릭 쪽은 기존 Prometheus를 그대로 유지한다.

AGPLv3 플러그인이라 나중에 패키징에서 문제가 될 여지는 남는다. 우선 Grafana로 진행하고, 문제가 생기면 그때 판단한다.

## 참고

- [Langfuse — OpenTelemetry 연동](https://langfuse.com/docs/opentelemetry/get-started)
- [Langfuse — Multi-modality & Attachments (Media API)](https://langfuse.com/docs/tracing-features/multi-modality)
- [OTel Collector Contrib — clickhouseexporter](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/exporter/clickhouseexporter)
- [ClickHouse Observability — Integrating OpenTelemetry](https://clickhouse.com/docs/observability/integrating-opentelemetry)
- [ClickHouse Observability — Grafana](https://clickhouse.com/docs/observability/grafana)
- [Grafana ClickHouse datasource 플러그인 설정](https://grafana.com/docs/plugins/grafana-clickhouse-datasource/latest/configure/)
- [ClickStack Helm charts](https://github.com/ClickHouse/ClickStack-helm-charts)
