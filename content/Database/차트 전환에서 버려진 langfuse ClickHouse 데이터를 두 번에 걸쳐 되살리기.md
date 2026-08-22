---
title: 차트 전환에서 버려진 langfuse ClickHouse 데이터를 두 번에 걸쳐 되살리기
date: 2026-07-29
draft: false
tags:
  - clickhouse
  - langfuse
  - postgresql
  - migration
  - troubleshooting
banner: 
cssclasses: 
description: "스테이징을 사내 표준 차트로 전환할 때 기존 PV 재부착이 기본 계획이었는데 ClickHouse 만 fresh 로 결정돼 트레이스 이력을 폐기했다. 스토리지 기본 reclaim 이 Retain 이라 원본이 살아 있어서 임시 ClickHouse 를 띄워 되살렸고, 그런데도 화면에는 나타나지 않아서 정렬 키 컬럼인 project_id 를 재기록해 프로젝트를 통합했다. 두 번의 복구 기록."
permalink: 
aliases: 
completed: true
type:
  - issue
---

## 요약

> [!SUMMARY]
> 데이터 이관 계획은 기존 PV 재부착이었는데 ClickHouse 만 "트레이스 이력은 초기화한다"고 판단해 fresh 로 진행했다. 그 판단이 나중에 뒤집혀서 되살려야 했고, 스토리지 기본 reclaim 이 Retain 이라 원본이 남아 있어서 그 위에 임시 ClickHouse 를 띄워 `remote()` INSERT 로 옮겼다. 그런데 행을 모두 넣고도 화면에는 나타나지 않았다. 차트가 프로젝트를 하나 새로 생성했기 때문이고, 정렬 키 컬럼인 `project_id` 를 재기록해서 합쳤다.

## 1. 환경

- 스테이징 쿠버네티스 클러스터, LLM 관측용 langfuse 스택
- 구 형상: langfuse helm 차트에 <b>내장된 ClickHouse</b> 3노드 (2026-04-27 생성)
- 신 형상: Altinity clickhouse-operator 의 ClickHouseInstallation, ClickHouse 26.3.16, langfuse 3.174.1
- 둘 다 <b>1 shard × 3 replica</b>. 샤딩이 아니라 복제라서 노드 하나에 전체 데이터가 있다
- 스토리지: NFS 기반 StorageClass, reclaimPolicy <b>Retain</b>. 오브젝트 스토리지는 MinIO
- Postgres 는 CNPG 2대, langfuse 메타데이터용

이 글의 결말 절반은 저 `Retain` 한 줄에 걸려 있다.

## 2. 이슈

스테이징을 사내 표준 차트로 전환하면서 백킹 서비스를 전부 신 형상으로 전환했다. <b>데이터 이관의 기본 방침은 기존 PV 재부착</b>이었다. 대용량은 재부착으로 즉시 처리하고 시간은 논리 이관(mariadb 덤프 30~60분, postgres 수분)에만 쓴다는 계산으로 중단 창을 반일 하단으로 잡았다. 산정표에도 `ClickHouse 47G/노드(≈141G, 재부착)` 로 적혀 있다.

그런데 준비 단계에서 ClickHouse 만 방침이 뒤집혔다. 체크리스트에 이렇게 남아 있다.

```
langfuse ClickHouse 는 예외: 라이브 데이터 볼륨이 subdir 없이 export 루트를
통째 마운트 + CHI 이름 변경이라 깔끔한 mv 대상이 없음
→ fresh(재초기화) 권장 (langfuse 기동, 트레이스 히스토리만 초기화)
→ 승계 필요 시 별도 정밀 작업
```

다른 컴포넌트는 같은 NFS export 안에서 구 데이터 dir 을 신 subdir 이름으로 `mv` 하면 즉시 재부착된다. minio·gitea·mongodb·registry 가 모두 그 방식으로 복구됐다. ClickHouse 는 두 가지 조건이 겹쳐 그 방식이 불가능했다. 구 형상이 subdir 없이 export 루트를 통째로 마운트하고 있었고, CHI 이름이 바뀌면서 operator 가 만드는 PVC 이름과 경로도 달라졌다.

그래서 <b>폐기하기로 했다.</b> "트레이스 히스토리만 초기화"라는 문장이 그 판단이다. 관측 이력은 앱 동작에 필요한 상태가 아니고, 승계는 별도 정밀 작업이라고 봤다. 그 결정의 부수 효과로 Retain 선패치 대상에서도 제외됐다. "fresh 결정이라 Delete 유지"라는 기록이 남았다.

