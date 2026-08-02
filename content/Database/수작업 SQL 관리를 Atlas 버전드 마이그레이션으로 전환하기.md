---
title: 수작업 SQL 관리를 Atlas 버전드 마이그레이션으로 전환하기
date: 2026-03-01
draft: false
featured: true
tags:
  - atlas
  - database
  - migration
  - mariadb
  - ci-cd
  - release-engineering
banner: 
cssclasses: 
description: 개발자가 손으로 SQL을 돌려 환경마다 스키마가 어긋나던 걸, Atlas 버전드 마이그레이션과 CI 검증·배포 파이프라인 통합으로 정리한 도입 기록.
permalink: 
aliases: 
completed: true
type:
  - tooling
---

## 요약

> [!SUMMARY]
> 레거시부터 DB 스키마를 `.sql` 파일로 두고 사람이 직접 DB에 반영해왔다. 사이트가 하나일 땐 버텼지만, 제품이 여러 폐쇄망 고객사로 퍼지면서 "어느 사이트에 뭐가 반영됐는지"가 추적이 안 돼 스키마 형상이 어긋나기 시작했다. DDL뿐 아니라 트리거·DML까지 수작업이었다. 버전 관리로 옮기되, 이미 배포된 <b>레거시(`.sql` 유지 + 도구를 안 쓰는 사이트와의 호환)</b>는 그대로 따라야 했다. Python 백엔드라 Alembic이 자연스러웠지만 `.sql` 유지에 약해서, <b>단일 바이너리(폐쇄망 반입 유리) + SQL 기반 + 강력한 baseline·diff</b>인 <b>Atlas</b>(Community Edition 버전드 마이그레이션)를 골랐다. 공통·사이트 SQL을 `common`/`site_custom`으로 나누고, 이미 굴러가던 DB는 `baseline`으로 편입, 머지된 마이그레이션은 `atlas.sum`으로 불변 고정, PR SQL 검증 CI와 배포 승인 게이트까지 붙였다.

DB 스키마는 안 건드리면 조용하지만, 한 번 어긋나면 원인 찾기가 지옥이다. "이 컬럼이 왜 이 사이트엔 있고 저 사이트엔 없지"에 답을 못 하는 상태를 정리한 이야기다.

## 1. 손으로 돌리던 SQL, 그리고 레거시 제약

시작은 도구가 아니라 관행이었다. 레거시부터 DB 스키마를 `.sql` 파일로 리포에 두고, 반영은 사람이 DB에 직접 붙어서 했다. 변경 내용은 패치노트에 따로 적어뒀다. 사이트가 하나였을 땐 이걸로도 그럭저럭 굴러갔다.

문제는 제품이 여러 고객사에 <b>폐쇄망(air-gapped)으로 납품</b>되면서 커졌다. 클러스터는 늘어나는데 반영은 여전히 수작업이니, <b>어느 사이트에 뭐가 반영됐는지</b>를 아무도 정확히 몰랐다. 이력이 사람과 패치노트에 흩어져 있어 누락이 생겼고, 그걸 되짚는 데 트러블슈팅 시간이 들었다. 사이트마다 스키마 형상이 조금씩 어긋나기 시작했으며, 고객사 커스텀 변경은 아예 관리 밖이라 반출도 어려웠다. 손으로 나가는 게 DDL만도 아니었다 — 트리거·`INSERT`·`UPDATE` 같은 DML까지였다.

버전 관리가 필요하다는 결론은 금방 났다. 문제는 제약이었다. 이미 <b>레거시 형태로 고객사에 배포된 방식</b>이라, 새 도구를 얹더라도 그걸 따라야 했다. <b>`.sql` 파일 형태를 유지</b>해야 하고, <b>마이그레이션 도구를 안 쓰는 사이트</b>에서도 그 `.sql`을 그대로 수동 반영할 수 있어야 했다. "다 갈아엎고 도구 종속으로 가기"는 선택지가 아니었다.

## 2. 도구 선정

