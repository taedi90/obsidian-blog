---
title: "관리 대시보드 응답 지연 진단: Hibernate 다중 조인과 인덱스 부재"
date: 2024-09-23
draft: false
tags:
  - troubleshooting
  - hibernate
  - jpa
  - database
  - performance
  - sql-tuning
banner: 
cssclasses: 
description: 관리 대시보드 조회 성능이 저하되어, API 로그에 기록된 Hibernate 쿼리를 추적한 결과 목록 조회가 8개가 넘는 테이블을 조인하고 비인덱스 컬럼으로 필터와 카운트를 수행하고 있음을 확인한 기록.
permalink: 
aliases: 
completed: true
type:
  - issue
---

## 요약

> [!SUMMARY]
> 관리 대시보드의 작업 목록 조회가 느렸다. API 로그의 Hibernate SQL을 추적해 보니 목록을 한 번 여는 동안 비인덱스 컬럼(`domain_id`)으로 카운트와 필터를 수행하는 쿼리와, 연관관계가 <b>EAGER</b>로 설정되어 8개가 넘는 테이블을 `LEFT OUTER JOIN`하는 쿼리가 함께 실행되고 있었다. 인덱스 추가와 fetch 전략 조정을 개선 지점으로 도출하여 애플리케이션 팀에 전달했다.

## 1. 환경

- 관리 대시보드 프론트 + 백엔드 REST API (Spring Boot, Hibernate ORM)
- RDBMS: MySQL/MariaDB 계열 (발행 SQL에 `limit` 절이 붙는 걸로 추정)
- 문제 화면: 작업(job) 목록 조회

인프라 담당이므로 원래 이 애플리케이션의 소스를 확인할 일은 없다. 그런데 "대시보드가 느리다"는 이야기가 반복해서 올라왔고, 정작 애플리케이션 개발은 다른 업체가 맡고 있어서 원인부터 특정해 주어야 후속 논의가 진행될 수 있는 상황이었다. 그래서 로그부터 확인했다.

## 2. 이슈

작업 목록 화면을 여는 데 체감상 몇 초씩 걸렸다. 느린 구간이 프론트엔드인지, 네트워크인지, DB인지부터 구분해야 했으므로 API 컨테이너 로그를 확인했다. 목록 요청 하나가 이렇게 로그를 남기고 있었다.

```text
# 목록 요청 시작과 끝 사이. 시작 40초, 끝 49초 — 이 요청 하나에 약 9초.
[API] [2024-09-23 14:46:40] [http-nio-8080-exec-1] [INFO] c.app.job.JobManagerService - start job query
...
[API] [2024-09-23 14:46:49] [http-nio-8080-exec-1] [INFO] c.app.job.JobManagerService - end job query
```

목록을 한 번 여는 데 약 9초가 걸렸고, 그 사이에 Hibernate가 여러 개의 SQL을 발행하고 있었다. 프론트엔드나 네트워크가 아니라 이 구간이 병목이라는 사실은 확실해졌다. 그러므로 이 9초 동안 정확히 어떤 쿼리가 발행되는지를 확인해야 했다.

## 3. 해결

### 1. 발행되는 SQL부터 확인

Hibernate는 `show_sql` 옵션을 켜면 실제로 발행하는 SQL을 로그로 출력한다. 다행히 이 API는 이미 SQL 로깅이 활성화되어 있었으므로, `start job query`와 `end job query` 사이에 기록된 `Hibernate:` 블록을 그대로 읽으면 되었다. ORM이 자동으로 생성해 주는 쿼리는 편리한 대신 내용이 잘 드러나지 않는데, 이럴 때는 로그로 실제 쿼리를 직접 확인해야 한다.

목록 한 번에 나가는 쿼리는 크게 세 부류였다.

- 카운트 쿼리 (전체 건수)
- 목록 select (페이지 한 장)
- 목록에 얹을 부가 정보를 채우는 연관관계 조회 여러 개

### 2. 카운트·필터가 비인덱스 컬럼을 탄다

먼저 눈에 띈 것은 카운트 쿼리였다. 작업 테이블 전체를 `domain_id`로 필터해서 세고 있었다.

```sql
-- 목록 상단의 전체 건수. domain_id로 OR 필터해서 COUNT.
select count(job0_.job_id)
from   app_job.tb_job_master job0_
where  job0_.domain_id = ?
    or job0_.domain_id = ?
```

이어지는 목록 select도 같은 `domain_id` 필터에 `limit`만 붙은 형태였다. 문제는 이 `domain_id`에 인덱스가 없다는 점이다. 인덱스가 없으면 필터든 카운트든 <b>풀 스캔</b>으로 간다. 작업 테이블은 데이터가 계속 쌓이는 성격이므로, 데이터가 증가할수록 이 카운트와 필터 작업이 그대로 무거워진다. 결국 목록을 열 때마다 카운트와 select가 각각 풀 스캔을 한 번씩 수행하는 구조였다.

### 3. EAGER 연관관계가 부른 8개 이상 테이블 조인