전환 당일 예외 목록의 이 항목도 그래서 자연스러웠다.

```
langfuse ClickHouse DB 부재 — fresh ClickHouse 에 langfuse DB 미생성
→ Database langfuse does not exist
→ CREATE DATABASE langfuse ON CLUSTER 로 해결 (차트 갭)
```

fresh 는 예정된 상태였으니, 이건 "차트가 DB 를 선생성하지 않는 갭"으로 처리하는 게 맞았다. 신 langfuse 는 잘 떴고 새 트레이스도 잘 쌓였다.

닷새 뒤 mariadb 계정 누락을 파다가 질문이 하나 왔다.

> "clickhouse 도 이번 변경작업에서 데이터가 유실되었을지 확인해줘"

폐기하기로 한 데이터가 실제로 폐기해도 되는 데이터였는지를 다시 묻는 질문이다. 그리고 답은 <b>아니오</b>였다.

## 3. 복구

### 1. 백업이 없을 때 유실을 무엇으로 판정하나

mariadb 는 전환 시점 덤프가 NAS 에 있어서 대조가 쉬웠다. ClickHouse 는 <b>백업 PVC 자체가 없었다.</b> 비교 기준이 없었다.

그래서 베이스라인 대신 <b>데이터의 시간 범위</b>로 판정했다. 라이브를 세어보니 langfuse 4테이블 30K 행, 대시보드 DB 247K 행. 데이터는 있다. 근데 각 테이블의 최고령 이벤트 시각이 전부 <b>정확히 전환 시각</b>이었다.

TTL 을 먼저 확인했다. `traces`/`observations` 는 TTL 이 없다. 즉 만료로 삭제된 것이 아니라 애초에 전송되지 않은 것이다.

여기서 좋은 지적이 들어왔다.

> "구 pv 를 그대로 사용한게 아니야? 파악을 진행해줘"

PVC 를 재사용했는데 내용만 초기화된 경우도 가능하니 구분이 필요하다. PVC 생성 시각이 전환 당일 03:56~04:08, PV 이름은 `pvc-<uuid>` 형태의 동적 생성. <b>재사용이 아니라 신규 프로비저닝</b>이 확정됐다. 빈 스토리지로 시작한 것이다.

여기서 확인한 건 "fresh 결정이 실제로 fresh 로 실행됐다"는 것이다. 이 구분이 중요한 건, 만약 PV 를 재사용했는데 내용이 초기화된 것이라면 <b>원본이 이미 덮여 있다</b>는 뜻이라 복구 가능성 자체가 달라지기 때문이다. 신규 프로비저닝이라면 구 데이터는 손대지 않은 채 다른 경로에 있다.

### 2. 원본은 어디에 남아 있었나

신 데이터 경로에 `archived-*` 류 사본은 없었다. 그런데 형제 경로를 훑다가 <b>구 helm 형상이 쓰던 ClickHouse 디렉터리가 그대로 남아 있는 것</b>을 찾았다. 4월 생성, <b>133GB</b>, `store`/`data`/`metadata` 구조 온전, 3노드 전부. 파티션 파일이 전환 시각까지 기록돼 있었다.

StorageClass 의 reclaimPolicy 가 `Retain` 이라 PV 가 Released 로 빠져도 NFS 상의 실데이터는 지워지지 않은 것이다.

여기가 다소 아이러니한 부분인데, 이 볼륨은 <b>Retain 선패치 대상에서 의도적으로 제외돼 있었다.</b> fresh 로 가기로 했으니 롤백 보험이 필요 없다고 봤고, 체크리스트에도 "Delete 유지"로 적어뒀다. 살아남은 것은 그 StorageClass 의 기본 reclaim 이 이미 Retain 이었던 덕분이었다. 폐기하기로 한 데이터가 스토리지 기본값 덕분에 남아 있었고, 그것이 나중에 유일한 복구 원본이 됐다. 이 데이터가 없었다면 이 글은 여기서 끝났을 것이다.

### 3. 복구 전에 확인한 정합성 의존성

행만 밀어넣으면 되는 게 아니다. langfuse v3 는 이벤트 페이로드(input/output)를 오브젝트 스토리지로 offload 하고 ClickHouse 에는 참조만 둔다. 그리고 trace 는 Postgres 의 프로젝트에 귀속된다. <b>둘 중 하나만 없어도 복구한 trace 가 참조를 잃게 된다.</b>