전 직장은 Spring Boot라 <b>Flyway</b>를 썼다. 백엔드에 라이브러리로 붙어 앱이 뜰 때 스키마가 알아서 맞춰지는 구조였고, 편했다. 그래서 이번에도 손이 먼저 간 건 <b>언어에 맞는 도구</b>였다. 백엔드가 Python(FastAPI)이니 자연스럽게 <b>Alembic</b> 아니겠나 — 그렇게 시작했다.

발목을 잡은 건 1절의 레거시였다. Alembic은 마이그레이션을 <b>Python 스크립트로 관리</b>해서 <b>`.sql` 파일 유지가 약하다</b>. 그런데 우리는 이미 `.sql`을 손으로 관리·배포하는 형태가 굳어 있어 그 파일 형태를 버릴 수가 없었다. "Python이니 Alembic"이라는 관성이 여기서 딱 막혔다. 그래서 도구를 언어가 아니라 <b>레거시가 요구하는 것</b>을 기준으로 다시 봤다.

레거시가 요구하는 건 이랬다.

- 버전 기반으로 <b>변경 이력</b>을 관리할 것
- <b>`.sql` 파일 형태를 유지</b>할 것 (레거시·수동 반영 사이트 호환)
- 이미 굴러가는 DB에 특정 시점부터 반영하는 <b>baseline</b>이 될 것
- 반영 전 <b>diff</b>로 무엇이 바뀔지 확인할 수 있을 것
- DDL뿐 아니라 <b>DML·트리거</b>도 다룰 것
- <b>환경(사이트)별 분기</b>가 될 것

이 축으로 후보를 늘어놓고 봤다. (앞서 걸러진 Alembic도 같이 뒀다.)

| 도구 | baseline | .sql 유지 | diff | DML·트리거 | 컨테이너·반입 |
| --- | --- | --- | --- | --- | --- |
| Flyway | 지원 | 최적화 | 유료(Teams) | 지원 | 무거움 (JRE 필요) |
| Liquibase | 지원 | XML/YAML 권장 | 지원 | 지원 | 무거움 (JRE 필요) |
| Alembic | 지원 | Python 위주(약함) | autogen | 직접 작성 | Python 종속 |
| Goose | 지원 | 최적화 | 미지원 | 지원 | 단일 바이너리 |
| <b>Atlas</b> | <b>매우 강력</b> | 지원(SQL) | <b>강력(무료)</b> | 지원 | <b>매우 가벼움(단일 바이너리)</b> |

결정타는 <b>Go 단일 바이너리</b>였다. Flyway·Liquibase는 JRE를 이고 다녀야 하고 Alembic은 Python 런타임에 묶인다. 폐쇄망 고객사에 반입할 때 이건 그대로 부담이 된다 — 컨테이너 사이즈, 보안 취약점 대응, 추가 이미지 반입 절차. Atlas는 <b>바이너리 하나만 들고 들어가면</b> 되니 반입이 압도적으로 단순했다. 여기에 `.sql` 유지, 강력한 baseline·diff까지 요구사항을 다 채웠다. 언어에 맞춰 Alembic에서 출발했다가, 레거시에 맞춰 Atlas로 온 셈이다.

쓰는 건 Community Edition의 <b>버전드 마이그레이션</b>뿐이다. `migrate new/hash/validate/lint/status/apply`면 필요한 게 다 됐다. Pro 전용인 선언형 스키마나 drift detection은 전제하지 않았다 — 없어도 돌아가게 설계하는 게 라이선스에 발목 안 잡히는 길이라고 봤다.

## 3. common과 site_custom, 두 갈래 워크플로우

가장 먼저 걸린 설계 질문. <b>모든 클러스터에 공통인 SQL</b>과 <b>특정 클러스터에만 필요한 SQL</b>을 어떻게 나눌 것인가. 한 디렉토리에 다 넣으면 클러스터별 분기가 지저분해지고, 공통 변경과 커스텀 변경의 이력이 섞여 추적이 안 된다.

그래서 <b>독립된 두 워크플로우</b>로 갈랐다.

- `common`: 모든 클러스터 공통. revision 이력은 `atlas_revisions_common` 스키마에 쌓인다.
- `site_custom`: 클러스터 전용. revision 이력은 `atlas_revisions_site_custom`에.

