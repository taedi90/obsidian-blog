---
title: Weaviate 클러스터 간 증분 동기화 스크립트로 컷오버 다운타임 줄이기
date: 2026-07-15
draft: false
featured: true
tags:
  - weaviate
  - vector-database
  - migration
  - python
  - automation
banner: 
cssclasses: 
description: backup/restore만으로는 다운타임이 데이터 크기에 비례하는 Weaviate 이관을, 삭제 CDC 부재라는 제약을 인정한 채 stdlib만으로 증분 동기화 스크립트를 짜서 컷오버 잔여분만 반영하도록 만든 기록.
permalink: 
aliases: 
completed: true
type:
  - automation
---

## 요약

> [!SUMMARY]
> Weaviate는 클러스터 간 실시간 복제(CDC)가 없어 backup/restore로만 이관하면 쓰기 정지 시간이 데이터 크기에 비례한다. 그래서 미리 backup/restore로 채워두고, 그 뒤 바뀐 오브젝트만 `after` 커서로 전량 순회해 따라잡는 증분 동기화 스크립트를 stdlib만으로 짰다.

Weaviate 클러스터를 통째로 다른 클러스터로 옮기는 일을 맡았다. 노드 이름이 바뀌는 케이스라 파일 복사(재부착)는 불가능하고 backup/restore로 논리이관을 해야 했는데, 여기서 다운타임 문제가 걸렸다. 이 스크립트는 그 다운타임을 줄이려고 만든 보조 도구다. 이관 전체 절차가 아니라 "증분을 어떻게 따라잡았나"만 떼어 적는다.

## 1. backup/restore만으로는 왜 부족한가

Weaviate(OSS)에는 클러스터 간 실시간 복제가 없다. 공식 이관 수단은 backup/restore 하나뿐인데, backup은 늘 전체 스냅샷이다. "지난번 이후 바뀐 것만" 같은 증분 백업이 없다.

그러면 컷오버(구 클러스터 → 신 클러스터 전환) 시나리오는 이렇게 된다. 쓰기를 멈추고, 전체 백업을 뜨고, 신 클러스터에 복원하고, 엔드포인트를 넘긴다. 문제는 이 <b>쓰기 정지 시간이 데이터 크기에 비례</b>한다는 점이다. stg에서 재봤더니 608 클래스·19GB 기준으로 백업 수십 분에 restore 마무리 수 분이 걸렸다. 데이터가 더 크면 그만큼 늘어난다. 서비스를 그 시간만큼 세워둘 수는 없었다.

방법은 흔한 패턴이다. 미리 backup/restore로 새 클러스터를 채워두고(시딩), 그 이후 생긴 변경분만 따로 따라잡은 뒤, 컷오버 때는 남은 소량만 반영한다. 이러면 중단창이 "전체 복원 시간"에서 "마지막 델타 반영 시간"으로 줄어든다. 문제는 그 "변경분만 따라잡는" 도구가 Weaviate에는 없다는 것이다. 그래서 직접 만들었다.

## 2. Weaviate가 안 주는 것 두 가지

증분 동기화를 짜려면 보통 두 개가 필요하다. "무엇이 바뀌었는지"와 "무엇이 지워졌는지". Weaviate는 이 둘을 순순히 주지 않는다.

<b>생성·수정은 그나마 방법이 있다.</b> 오브젝트마다 `lastUpdateTimeUnix`(마지막 수정 시각, unix ms)가 노출된다. 그러니 "시딩 시각 이후 수정된 오브젝트"를 골라낼 여지는 있다. 다만 이걸 서버 측 `where` 필터로 거는 건 이 저장소 버전(1.36)에서 불안정했다. 시간 필터가 예상대로 안 걸려서, 결국 <b>클라이언트에서 걸러내는</b> 쪽으로 방향을 틀었다. 소스를 전량 순회하면서 각 오브젝트의 `lastUpdateTimeUnix`를 코드에서 비교하는 방식이다. 우아하진 않지만 서버 필터의 신뢰성에 기대지 않아도 된다.

<b>삭제는 아예 방법이 없다.</b> 삭제된 오브젝트를 알려주는 수단이 없다. 삭제 CDC가 없으니 "시딩 이후 지워진 문서"를 소스에 물어볼 데가 없는 것이다. 이건 우회할 수밖에 없었다. 소스와 타깃의 전체 UUID 집합을 대조해서, 타깃에만 있고 소스에 없는 것을 지운다. 전량 순회라 느리고 비싸서, 평소 델타에는 끄고 컷오버 정합이 필요할 때만 켜는 옵션으로 뒀다.