- MinIO 의 langfuse 버킷: 구 프로젝트 prefix 의 이벤트 객체가 전환 이전까지 보존돼 있음
- Postgres `projects`: 구 프로젝트(4월 생성)가 살아 있음 — postgres 는 덤프 복원으로 이관됐으니 당연했다
- 신 traces 는 신 프로젝트 id 만 참조 → 구/신 겹침 없음, dedup 충돌 없음
- 디스크 여유 노드당 1.03 TiB → +133GB 는 무리 없음

의존성이 모두 유지되어 있었다. ClickHouse 하나만 빠진 상황이라 오히려 복구 조건은 깔끔했다.

### 4. 복구 방식 — 구 데이터 위에 임시 ClickHouse

방식은 다음과 같이 정해졌다.

> "별도 chi 를 과거 pv 경로로 프로비저닝해서 데이터를 현재 chi 로 이동시키자"

파일을 옮기는 대신 <b>구 데이터 위에 ClickHouse 인스턴스를 하나 띄우고 SQL 로 읽어 내보내는</b> 방식이다. 파트를 파일시스템으로 신 테이블에 밀어넣고 keeper 에 수동 등록하는 길도 있지만, Replicated 테이블의 zk 경로는 테이블 UUID 기반이라 신 테이블 입장에서는 완전히 다른 테이블이다. 그 길로 가면 replica 이름·매크로까지 다 맞춰야 한다. `INSERT` 로 넣으면 신 테이블이 자기 UUID 아래에서 3노드 복제를 알아서 관리하므로 그 문제가 아예 사라진다.

그리고 실행 전에 이 말이 나왔다.

> "복구했을 때, 문제가 발생하지는 않을지 확인해줘"

이 한마디가 방식을 바꿨다. 구 데이터는 <b>이 세상에 하나 남은 백업</b>이고, ClickHouse 26.3 이 그 파트를 RW 로 열면 자동 업그레이드로 원본을 변형시킬 수 있다. 백업을 읽으려다 백업 자체를 손상시키는 것은 최악의 결과다. 그래서 안전장치를 세 겹으로 마련했다.

- 구 노드-0 을 <b>42G tar.gz 로 압축 보존</b> (별도 아카이브)
- 임시 인스턴스는 <b>노드-1 만</b> 마운트. 3 replica 라 노드-2 는 손대지 않은 pristine 복제본으로 남는다
- keeper 를 unreachable 상태로 두어 Replicated 테이블이 <b>readonly 로 attach</b> 되게 함

임시 인스턴스는 라이브와 같은 이미지 태그로 띄웠다(구 파트 하위호환 읽기).

첫 attach 는 실패했는데, 원인은 keeper 가 아니라 <b>매크로 `{shard}`/`{replica}` 미정의</b>였다. Replicated 엔진의 zk 경로에 매크로가 들어가 있으니 정의가 없으면 테이블을 열 수가 없다. 매크로만 채우고 keeper 에는 계속 접근하지 못하게 두면 readonly 로 읽힌다.

스키마 차이도 우려 사항이었다. 구 langfuse 는 테이블을 `default` DB 에 뒀고 신은 `langfuse` DB 다. 버전이 다르면 컬럼 매핑을 직접 작성해야 한다. 그런데 `schema_migrations` 를 세어보니 양쪽 다 68 이었다. <b>스키마가 동일해서 `SELECT *` 로 그대로 옮길 수 있었다.</b> 이 확인으로 작업량이 절반으로 줄었다.

읽히는 것을 확인한 순간의 수치가 이랬다.

| 테이블 | 구 원본 | 신 라이브(당시) |
|---|---|---|
| `traces` | 541,322 (2025-06-27 ~ 2026-07-10) | 5,701 |
| `observations` | 881,822 | 16,495 |
| `gpu_timeseries` | 1,010,138 | 246,508 |

1년치 데이터가 통째로 누락돼 있었다.

이동은 처음에 라이브에서 임시 인스턴스를 `remote()` 로 당겨오려 했지만, 임시 쪽이 원격 접속의 빈 비밀번호를 거부했다(로컬 접속은 가능하지만 원격 인증은 별도다). 비밀번호를 아는 쪽이 라이브이므로 <b>방향을 반대로 바꿔 임시 → 라이브 push</b> 로 우회했다.

### 5. 복구 중 만난 함정 넷

<b>50GB 를 한 번에 전송하다 replica 가 readonly 상태로 전환됐다</b>