이력 테이블을 따로 두니 공통과 커스텀의 반영 상태가 서로를 오염시키지 않는다. 적용 순서는 항상 <b>common → site_custom</b>으로 고정했다. 공통 스키마가 깔린 위에 사이트 특이사항이 얹히는 게 자연스러우니까.

파일 네이밍도 이 순서를 드러내게 잡았다. 기존 방식은 정렬이 깨질 위험이 있어서, 버전에 <b>패딩</b>을 넣고 <b>반영 건별로 파일을 쪼갰다</b>(버전당 단일 파일 X). 사이트 커스텀은 common의 몇 번 반영 뒤에 와야 하는지를 <b>`S` 인덱스</b>로 엮어, common과의 순서성이 파일명만 봐도 보이게 했다.

```bash
# common: {메인 버전}_{common 인덱스}__{변경 내용}
V01.08.01.00_01__add_action_type.sql
V01.08.01.00_02__create_credit_table.sql

# site_custom: {메인 버전}_{common 인덱스}S{사이트 인덱스}__{변경 내용}
#   → "1.8.1의 common 02번 반영 뒤에 적용될 사이트 커스텀"
V01.08.01.00_02S01__site_custom.sql
```

## 4. 클러스터 설정은 atlas.hcl이 아니라 YAML로

여러 클러스터(검증·운영·사이트별)를 하나의 `atlas.hcl`로 어떻게 다룰까. env를 클러스터 수만큼 만들면 HCL이 비대해지고, 클러스터가 늘 때마다 HCL을 고쳐야 한다.

그래서 env는 `common`과 `site_custom` <b>딱 둘만</b> 정의하고, 대상 클러스터는 `--var cluster=<이름>`으로 고르게 했다. 클러스터별 메타데이터는 `clusters.yaml`에 몰아넣었다.

```hcl
# atlas.hcl — 클러스터 메타데이터는 clusters.yaml 에서 읽는다.
variable "cluster" { type = string }
locals {
  clusters = yamldecode(file("clusters.yaml"))
  cluster  = local.clusters[var.cluster]
}

env "common" {
  url = local.url
  migration {
    dir              = "file://common"
    revisions_schema = "atlas_revisions_common"
    baseline         = local.cluster.common_baseline
  }
}

env "site_custom" {
  url = local.url
  migration {
    dir              = "file://${local.cluster.custom_dir}"
    revisions_schema = "atlas_revisions_site_custom"
    baseline         = local.cluster.custom_baseline
  }
}
```

```yaml
# clusters.yaml — 클러스터 추가는 여기에 블록 하나 추가로 끝난다. (값은 예시)
stg:
  url_env: DB_URL_STG          # DB URL은 환경변수로 주입, 파일에 안 박는다
  database: appdb
  common_baseline: "20260409054820"
  custom_dir: site-custom/stg
  custom_baseline: ""
prod:
  url_env: DB_URL_PROD
  database: appdb
  common_baseline: "20260409054820"
  custom_dir: site-custom/prod
  custom_baseline: ""
```

클러스터 추가가 HCL 수정이 아니라 YAML 블록 추가로 끝나니 선언적이다. DB 접속 URL은 `url_env`로 환경변수 이름만 적어두고 실제 값은 CI가 주입한다 — 자격증명이 리포에 남지 않게.

## 5. baseline: 이미 굴러가던 DB를 이력에 편입

새 DB야 처음부터 전체를 replay하면 되지만, <b>이미 수동 SQL이 잔뜩 반영된 운영 DB</b>를 Atlas 관리 하에 넣는 게 문제였다. 처음부터 다 돌리면 이미 있는 테이블을 또 만들려다 터진다.

`baseline`이 이걸 푼다. "이 버전까지는 이미 반영된 걸로 친다"고 선언하면, 그 파일과 그 이전 파일은 Atlas가 실행하지 않는다. common과 site_custom 각각 따로 baseline을 잡았고, 신규 빈 DB에는 baseline을 안 걸어 처음부터 전체를 태웠다.