한 가지 전제가 있다. 대상 클래스가 `vectorizer=none`(벡터를 직접 주입하는 방식)이어야 한다. 저장된 벡터를 그대로 다시 넣기 때문에 재벡터화가 일어나지 않는다. 임베딩을 서버가 만드는 구성이면 이 전제가 깨진다.

> [!INFO]
> 이관 얘기를 하다 보면 Collection aliases나 async replication을 떠올리는 사람이 있는데, 둘 다 이 문제엔 안 맞았다. aliases(1.32+)는 한 클러스터 "안"에서 컬렉션 이름을 바꿔 끼우는 기능이고, async replication(1.29 GA)은 한 클러스터 "안" 복제본 노드 간 일관성용이다. 클러스터-대-클러스터 이관 도구가 아니다.

## 3. 커서로 전량 순회하며 클라이언트에서 델타 추출

핵심 순회 로직은 REST `/v1/objects`의 `after` 커서다. 마지막으로 받은 오브젝트의 id를 다음 요청의 `after`로 넘겨 페이지를 이어받는다. `include=vector`를 붙여 벡터까지 같이 가져온다(재주입해야 하므로).

```python
# 소스 클래스를 after 커서로 끝까지 순회한다. 빈 페이지가 오면 종료.
def iter_objects(base, key, cls, page, include_vector=True):
    after = None
    while True:
        url = "%s/v1/objects?class=%s&limit=%d" % (base, cls, page)
        if include_vector:
            url += "&include=vector"
        if after:
            url += "&after=" + after
        st, d = http("GET", url, key)
        if st != 200:
            sys.exit("[%s] 객체 조회 실패 %s: %s" % (cls, st, str(d)[:200]))
        objs = d.get("objects", [])
        if not objs:
            break
        for o in objs:
            yield o
        after = objs[-1]["id"]
```

이렇게 흘러나온 오브젝트를 받아, `lastUpdateTimeUnix`가 `--since`(시딩 시각) 이상인 것만 델타로 추린다. 서버 시간 필터를 안 쓰는 대신 전량을 훑어야 하지만, GET만 하니 소스에 부담이 크지 않고 라이브 운영 중에도 돌릴 수 있다.

```python
# 순회하며 델타를 모아 배치로 upsert. reconcile-deletes면 소스 UUID도 함께 수집.
for o in iter_objects(a.source, skey, cls, a.page):
    scan += 1
    if a.reconcile_deletes:
        src_ids.add(o["id"])
    lut = int(o.get("lastUpdateTimeUnix") or 0)
    if lut >= a.since:
        delta += 1
        obj = {"class": cls, "id": o["id"], "properties": o.get("properties", {})}
        if o.get("vector") is not None:
            obj["vector"] = o["vector"]
        batch.append(obj)
        if not a.dry_run and len(batch) >= a.batch:
            batch_upsert(a.target, tkey, batch)
            batch = []
```

`--since 0`으로 두면 전량이 델타가 되니, 스키마만 미리 만들어 둔 빈 타깃에 전체 백필도 된다. backup 모듈을 못 켜는 라이브 소스를 우회할 때 이 모드를 썼다.

## 4. UUID 보존 batch upsert

적재는 `/v1/batch/objects`로 한다. 여기서 신경 쓴 건 <b>UUID 보존</b>이다. 소스 오브젝트의 id를 그대로 실어 보내면 타깃에서 같은 id는 덮어쓰기(upsert)가 된다. 새 id를 발급받는 게 아니다.

이게 왜 중요하냐면, 스크립트를 여러 번 돌려도 안전하기 때문이다. 델타는 컷오버 전까지 여러 차례 돌려 남은 변경분을 조금씩 줄여가는 식으로 쓴다. 같은 오브젝트가 두 번 반영돼도 id가 같으니 그냥 덮어써질 뿐, 중복 레코드가 쌓이지 않는다. <b>멱등성(Idempotency)</b>이 id 보존 하나로 확보되는 셈이다.

```python
# UUID를 실어 보내 같은 id는 덮어쓴다. 배치 내 개별 실패는 전량 중단 대신 경고로 넘긴다.
def batch_upsert(base, key, objs):
    if not objs:
        return
    st, d = http("POST", base + "/v1/batch/objects", key, {"objects": objs})
    if st != 200:
        sys.exit("batch import 실패 %s: %s" % (st, str(d)[:300]))
    failed = [r for r in (d if isinstance(d, list) else [])
              if r.get("result", {}).get("status") == "FAILED"]
    if failed:
        sys.stderr.write("  경고: batch 내 %d 건 실패 (예: %s)\n"
                         % (len(failed), str(failed[0].get("result", {}).get("errors"))[:200]))
```