`observations` 50.4GiB 를 단일 INSERT 로 스트리밍하다 대상 테이블이 `Code 242: Table is in readonly mode` 로 실패했다. 120,195/881,822 에서 중단. ReplicatedMergeTree replica 가 keeper 세션을 순간 잃으면 readonly 가 되는데, 대용량 인서트 부하 중의 일시 현상이었고 곧 회복됐다. 문제는 <b>한 번에 진행하다 중간에 실패하면 전체를 다시 해야 한다</b>는 것이었다. 그래서 월 파티션 단위 배치 + 재시도로 재개했다. ReplacingMergeTree 라 재적재가 멱등이어서 부분 적재된 12만 행도 단순히 덮어쓰면 됐다.

<b>kubectl exec 스트림이 반복해서 끊겼다 — 그런데 서버측 쿼리는 안 죽었다</b>

긴 INSERT 를 `kubectl exec` 에 연결해 두면 API 서버 연결이 `connection reset by peer` 로 끊긴다. 이건 예상했다. 예상하지 못한 것은 <b>클라이언트가 종료돼도 서버측 INSERT 는 계속 실행 중이라는</b> 점이다. 재시도가 겹치면서 같은 INSERT 가 동시에 여러 개 실행되고 있었다. 앞선 일시 readonly 도 이 경합 부하 때문으로 보인다.

잔류 쿼리를 모두 KILL 하고, 파드 내부에 스크립트를 배치해 detach 방식으로 실행했다.

```bash
# kubectl 연결과 무관하게 파드 안에서 단일 순차로 돈다
nohup setsid bash /tmp/recover.sh > /tmp/recover.log 2>&1 < /dev/null &
```

이후로는 모니터링만 짧은 read 로 하고, 긴 작업은 클러스터 안에서만 돌렸다. 리셋 영향이 사라졌다.

<b>내가 만든 감시 루프가 자기 자신을 감시했다</b>

완료 판정을 `system.processes` 폴링으로 수행했는데, 조건이 `query LIKE '%remote%observations%'` 였다. 이 판정 쿼리 자신이 그 패턴에 걸린다. 그래서 판정이 영원히 "실행 중"을 유지해 다음 단계로 넘어가지 못했다. 데이터에는 영향이 없었지만 한 시간을 낭비했다. (자기매칭 문제의 전형적인 사례다.)

<b>엔진이 다른 테이블은 따로 판단해야 했다</b>

langfuse 테이블은 ReplacingMergeTree 라 재시도가 안전했지만, 대시보드 쪽은 아니었다.

- `gpu_timeseries`: non-Replacing + TTL 90일. 재시도 중복이 <b>영구화</b>된다. 구/신 시간대가 겹치지 않고 TTL 에도 안 걸려서, 단발 실행으로 전량 복구(+1,010,138 → 1,263,972)
- `custom_dashboard_series`: non-Replacing에 구간도 겹친다. 게다가 앱이 다른 DB 에서 재파생하는 테이블이라 그대로 넣으면 중복이 남는다. <b>겹치지 않는 과거 구간만</b> gap-fill(+1,218 → 1,964)

멱등한 엔진에 익숙해지면 이 구분을 놓치기 쉽다. 같은 스크립트로 전부 적용하면 안 되는 이유다.

### 6. 검증은 raw 가 아니라 FINAL

복구를 끝내고 대조했더니 이렇게 나왔다.

| 테이블 | 구 원본(raw) | 신 라이브(FINAL) | 차이 |
|---|---|---|---|
| `traces` | 541,322 | 541,317 | -5 |
| `observations` | 881,822 | 877,767 | -4,055 |
| `blob_storage_file_log` | 132,591 | 132,591 | 일치 |

4천 행이 부족했다. 순간 당황했는데, 세는 방식이 달랐다. 구 원본은 `raw`(병합 안 된 중복 버전 포함)이고 신 라이브는 `FINAL`(dedup)이다. langfuse 는 같은 레코드를 `event_ts` 버전으로 여러 번 쓰므로 ReplacingMergeTree 로 접히는 게 정상이다. 기준이 다른 값을 비교한 셈이었다.

양쪽 다 FINAL 로 세니 이렇게 됐다.

| 테이블 | 구 원본(FINAL) | 신 라이브(FINAL) |
|---|---|---|
| `traces` | 541,317 | 541,317 |
| `observations` | 881,814 | 881,814 |
| `blob_storage_file_log` | 132,591 | 132,591 |

