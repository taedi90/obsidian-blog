---
title: MariaDB 슬로우 쿼리 로그로 병목 테이블을 추적하고 인덱스를 설계한 기록
date: 2026-07-24
draft: false
tags:
  - mariadb
  - slow-query
  - index
  - sqlalchemy
  - performance
  - kubernetes
  - troubleshooting
banner: 
cssclasses: 
description: 54MB 슬로우 쿼리 로그를 분석한 결과 알림 테이블과 이력 테이블이 병목이었다. 인덱스 부재, 버퍼 풀 부족, SQLAlchemy 동기 드라이버가 async 이벤트 루프를 막는 문제까지 한 번에 정리한 진단 기록.
permalink: 
aliases: 
completed: true
type:
  - issue
---

## 요약

> [!SUMMARY]
> 특정 API 엔드포인트가 290ms~48초까지 걸리는 문제를 추적했다. performance_schema가 꺼져 있어서 slow query log(1초 임계값, 54MB, 1413건)를 직접 분석했다. 알림 테이블이 전체 슬로우 쿼리의 47%를 차지했고, 컨테이너 이력 테이블이 16%. 원인은 단순했다. 인덱스가 없었다. 수백만 건 테이블에 secondary index가 0~1개뿐이었다. 여기에 버퍼 풀(4GB)이 데이터(7.3GB)의 55%밖에 되지 않아 디스크 I/O 부하가 커지고, 애플리케이션은 async def 안에서 sync DB 드라이버를 사용하여 이벤트 루프를 막고 있었다.

## 1. 환경

- MariaDB (Galera 3노드), mariadb-operator 관리, Kubernetes 위에 배포
- 애플리케이션: Python + SQLAlchemy (Uvicorn/Gunicorn 4 worker)
- 데이터베이스 엔진: 4개 이상 독립 SQLAlchemy engine
- 슬로우 쿼리 로그: 1초 임계값, 활성
- performance_schema: <b>비활성</b>
- 테이블명은 기능으로 서술했고, 실제 이름과 다르다.

## 2. 이슈

특정 API가 느리다는 보고가 들어왔다. 구체적으로 알림 카운트 조회 엔드포인트가 290ms씩 걸리고 있었다.

처음에는 Istio 프록시 지연을 의심했다. envoy access log를 확인하니 p50=174ms, p90=765ms였다. 메시 수준의 지연인가 싶었다. 그런데 애플리케이션 로그를 확인하니 패턴이 달랐다. 헬스체크와 인증 요청은 1~12ms로 정상인데, 특정 엔드포인트만 290ms로 일관되게 느렸다. 메시 문제가 아니라 애플리케이션 내부의 특정 쿼리가 느린 것이었다.

> [!NOTE]
> "전체가 느리다"와 "특정 엔드포인트만 느리다"는 전혀 다른 진단 경로로 이어진다. 전자는 인프라(CPU·메모리·네트워크)를 의심하고, 후자는 애플리케이션 로직과 쿼리를 의심한다. 이번엔 후자였다. 엔드포인트별 지연을 먼저 비교하는 것이 진단의 첫 단추다.

## 3. 해결

### 1. performance_schema가 꺼져 있다

DB 수준에서 쿼리 프로파일링을 하려고 `performance_schema.events_statements_summary_by_digest`를 조회했다. 결과가 비어 있었다.

```sql
-- 상위 쿼리를 실행 시간별로 뽑아보려 했으나 결과 없음.
SELECT * FROM performance_schema.events_statements_summary_by_digest
ORDER BY avg_timer_wait DESC LIMIT 10;
-- → empty set
```

` @@performance_schema = 0`으로 비활성화되어 있었다. 즉 DB 내장 프로파일러를 사용할 수 없었다.

> [!IMPORTANT]
> performance_schema가 꺼져 있으면 DB 자체 진단이 불가능하다. 운영 중 켜려면 재시작이 필요할 수 있어, 당장은 slow query log에 의존해야 한다. performance_schema를 기본값으로 켜두는 걸 습관화하면 장애 대응이 훨씬 빨라진다.

### 2. 슬로우 쿼리 로그: 54MB, 1413건

대신 slow query log를 확인했다. 1초 임계값으로 설정되어 있었고, 1413건이 넘었다. 로그 파일 크기는 54.1MB였다.

`mysqldumpslow`로 집계하려 했으나 결과가 나오지 않아(버전 문제로 추정) 직접 tail과 grep으로 분석했다.

패턴이 두 가지로 나뉘었다.