batch API는 요청 자체는 200이어도 개별 오브젝트가 실패할 수 있어서(응답 배열의 `result.status`가 `FAILED`), 그건 따로 세어 경고로 흘린다. 전송 계층은 429·5xx에 한해 짧게 백오프하며 최대 네 번까지 시도하도록 `http()`에 넣어뒀다. air-gapped 환경에서 순간적인 흔들림에 통째로 죽지 않게 하는 정도의 방어다.

## 5. 삭제 정합은 옵션으로

삭제는 앞서 적은 대로 CDC가 없으니 전량 UUID 대조로 처리한다. `--reconcile-deletes`를 켜면, 순회하며 모아둔 소스 UUID 집합에 없는 타깃 오브젝트를 지운다.

```python
# 타깃을 순회하며 소스에 없는 UUID를 삭제. dry-run이면 세기만 한다.
if a.reconcile_deletes and a.target:
    for o in iter_objects(a.target, tkey, cls, a.page, include_vector=False):
        if o["id"] not in src_ids:
            if a.dry_run:
                deleted += 1
            else:
                st, _ = http("DELETE", "%s/v1/objects/%s/%s" % (a.target, cls, o["id"]), tkey)
                if st in (200, 204):
                    deleted += 1
```

이건 소스·타깃을 양쪽 다 전량 순회하니 느리다. 그래서 평소 델타 반영에는 끄고, append-only가 아닌 이상 컷오버 정합 단계에서만 켰다. 삭제 빈도를 앱팀이 확답 못 하면 켜두는 쪽을 택했다. "지운 문서가 검색에 계속 나오는" 조용한 버그가 안 켜서 생기는 손해보다 성가신 게 낫다고 봤다. 안전장치로 구 클러스터와 Retain PV는 검증 끝날 때까지 남겨뒀다.

## 6. dry-run과 컷오버에서 쓰는 법

쓰기 전에 항상 `--dry-run`으로 건수부터 봤다. 반영 없이 "이번에 몇 건이 델타인지, 몇 건이 삭제 대상인지"만 세어 출력한다. 컷오버 창을 잡을 때 마지막 델타가 얼마나 남았는지 가늠하는 근거가 된다.

```bash
# 델타 미리보기(쓰기 없음): 특정 시각 이후 변경 건수만 센다. 키는 env로만 주고 로그에 찍지 않는다.
WEAVIATE_API_KEY=<REDACTED> weaviate-delta-sync.py \
  --source http://src-weaviate:8080 --dry-run --since 1782100000000

# 실제 증분 반영(생성/수정)
WEAVIATE_API_KEY=<REDACTED> weaviate-delta-sync.py \
  --source http://src-weaviate:8080 --target http://dst-weaviate:8080 --since 1782100000000

# 최종 컷오버: 삭제까지 정합
WEAVIATE_API_KEY=<REDACTED> weaviate-delta-sync.py \
  --source http://src-weaviate:8080 --target http://dst-weaviate:8080 --reconcile-deletes
```

실제 흐름은 이렇게 됐다. backup/restore로 시딩한 뒤 시딩 시각을 `--since`로 넣어 델타를 여러 번 돌려 남은 변경분을 줄이고, 컷오버 때 쓰기를 잠깐 멈춘 다음 마지막 델타 + 삭제 대조를 한 번 더 돌리고, 앱이 바라보는 엔드포인트를 신 클러스터로 넘겼다.

API 키는 `--api-key` 인자나 `WEAVIATE_API_KEY` 환경변수로만 받고, <b>어떤 로그에도 값을 출력하지 않는다</b>. 소스·타깃 키가 다르면 `--source-key`/`--target-key`로 따로 준다. 의존성은 없다. `urllib` 등 표준 라이브러리만 써서, 폐쇄망에 파이썬 인터프리터만 있으면 그대로 돌아간다. pip로 뭘 가져올지 협의하는 수고를 덜려고 일부러 그렇게 짰다.

한계는 분명하다. 이건 실시간 복제가 아니라 "돌릴 때마다 그 시점까지 따라잡는" 폴링형 도구고, 서버 시간 필터가 못 미더워 매번 전량을 순회한다. 삭제 정합은 더 비싸다. 그래도 backup/restore 하나로 다운타임을 데이터 크기에 통째로 묶어두는 것보다는 훨씬 나았다.

## 참고

- [Weaviate REST API — objects](https://docs.weaviate.io/weaviate/api/rest)
- [Weaviate — Read all objects (cursor)](https://weaviate.io/developers/weaviate/manage-data/read-all-objects)
- [Python urllib.request](https://docs.python.org/3/library/urllib.request.html)
- [[Weaviate가 클러스터 전체 다운 후 안 뜬다 Raft 부트스트랩 타임아웃 튜닝|Weaviate 클러스터가 안 뜰 때 겪은 Raft 이슈]]