유실 0. 재적재로 생긴 물리 중복 약 12만 행은 남았지만 백그라운드 병합이 정리하고 쿼리는 dedup 하므로 `OPTIMIZE ... FINAL`(무겁다)은 생략했다.

여기까지가 1차 복구다. langfuse 는 ClickHouse 를 실시간 조회하니 앱 재기동 없이 과거 trace 가 바로 보일 것이었다. 그렇게 믿고 닫았다.

### 7. 2차 복구 — 행은 들어왔는데 화면에는 없다

2주 뒤 같은 문의가 다시 왔다. 특정 시점 이전 데이터가 안 보인다, 한 번 조치했다고 들었는데 여전히 안 보인다.

ClickHouse 를 다시 셌다. `traces` 646,190건, 1차 복구로 넣은 행이 그대로 살아 있다. 이 시점의 미조회는 유실이 아니다. `project_id` 로 묶어보니 둘로 갈려 있었다.

| project_id | 건수 | 범위(KST) |
|---|---|---|
| 구 프로젝트 (cuid) | 541,317 | 2025-06-27 11:07 ~ <b>2026-07-10 10:55</b> |
| 신 프로젝트 (고정 id) | 104,873 | <b>2026-07-10 16:10</b> ~ 현재 |

전환 시각에서 딱 갈린다. 1차 복구가 구 프로젝트 id 를 <b>그대로 보존해서</b> 넣었기 때문이다 (그때는 그게 맞는 판단이었다 — 프로젝트가 겹치지 않아 dedup 충돌이 없다는 걸 확인하고 들어간 거였으니까).

범인은 langfuse-web 의 초기화 env 였다.

```
LANGFUSE_INIT_ORG_ID      = <고정 id>
LANGFUSE_INIT_PROJECT_ID  = <고정 id>
LANGFUSE_INIT_PROJECT_PUBLIC_KEY / SECRET_KEY ← secret
```

차트가 프로젝트 id 를 고정값으로 박아 초기화한다. 이 환경은 전환 전부터 cuid 형태의 프로젝트 id 로 운영 중이었으니, 초기화 로직이 기존 프로젝트를 흡수하지 못하고 <b>두 번째 프로젝트를 새로 만들었다.</b> 클라이언트가 새 키로 갈아타면서 이후 트레이스는 전부 새 프로젝트로 들어갔다. 전환 공백 10:55~16:10 약 5시간은 양쪽 어디에도 없다.

읽기 경로도 둘 다 찔러봤다. 프로비저닝된 키로 public API 를 때리면 과거 구간이 빈다.

```
{"data":[],"meta":{"page":1,"limit":1,"totalItems":0,"totalPages":0}}
```

UI 가 쓰는 tRPC 경로는 세션 로그인 후 호출했다(`/api/auth/csrf` → `callback/credentials` → `session`). 세션 응답에 구 프로젝트가 `hasTraces: true` 로 나왔다. `traces.countAll` 첫 호출은 400 이 떨어졌고,

```
{"expected":"array","code":"invalid_type","path":["searchType"],
 "message":"Invalid input: expected array, received undefined"}
```

`searchType: ["id"]` 를 채워 다시 부르니 구 프로젝트에서 `{"totalCount":540527}`. ClickHouse 실측과 일치한다. 데이터도 있고 조회도 된다. <b>보는 프로젝트가 달랐을 뿐이다.</b>

권한도 갈라져 있었다. 관리자 계정은 두 org 모두 OWNER 라 양쪽이 보이는데, 문의한 쪽 계정은 구 org 의 VIEWER 뿐이라 신 프로젝트가 목록에 아예 없었다. 같은 화면을 보면서 서로 다른 세상을 보고 있었다.

운영·클라우드 환경도 확인했다. 둘 다 프로젝트가 하나뿐이라 무영향이다. 그쪽은 차트 전환 시점에 langfuse 가 처음 올라갔다. <b>스테이징만 전환 전에 이미 운영 중이었기 때문에 터진 사고다.</b>

### 8. project_id 재기록의 제약과 함정

선택지를 셋 냈고, 과거 데이터를 현행 프로젝트로 통합하는 쪽으로 결정됐다.

> 솔루션 자체가 langfuse project_id 를 단일로 활용하고 있는 구조였고, 현재 작업이 현행 동작을 변경하는 것은 리스크가 크다.

env 를 구 id 로 되돌리거나 프로젝트 둘을 유지하는 길도 있었지만, 그건 지금 잘 돌고 있는 클라이언트 배선을 건드리는 선택이다. 과거 데이터를 옮기는 쪽이 현행에 손을 안 대는 유일한 길이었다.