- <b>N+1 패턴</b>: 단순 `COUNT(*)` 쿼리가 연속으로 실행되며 각각 1~5초씩 걸린다. 5천~8천 행을 풀스캔하면서 실행되는 것이다. 인덱스가 있으면 즉시 끝나야 할 쿼리들이다.
- <b>복잡한 서브쿼리</b>: `EXISTS` 서브쿼리가 SELECT 절에 들어가 행마다 재평가되는 패턴이었다. 한 쿼리는 43만 행을 검사했다. SQLAlchemy가 생성한 쿼리로 보인다.

슬로우 쿼리 로그를 끝까지 분석해 보니 병목이 특정 테이블에 집중되어 있었다. 여기서 테이블명은 기능으로 서술한다.

| 테이블 (기능) | 슬로우 쿼리 수 | 비율 | 평균 실행시간 | 최대 |
|---|---|---|---|---|
| 알림 테이블 | 668 / 1413 | <b>47%</b> | 8.955s | 48.6s |
| 컨테이너 이력 테이블 | 232 / 1413 | 16% | 2.099s | 10.0s |
| 사용자 인증 로그 테이블 | (고비용) | — | 3.862s | 35.1s |
| 사용자 테이블 (distinct join) | (고비용) | — | 9.943s | 87.6s |

알림 테이블 하나가 전체 슬로우 쿼리의 절반을 차지하고 있었다.

### 3. 원인: 인덱스가 없다

테이블 스키마를 확인하니 답이 바로 나왔다. 인덱스가 없었다.

| 테이블 (기능) | 행 수 | secondary index 수 |
|---|---|---|
| 알림 테이블 | 228K | 1개 (`user_id` 단일) |
| 컨테이너 이력 테이블 | 35K | <b>0개</b> |
| 사용자 인증 로그 테이블 | 41K | <b>0개</b> |
| 채팅 발행 이력 테이블 | 1.7K | <b>0개</b> |
| 승인 테이블 | 9.8K | <b>0개</b> |
| 워크플로우 큐 테이블 | 11.5M | 1개 |
| 서빙 큐 테이블 | 9.3M | 1개 |

수백만 건 규모의 큐 테이블은 secondary index가 1개뿐이었고, 잦은 쿼리가 들어오는 작은 테이블들은 아예 0개였다.

알림 테이블에 있는 단일 인덱스(`user_id`)도 효율이 낮았다. `user_id`만 포함하고 있어서 실제 쿼리의 WHERE 조건(`user_id` + 다른 컬럼)을 커버하지 못한다. 슬로우 로그를 보면 이 인덱스를 사용하기는 하지만 수천 행을 검사한 후 WHERE 필터로 99.5%~73%를 걸러낸다. 즉 인덱스를 사용하기는 하지만 필터링 효율이 0.35~0.70%에 불과하다.

> [!IMPORTANT]
> "인덱스가 있다"와 "인덱스가 효과적이다"는 서로 다른 문제이다. 단일 컬럼 인덱스가 있어도, 실제 쿼리의 WHERE 조건이 복합 컬럼이면 그 인덱스는 대부분의 행을 검사한 뒤 필터링하는 셈이 된다. 복합 인덱스(composite index)를 WHERE 조건 순서에 맞게 만들어야 진짜 효과가 난다.

구체적인 WHERE 패턴을 분석해 보니 다음과 같은 복합 인덱스가 필요했다.

- <b>사용자 인증 로그 테이블</b>: `(user_id, type_code, reg_date)`. 쿼리가 항상 이 세 컬럼으로 필터링한다.
- <b>컨테이너 이력 테이블</b>: `(resource_type, resource_id, resource_revision_id, status)` + `ORDER BY (timestamp, id)`. WHERE 조건과 정렬 컬럼까지 인덱스에 넣어야 filesort를 피할 수 있다.
- <b>알림 테이블</b>: `user_id` 단일 인덱스를 `(user_id, ...)` 복합 인덱스로 교체한다.

### 4. 버퍼 풀이 데이터의 절반에도 미치지 못한다

인덱스만 문제가 아니었다. 버퍼 풀을 확인하니 4GB로 설정되어 있었다. 그런데 활성 데이터는 7.32GB였다. 버퍼 풀이 데이터의 54.7%밖에 커버하지 못한다.

```
Buffer pool: 4GB configured
Active data: 7.32GB
Coverage: 54.7%
Cache misses: 70,304 (99.91% hit rate)
Read requests: 80M
```

hit rate 99.91%면 높아 보이지만 절대치로는 70,304회 cache miss이다. 8천만 건의 read 요청 중 7만 건이 디스크로 향한다. 인덱스가 없어서 풀스캔을 수행하는 상황에서 디스크 I/O 부담까지 더해지면 단순 `COUNT(*)`가 1~5초 걸리는 현상이 설명된다.

> [!NOTE]
> hit rate 99.91%는 "문제가 없다"로 읽히기 쉽다. 하지만 절대 miss 수(7만 회)가 중요하다. 풀스캔 쿼리가 디스크에 부하를 주면 hit rate가 높아도 실제 지연은 커진다. hit rate만 보고 "DB는 정상이다"라고 판단하면 안 된다.