> [!WARNING]
> baseline을 잘못 잡으면 이미 반영된 SQL을 다시 돌리거나, 아직 안 반영된 SQL을 건너뛴다. 둘 다 사고다. 그래서 운영 DB에 처음 붙일 땐 반드시 `dry-run`으로 "무엇이 실행될지"를 먼저 확인했다. (`dry-run`이 revision 메타데이터를 만들어버리는 경우가 있어서, 운영 DB 첫 사용은 특히 조심했다.)

## 6. 불변 마이그레이션과 atlas.sum

버전 관리의 근간으로 <b>불변 마이그레이션(immutable migrations)</b>을 못 박았다. 이미 머지된 SQL은 <b>절대 수정하지 않는다</b>. 고칠 게 있으면 새 파일로 전진 패치한다. 이미 여러 클러스터에 반영된 SQL을 뜯어고치는 순간, 없애려던 환경별 불일치가 그대로 되살아나기 때문이다.

이걸 사람 약속이 아니라 도구로 강제했다.

- <b>`atlas.sum`</b>: 각 마이그레이션 파일의 체크섬을 담는 파일. 기존 파일이 바뀌면 합이 깨진다.
- <b>CI 차단</b>: PR에서 기존 SQL의 수정·삭제를 감지하면 막는다.
- <b>선형 히스토리 강제</b>: 새 파일은 항상 기존 이력의 뒤에만 붙을 수 있다. 중간 끼워넣기 금지, 같은 디렉토리 내 timestamp 중복 금지.
- <b>pre-push Git Hook</b>: 로컬에서도 push 전에 `atlas.sum` 정합성을 검증해 CI까지 안 가고 걸러낸다.

동시에 두 PR이 올라와 `atlas.sum`이 충돌하면, 나중 PR이 develop을 리베이스하고 `make hash`로 합을 다시 만든 뒤 검증을 재실행하는 걸로 정리했다.

여기에 두 가지 실무 함정이 있었다.

- <b>DELIMITER 미지원</b>: Atlas의 SQL 파서는 `DELIMITER` 구문을 모른다. 트리거·프로시저는 `BEGIN...END` 블록으로 쓰면 Atlas가 블록을 인식해 세미콜론 문제 없이 처리한다.
- <b>줄바꿈 정규화</b>: `atlas.sum`은 줄바꿈에 민감하다. Windows 개발자의 CRLF와 Linux CI의 LF가 달라 체크섬이 어긋났다. `.gitattributes`에 `*.sql text eol=lf`를 걸고 정규화 스크립트를 둬서, 항상 LF 기준으로 합을 맞췄다.

## 7. 개발·배포 워크플로우

명령을 외우게 하지 않으려고 `Makefile`로 감쌌다.

```bash
# 개발: SQL 추가
make new NAME=v1.9.0_add-user-credit   # timestamp 붙은 파일 생성
# (SQL 작성)
make hash                              # atlas.sum 갱신
make validate && make lint             # 로컬 검증(replay 가능 여부 + SQL 품질)
# PR → CI 자동 검증 → 머지
```

```bash
# 배포: 클러스터 대상
make dry-run CLUSTER=prod              # 무엇이 반영될지 먼저 확인
make diff    CLUSTER=prod              # 스키마 차이 확인
make deploy  CLUSTER=prod              # common → site_custom 순차 적용
```

`lint`는 문법뿐 아니라 <b>파괴적 변경(destructive change)</b>을 감지해준다. 컬럼을 지우거나 타입을 좁히는 SQL이 있으면 경고가 뜨니, 리뷰에서 "이거 진짜 지워도 돼?"를 한 번 더 묻게 된다.

## 8. PR마다 도는 SQL Validate CI

로컬 검증만으로는 결국 사람이 깜빡한다. PR마다 DB 스키마 변경을 자동 검증하는 파이프라인을 붙였다.