1차 복구와 똑같이 <b>복사와 삭제를 분리</b>했다. 구행을 남긴 채 복사만 먼저 하고 삭제는 검증 후 별도 단계로. 구 프로젝트 행 자체가 롤백 수단이 된다.

Postgres 는 단일 트랜잭션으로 처리했다. 구행을 백업 테이블로 떠 놓고 UPDATE — ClickHouse 는 복사 후 삭제라 원본이 남지만 Postgres 는 제자리 UPDATE 라 되돌릴 근거가 사라진다.

```
UPDATE 6115   -- media (내용 해시가 겹친 7건 제외)
UPDATE 41     -- trace_media 잔여분
UPDATE 2213   -- trace_sessions (충돌 3건 제외)
```

`trace_media` 는 명시 UPDATE 가 41건인데 최종 6,476건이 다 이관돼 있었다. FK 가 `REFERENCES media(id, project_id) ON UPDATE CASCADE` 라서 `media` 를 갱신하는 순간 6,435건이 따라온 것이다.

ClickHouse 는 UPDATE 자체가 막혀 있었다.

```
ORDER BY (project_id, toDate(timestamp), id)
```

`project_id` 가 정렬 키의 첫 필드다. 정렬 키를 바꾸면 파트 내부 정렬과 sparse index 가 무효가 되므로 ClickHouse 는 키 컬럼 mutation 을 거부한다. `INSERT SELECT` + `ALTER DELETE` 2단계뿐이다. 1차 복구와 같은 도구로 돌아온 셈이다.

<b>오류 없이 0건 삽입되는 함정</b>

처음 쓴 쿼리는 이랬다.

```sql
-- 구 project_id 행을 읽어 project_id 만 바꿔 다시 넣으려는 의도
INSERT INTO langfuse.traces
SELECT * REPLACE ('<신 id>' AS project_id) FROM langfuse.traces
WHERE project_id='<구 id>' AND toYYYYMM(timestamp)=202506
```

파티션 14개가 전부 `ok` 를 찍고 끝났는데 행수가 하나도 안 늘었다. `system.query_log` 를 보니 `written_rows=0, read_rows=0, exception_code=0` — 읽기 자체가 0행이다.

`REPLACE (... AS project_id)` 가 만든 별칭이 WHERE 절의 `project_id` 까지 치환해서, 조건이 `'<신 id>'='<구 id>'` 가 되어 항상 거짓이 된다. `SELECT * EXCEPT(project_id), '<신 id>' AS project_id` 도 똑같이 0행. `SELECT * REPLACE(number+1 AS number) FROM numbers(3)` 는 정상 동작하니 구문 지원 문제는 아니다. <b>오류가 안 나서 로그만 보면 14개 파티션 전부 성공으로 읽힌다</b>는 게 위험했다. 필터를 안쪽 서브쿼리로 분리해서 해결했다.

```sql
-- WHERE 를 서브쿼리 안으로 밀어 별칭 치환 범위에서 빼낸다
INSERT INTO langfuse.traces (<명시 컬럼>)
SELECT <컬럼, project_id 자리에 '<신 id>'>
FROM (SELECT * FROM langfuse.traces WHERE project_id='<구 id>' AND toYYYYMM(timestamp)=202506)
```

`mutations_sync=2` 도 안 먹었다. 중단된 파티션의 부분 적재를 지우려고 `ALTER TABLE ... DELETE WHERE ... SETTINGS mutations_sync=2` 를 썼는데 즉시 반환됐고 직후 count 가 그대로였다. `system.mutations` 를 보니 한참 뒤에 완료돼 있었다. 이후로는 `system.mutations` 를 폴링해서 확인했다.

검증은 이번에도 `uniqExact(id)` 였다. 파티션별로 복사본이 원본보다 적게 나왔는데(한 달치가 원본 15,586 / 복사 15,203), 미병합 중복 버전 때문이고 uniq 로 보면 양쪽 14,861 로 같았다. 1차 복구에서 한 번 데였으니 이번엔 안 놀랐다.