더 심각한 것은 목록에 정보를 채우기 위해 실행되는 연관관계 조회였다. 사용자 한 명을 읽는데도 이런 식이었다.

```sql
-- 사용자 하나 조회에 도메인·비밀번호정책·그룹까지 6개 테이블이 딸려온다.
select ...
from   app_common.tb_user_master   um0_
left outer join app_common.tb_domain_master    dm1_ on um0_.domain_id = dm1_.domain_id
left outer join app_common.tb_password_policy   pp2_ on dm1_.domain_id = pp2_.domain_id
left outer join app_common.tb_user_group        ug3_ on um0_.usergroup_id = ug3_.usergroup_id
left outer join app_common.tb_domain_master    dm4_ on ug3_.domain_id = dm4_.domain_id
left outer join app_common.tb_user_master       um5_ on ug3_.group_manager = um5_.user_id
where  um0_.user_id = ?
```

압권은 작업 대상(job target) 조회였다. 작업 10건에 대한 대상을 한 번에 읽는데, `LEFT OUTER JOIN`이 <b>9개</b> 붙어 있었다. 조인에 걸린 테이블이 기본 테이블 포함 10개다.

```sql
-- 작업 대상 조회. job_id 10개를 IN으로 넣는데 LEFT OUTER JOIN이 9개 붙는다.
select ...  -- 조인된 테이블들의 컬럼 수십 개
from   app_job.tb_job_target        jt0_
left outer join app_common.tb_file_master        fm1_ on jt0_.file_id = fm1_.file_id
left outer join app_common.tb_domain_master     dm2_ on fm1_.domain_id = dm2_.domain_id
left outer join app_common.tb_user_master        um3_ on fm1_.work_user = um3_.user_id
left outer join app_job.tb_file_detail          fd4_ on fm1_.file_id = fd4_.file_id
left outer join app_job.tb_doc_group_master     dg5_ on jt0_.group_code = dg5_.group_code
                                                    and jt0_.group_version = dg5_.group_version
left outer join app_common.tb_user_master        um6_ on dg5_.work_user = um6_.user_id
left outer join app_common.tb_user_master        um7_ on jt0_.work_user = um7_.user_id
left outer join app_common.tb_domain_master     dm8_ on um7_.domain_id = dm8_.domain_id
left outer join app_common.tb_user_group         ug9_ on um7_.usergroup_id = ug9_.usergroup_id
where  jt0_.job_id in (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

작업 대상 → 파일 → 도메인 → 사용자 → 파일 상세 → 문서그룹 → 다시 사용자 → 도메인 → 사용자 그룹으로, 연관 관계를 따라 계속 들어가면서 필요하지도 않은 객체 그래프를 통째로 불러온다. 엔티티 연관관계가 대부분 EAGER(즉시 로딩)로 설정되어 있어서, 작업 하나를 읽으면 그 작업이 참조하는 모든 객체를 재귀적으로 함께 읽게 된다. 목록 화면은 실제로 몇 개 컬럼만 있으면 충분한데도 ORM은 엔티티 정의를 따라 전부 읽고 있었다.

병목은 두 축이었다.

- <b>비인덱스 컬럼(`domain_id`) 필터·카운트</b> → 목록을 열 때마다 풀 스캔
- <b>EAGER 연관관계</b> → 작업 하나당 객체 그래프 전체 로딩, 목록엔 8개 넘는 테이블 조인과 부가 쿼리(N+1 성격)가 매번 발생

## 4. 개선 지점

이 진단으로 뽑아 앱 팀에 넘긴 건 두 가지다. (측정된 개선 후 수치까지는 이 작업 범위가 아니었다. 정직하게 적어둔다.)

- <b>인덱스 추가.</b> 최소한 `tb_job_master`의 `domain_id`에 인덱스를 생성해야 한다. 카운트와 필터가 이 컬럼을 사용하므로 풀 스캔이 인덱스 스캔으로 바뀐다. 조인과 정렬에 사용되는 키 컬럼(`job_id` 등)도 후보로 함께 기록해 두었다.
- <b>fetch 전략 조정.</b> 목록에 필요 없는 연관관계는 EAGER를 제거하고 LAZY로 변경해야 한다. 목록에 실제로 필요한 컬럼만 조회하는 <b>projection DTO</b>나 필요한 연관만 명시적으로 불러오는 <b>fetch join</b>으로 바꾸면, 8개가 넘는 테이블을 매번 조인할 이유가 없다.

인프라 담당이 남의 애플리케이션 쿼리까지 분석하는 상황이 다소 어색했지만, 느린 화면의 원인은 로그를 따라 추적하면 대개 확인할 수 있다.

## 참고

- [Hibernate ORM User Guide — Fetching](https://docs.jboss.org/hibernate/orm/5.6/userguide/html_single/Hibernate_User_Guide.html)
- [The N+1 query problem — Vlad Mihalcea](https://vladmihalcea.com/n-plus-1-query-problem/)
- [MySQL — How MySQL Uses Indexes](https://dev.mysql.com/doc/refman/8.0/en/mysql-indexes.html)