- <b>변경 감지</b>: SQL과 무관한 변경이 검증을 유발하던 오탐을, 감지 로직을 <b>whitelist 경로 기반</b>으로 바꿔 줄였다. SQL 디렉토리가 안 바뀌면 검증을 안 돈다.
- <b>common은 lint, site_custom은 apply</b>: 공통 스키마는 lint로 정적 검증하되, 사이트 커스텀은 lint만으론 부족해서 <b>실제 apply까지</b> 돌려 클러스터별 SQL의 실행 가능성을 확인했다. 커스텀은 특이 케이스가 많아 "돌려봐야 아는" 게 많았다.
- <b>검증 대상 카탈로그</b>: 검증할 모듈을 카탈로그로 관리해, 스키마와 무관한 모듈은 대상에서 뺐다.

## 9. 배포 파이프라인 통합과 다중 승인 게이트

로컬 `make`를 넘어, 배포 파이프라인(v2)에 Atlas 마이그레이션을 <b>스테이지</b>로 넣었다. 배포 흐름 안에서 스키마가 적용되게. 여기서 두 가지가 까다로웠다.

<b>외부 CI가 클러스터 내부 DB에 어떻게 붙나.</b> DB는 외부 노출 없는 ClusterIP였다. 외부 Jenkins가 apiserver 터널 기반 `kubectl port-forward`로 접속하고(readiness 폴링 + 종료 시 cleanup), 접근 권한은 클러스터당 서비스 계정 하나에 최소 권한만 준 토큰으로 위임했다. 이 접근 방식의 배관은 따로 정리했다 → [[외부 노출 없는 ClusterIP-only DB에 CD 마이그레이션 붙이기]].

<b>마이그레이션과 배포의 타이밍을 어떻게 맞추나.</b> 스키마를 먼저 적용해야 하는데, 사람 승인도 받아야 했다. 그래서 배포 봇이 <b>AtlasApply → 이미지 Push</b> 순으로 승인 게이트를 노출하고, 게이트별로 중단의 의미(스키마 미적용 = 진짜 실패 vs GitOps 커밋은 이미 됨 = 무해)를 구분하게 했다 → [[Jenkins·GitOps·ArgoCD 배포를 Slack 봇 하나로 묶기]].

온보딩은 opt-in으로 뒀다. Atlas 스테이지는 온보딩된 클러스터에서만 돌고, 아직 편입 안 한 타깃은 자동으로 건너뛴다(SKIP). 기존 배포를 안 깨면서 클러스터를 하나씩 편입하려는 안전장치였다.

통합하면서 잡은 버그 둘은 적어둘 만하다.

- <b>클러스터 맵 병합 위치 오류</b>: 인라인 파이프라인이 클러스터 설정을 합칠 때, `clusters.yaml`의 중첩 키가 아니라 ROOT 맵에 병합해야 `atlas.hcl`의 `yamldecode` 구조와 맞는데 그걸 잘못 잡았었다.
- <b>`dry-run`의 `|| true`가 실패를 삼킴</b>: dry-run 스텝에 `|| true`가 붙어 non-zero 종료를 삼키는 바람에, 실패한 마이그레이션이 초록불로 승인 게이트까지 진행됐다. exit code를 캡처해 non-zero면 스테이지를 실패 처리하도록 고쳤다. 배포에서 가장 무서운 건 실패를 성공으로 보고하는 것이다.

## 10. 한계

도구와 파이프라인은 섰는데, 마지막 관문은 사람이다. 개발팀이 "SQL은 손으로 돌리는 것"이라는 습관에서 "파일로 추가하고 PR 올리는 것"으로 넘어오게 하는 전환 교육이 남았다. 좋은 레일을 깔아도 타는 법을 알려주지 않으면 결국 옆길로 샌다.

## 참고

- [Atlas — Versioned Migrations](https://atlasgo.io/versioned/intro)
- [Atlas — migrate apply](https://atlasgo.io/versioned/apply)
- [Atlas — migrate lint](https://atlasgo.io/versioned/lint)
- [Atlas — baseline migration](https://atlasgo.io/versioned/apply#baseline-migration)
- [[외부 노출 없는 ClusterIP-only DB에 CD 마이그레이션 붙이기]]
- [[Jenkins·GitOps·ArgoCD 배포를 Slack 봇 하나로 묶기]]