> [!NOTE] ClickHouse 의 비용은 행이 아니라 바이트다
> `observations` 는 행당 비압축 53 KiB 다. 용량이 `output`(48.4 GiB 압축) + `input`(11.0 GiB) 두 컬럼이고 나머지 전 컬럼 합은 200 MiB 미만이다. 그래서 파티션 처리 시간이 행수보다 <b>읽은 바이트</b>와 거의 선형이었다(6만 행 3.49 GiB 3분 vs 6.5만 행 10.23 GiB 18분).
> RDBMS 의 UPDATE 는 변경 행 수 × 인덱스 수에 비례하고 넓은 텍스트는 TOAST 로 분리돼 안 바뀌면 재작성되지 않는다. ClickHouse 는 mutation 이 파트 전체 재작성이라 비용이 재작성 바이트에 비례한다. `project_id` 25바이트를 바꾸겠다는데 `output` 67 GiB 가 같이 재작성된다.
> 참고로 `max_insert_threads` 기본값은 1 이다(코어는 52장). 넓은 `Nullable(String)` 정렬·압축이 그 한 스레드에서 CPU 바운드가 되는데, 라이브 인제스트와 merge 가 같은 디스크를 두고 경쟁하는 상황이라 병렬화는 일부러 안 했다.

### 9. 삭제 직전에 발견한 스토리지 참조

검증이 끝나고 구 프로젝트와 org 를 삭제하기로 했다. "다른 데이터가 실수로 삭제되면 안 된다"는 조건이 붙었다.

삭제 방법을 고르기 전에 S3 경로를 먼저 봤다. 이게 결정적이었다.

```
현행 프로젝트 media 13,433건 중 6,115건 → 구 프로젝트 prefix 의 파일을 가리킴
현행 프로젝트 blob_storage_file_log 중 132,591건 → 구 prefix
버킷의 구 prefix 아래 → 오브젝트 6,124개 실재
```

이관할 때 `bucket_path` 는 손대지 않았다. 즉 <b>현행 프로젝트가 구 프로젝트 prefix 의 실제 파일을 참조하는 상태</b>다. 그런데 langfuse 의 프로젝트·org 삭제 기능은 그 프로젝트의 버킷 prefix 를 purge 하도록 설계돼 있다. UI 버튼을 눌렀으면 방금 두 번에 걸쳐 되살린 미디어 6,115건이 그대로 깨졌을 것이다.

그래서 <b>langfuse 의 삭제 기능을 배제하고, 메타데이터만 SQL 로 지우고 오브젝트 스토리지는 손대지 않는</b> 방식을 택했다.

Postgres 는 파급 범위를 먼저 확정했다. `projects` 참조 FK 가 45개, `organizations` 참조가 7개다. 구 키에 걸린 잔여 행을 전수 조사해 cascade 로 지워질 것을 확정했다 — `api_keys` 4, `media` 7, `notification_preferences` 1, `trace_sessions` 3, `organization_memberships` 2, `projects` 1. `audit_logs` 는 FK 가 없어 명시 삭제가 필요했다(9행). 백업 테이블은 `CREATE TABLE AS` 로 만들어 제약이 0개라 cascade 에 안 휩쓸리는 것도 확인했다.

ClickHouse 는 `project_id` 스코프 `ALTER DELETE`. 테이블에 존재하는 `project_id` 가 두 값뿐임을 확인하고 술어를 걸었다.

| 테이블 | 삭제 행수 | 용량 |
|---|---|---|
| `traces` | 541,317 | 2.71 → 1.36 GiB |
| `observations` | 916,100 | 79.16 → 39.05 GiB |
| `blob_storage_file_log` | 132,591 | 64.42 → 42.66 MiB |

`observations` 는 60개 파트에 약 1시간 걸렸다(60 → 31 → 9 → 3 → 0).

Postgres 는 트랜잭션 안에 가드 DO 블록을 넣었다. 현행 데이터 4개 테이블·`users`·백업 테이블이 불변인지, `projects`/`organizations` 가 각각 1개씩만 줄었는지 검사하고 아니면 예외를 던지게 했다. 첫 시도는 가드 자체가 터졌다.

```
ERROR: record "a" has no field "f1"
```

`SELECT (...), (...) INTO a` 로 record 에 담으면 컬럼 이름이 안 붙는다. `ON_ERROR_STOP=1` 덕에 전체 롤백됐고, 롤백됐는지(구 프로젝트가 아직 살아 있는지) 확인한 뒤 명시 변수 선언으로 고쳐 재실행했다.

```
NOTICE: GUARD 통과: projects 2->1, orgs 2->1, 현행 데이터/users/백업 불변
```

가드가 목적대로 동작한 셈이다. 막은 대상이 실수가 아니라 가드 자신의 문법 오류였다는 게 좀 웃겼다.