### 5. 애플리케이션: async def 안에서 sync DB 드라이버

여기까지가 DB 쪽 진단이었다. 애플리케이션 쪽을 살펴보면 문제가 더 깊었다.

애플리케이션은 `async def` 핸들러를 사용한다. 그런데 DB 드라이버는 sync 방식인 `mysqlconnector`를 사용한다. 137개 파일이 `@async_transactional` 데코레이터를 사용하고, 38개 파일이 `@transactional`을 사용한다. 즉 async 핸들러 안에서 sync DB I/O를 호출하는 구조이다.

sync DB 호출이 1~5초 걸리면 그동안 Uvicorn 워커의 이벤트 루프가 통째로 멈춘다. 해당 워커에 대기 중인 다른 async 요청도 전부 블로킹된다. 전통적인 thread-per-request 모델이었다면 한 스레드만 막혔을 텐데, async + sync driver 조합에서는 워커 전체가 막힌다.

여기에 Gunicorn 워커가 4개뿐이다. 4개의 이벤트 루프 중 하나가 5초 동안 멈추면 시스템 throughput의 25%가 그 5초 동안 사라진다.

> [!IMPORTANT]
> async def 핸들러에 sync DB 드라이버를 사용하면 async의 이점이 사라진다. 한 쿼리가 느려지면 해당 워커의 모든 async 요청이 대기한다. async를 쓴다면 DB 드라이버도 async(`asyncmy` 등)로 맞추거나, sync 드라이버를 쓴다면 thread pool로 실행해 이벤트 루프를 보호해야 한다.

### 6. SQLAlchemy 연결 풀: 기본값에 "사용자 많음" 에러로 대응

마지막 문제가 하나 더 있었다. 애플리케이션이 4개 이상의 독립 SQLAlchemy engine을 생성하는데 풀 설정을 명시하지 않아서 기본값(`pool_size=5`, `max_overflow=10`)을 사용하고 있었다. 엔진당 최대 15개 연결이고 4개 엔진이면 약 60개이다. 실제로 57개 연결이 관측되었다.

느린 쿼리(1~5초)가 연결을 오래 점유하면 연결 풀이 빠르게 고갈된다. 그리고 애플리케이션 코드에 다음과 같은 부분이 있었다.

```python
# QueuePool 고갈 시 사용자에게 보여주는 에러 메시지.
error_code = '00020004'
message = "Too many users, please try again later"
```

즉 개발자가 연결 풀 고갈을 <b>알고 있었다</b>. 그런데 근본 원인(풀 사이즈 설정)을 수정하는 것이 아니라 에러를 잡아서 사용자에게 "사용자가 너무 많다"고 보여주는 것으로 대응하고 있었다.

> [!IMPORTANT]
> 에러 핸들링은 근본 해결이 아니다. "Too many users"는 사용자에게 책임을 전가하는 메시지인데 실제로는 느린 쿼리와 작은 연결 풀의 조합이 원인이다. 풀 사이즈를 올리고 느린 쿼리에 인덱스를 추가하면 이 오류 자체가 발생할 일이 없어진다.

## 4. 확인

이 글은 진단까지의 기록이다. 실제 수정(인덱스 추가, 버퍼 풀 상향, 풀 설정, async 드라이버 전환)은 별도 작업으로 진행했다.

확인 포인트는 다음과 같다.

```sql
-- 1. 추가한 복합 인덱스가 실제로 쓰이는지 EXPLAIN으로 확인한다.
EXPLAIN SELECT ... FROM 알림_테이블 WHERE user_id = X AND ...;
-- → type: ref, rows: (수십 건 이하)면 OK. type: ALL이면 인덱스 안 타는 거다.

-- 2. 슬로우 쿼리 수가 줄었는지 확인한다.
SHOW GLOBAL STATUS LIKE 'Slow_queries';
-- → 1413건 기준에서 증가 속도가 둔화되어야 한다.

-- 3. 버퍼 풀 히트율과 miss 수를 다시 찍어본다.
SHOW ENGINE INNODB STATUS\G
-- → Buffer pool hit rate / cache miss 수 비교.
```

> [!NOTE]
> 이 진단의 핵심은 "performance_schema가 없어도 slow query log로 충분히 깊이 분석할 수 있다"는 점이다. 54MB 로그를 직접 분석하는 것은 번거롭지만 병목이 어디에 있는지는 명확하게 보여준다. 인덱스 부재, 버퍼 풀 부족, 애플리케이션 드라이버 불일치라는 세 층이 한 번에 드러난다. DB 진단에는 도구보다 데이터를 읽는 끈기가 핵심이라고 생각한다.