마무리로 백업 테이블을 DROP 하고, 구 org 에만 속해 있던 고아 계정 하나를 지웠다. 계정 삭제는 데이터 이관과 별개 판단이라 사용 흔적(세션 0 / 소유 리소스 전부 0 / 감사 로그 0, 초기화 env 대상 아니라 재생성 안 됨)을 먼저 제시하고 확인받은 뒤 실행했다.

## 4. 확인

- public API 로 전환 이전 구간 조회: `totalItems` 540,527 (작업 전 0)
- 최고령 trace `2025-06-27T02:07:11Z`, 현행 프로젝트 소속, 전체 646,694건
- 트레이스 상세: 2025-11-06 trace 의 observation 이 input 56 KB / output 656 KB 정상 반환
- 이관된 media 의 presigned URL 발급 후 실제 오브젝트 존재 확인
- replica 3대 모두 `project_id` 단일
- 구 데이터 원본(3노드 디렉터리 Retain + 42G 아카이브)은 그대로 보존

두 번 다 숫자로 끝내지 않고 실제 트레이스를 열어 본문과 미디어까지 확인했다. 1차 복구에서 "행수는 맞는데 uniq 가 다른" 착시를 겪었으니 눈으로 봐야 마음이 놓인다.

## 참고

- 되짚어보면 잘못은 "이관을 빠뜨린 것"이 아니라 <b>관측 이력의 값을 낮게 평가한 것</b>이다. 절차는 있었고 판단도 기록돼 있었다("트레이스 히스토리만 초기화"). 앱이 안 죽으니 버려도 된다고 본 건데, 1년치 트레이스는 앱의 상태가 아니라 <b>제품 사용 이력</b>이라 값이 다르다. `mv` 가 안 되는 구조였던 건 사실이지만, 그때 필요한 결론은 "fresh 로 가자"가 아니라 "그럼 별도 정밀 작업을 지금 하자"였다. 결국 그 정밀 작업을 닷새 뒤에 하게 됐다.
- 다음 환경 전환은 <b>최초 계획대로 기존 PV 를 인플레이스 재사용</b>해서 손실이 없었다. CHI/CHK 이름을 라이브와 동일하게 유지하는 것이다 — 그 이름 하나가 operator 가 만드는 PVC 이름(`<VCT>-chi-<CHI이름>-<cluster>-<shard>-<replica>-0`)과 `{replica}` 매크로를 동시에 결정하기 때문에, 이름을 맞추면 데이터 경로와 복제 정합이 함께 산다. 이름을 바꾸면 새 PVC 가 생겨 구 PV 데이터가 고아가 되고, keeper 에 등록된 replica znode 도 못 찾아 "빈 신규 replica" 로 등록된다. 스테이징이 정확히 그 경로였다.
- 그쪽은 별개 함정이 있었다. 구 형상 데이터가 ClickHouse 의 `default` DB 에 들어 있어서, 신 차트 기본값(`database: langfuse`)대로 sync 하면 76GB(traces 3,335,485 / observations 4,752,114)를 유기하게 되는 구조였다. values override 로 배선을 맞춰 넘겼다. <b>데이터를 인플레이스로 이어도 앱이 다른 DB 를 보면 빈 것처럼 된다.</b>
- 이 교훈은 전환 가이드의 트러블슈팅 문서("ClickHouse 데이터가 전환 후 안 보이거나 복제가 깨진다")로 반영됐다.
- 재발방지 후속 이슈나 troubleshoot 문서를 repo 에 남기지는 않았다. 원인이 차트의 초기화 env 구조인데 문서를 남긴다고 그 구조에서 문제 발생을 막을 원천적인 방법이 되지 않고, 이미 langfuse 가 운영 중인 환경을 다시 전환하는 상황 자체가 쉽게 재발할 이슈가 아니라 시간 투자 대비 얻는 게 적다고 봤다.
- 오브젝트 스토리지의 구 prefix 6,124개를 현행 prefix 로 옮기는 완전 정리(오브젝트 복사 → `media.bucket_path` 와 `blob_storage_file_log` 경로 갱신 → 구 prefix 삭제)는 제시했지만 채택하지 않았다. 기능상 무해하지만 이미 삭제된 프로젝트 id 이름의 prefix 가 영구적으로 남아, 나중에 누군가 고아 데이터로 오인하기 딱 좋다. (아마 그 누군가는 미래의 나일 것 같다.)
- 물리 중복 정리(`OPTIMIZE ... FINAL`)와 구 데이터 보존 기간 조정은 별건으로 미뤘다.
