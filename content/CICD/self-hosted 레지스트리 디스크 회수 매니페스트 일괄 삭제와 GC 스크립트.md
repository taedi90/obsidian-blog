---
title: self-hosted Docker Registry 디스크 회수 스크립트 만들기
date: 2026-02-24
draft: false
tags:
  - docker
  - docker-registry
  - bash
  - devops
  - garbage-collection
banner: 
cssclasses: 
description: 오래된 태그가 쌓여 디스크를 잠식하던 자체 호스팅 레지스트리를, HTTP API로 매니페스트를 일괄 삭제하고 GC로 실제 용량을 회수하는 bash 스크립트 세트로 정리한 기록.
permalink: 
aliases: 
completed: true
type:
  - tooling
---

## 요약

> [!SUMMARY]
> 사내 self-hosted 레지스트리가 오래된 태그로 디스크를 계속 잠식했다. 레지스트리 HTTP API로 리포지토리의 매니페스트를 일괄 삭제하고(`--dry-run` 지원), 실제 디스크는 `garbage-collect`로 회수한 뒤, 어느 리포지토리가 얼마를 먹는지 용량을 조회하는 bash 스크립트 세트로 정리했다. 파괴적인 삭제 쪽에는 dry-run을 기본 안전장치로 넣었다.

CI가 이미지를 밀어넣을 때마다 태그가 하나씩 쌓인다. `latest`야 덮어써진다 쳐도 커밋 해시나 빌드 번호로 태그를 붙이면 옛날 태그가 그대로 남는다. self-hosted 레지스트리는 이걸 알아서 치워주지 않는다. 몇 달 방치했더니 디스크가 슬금슬금 차올랐고, "이거 어디서부터 지워야 하지"를 매번 손으로 하기 싫어서 스크립트로 묶었다.

## 1. 레지스트리에서 삭제가 두 단계인 이유

처음엔 태그만 지우면 용량이 빠질 줄 알았다. 안 빠진다. 여기서 한 번 헤맸다.

레지스트리에서 이미지를 지우는 건 두 단계다.

- <b>매니페스트 삭제</b>: 태그가 가리키는 매니페스트(manifest)를 지운다. 태그는 사라지지만, 실제 데이터인 <b>blob</b>(레이어·config)은 디스크에 그대로 남는다. 매니페스트 삭제는 그냥 "이 참조를 끊는다"에 가깝다.
- <b>가비지 컬렉션(GC)</b>: 어떤 매니페스트도 참조하지 않게 된 blob을 실제로 디스크에서 지운다. 여기까지 해야 용량이 준다.

즉 태그를 아무리 지워도 GC를 안 돌리면 디스크는 1바이트도 안 빠진다. 이 구조를 모르고 "삭제했는데 왜 안 줄지" 하고 한참 봤다.

한 가지 더. 레지스트리는 기본값으로 DELETE 요청 자체를 막아둔다. 삭제를 쓰려면 config에서 열어줘야 한다.

```yaml
# /etc/docker/registry/config.yml
# 이 값이 true여야 매니페스트 DELETE API가 202를 돌려준다.
# 없거나 false면 삭제 요청이 405(Method Not Allowed)로 튕긴다.
storage:
  delete:
    enabled: true
```

## 2. 매니페스트 일괄 삭제 스크립트

핵심 스크립트다. 리포지토리 이름 하나를 받아서, 그 안의 태그를 전부 훑고 각 태그의 매니페스트를 지운다. 레지스트리 HTTP API(V2)만 쓴다.

흐름은 단순하다.

1. `GET /v2/<repo>/tags/list`로 태그 목록을 받는다.
2. 태그마다 HEAD 요청으로 매니페스트의 digest를 알아낸다.
3. 그 digest로 `DELETE /v2/<repo>/manifests/<digest>`를 날린다.

두 번째 단계가 좀 비직관적이다. 삭제는 태그 이름이 아니라 <b>digest</b>로 해야 한다. 그래서 태그 → digest를 먼저 구한다. 이때 `Accept` 헤더로 V2 매니페스트를 명시해줘야 응답 헤더의 `Docker-Content-Digest`에 우리가 원하는 digest가 담겨 온다. 이 헤더를 빼먹으면 digest가 어긋나서 삭제가 404로 빠진다.

```bash
# 태그 하나의 매니페스트 digest를 HEAD 요청으로 구한다.
# Accept 헤더로 V2 매니페스트를 요청해야 Docker-Content-Digest가 우리가 지울 digest로 온다.
DIGEST=$(curl -s -k -I -H "Accept: application/vnd.docker.distribution.manifest.v2+json" \
    $AUTH_CREDENTIALS \
    "${REGISTRY_URL}/v2/${REPOSITORY}/manifests/${tag}" \
    | grep -i "Docker-Content-Digest" | awk '{print $2}' | tr -d '\r')
```

삭제는 digest로 DELETE를 날리고 HTTP 코드로 결과를 판단한다. 성공은 `202`, 이미 지워진 건 `404`로 넘어간다.

```bash
# digest로 매니페스트를 삭제한다. 성공하면 202를 돌려준다.
DELETE_RESPONSE=$(curl -s -k -X DELETE -w "%{http_code}" -o /dev/null \
    $AUTH_CREDENTIALS \
    "${REGISTRY_URL}/v2/${REPOSITORY}/manifests/${DIGEST}")
```

### dry-run을 기본으로 깔아둔 이유

이건 되돌릴 수 없는 작업이다. 잘못된 리포지토리 이름을 넣거나 REGISTRY_URL을 운영 레지스트리로 잘못 겨눈 채 실행하면 그대로 다 날아간다. 그래서 `--dry-run` 플래그를 뒀다. 붙이면 삭제 대신 "무엇을 지울지"만 출력한다.

```bash
if [ "$DRY_RUN" = true ]; then
    echo -e "${YELLOW}[DRY-RUN] Would delete manifest: ${REGISTRY_URL}/v2/${REPOSITORY}/manifests/${DIGEST}${NC}"
else
    # 실제 DELETE 실행
    ...
fi
```

실행할 때 항상 dry-run으로 한번 돌려서 대상 리포지토리와 태그 개수가 예상과 맞는지 눈으로 확인하고, 그다음에 플래그를 뺀다. 스크립트 상단에도 dry-run 모드임을 노란색으로 찍게 해뒀다.

인자·환경변수 처리도 최소한만 넣었다. 레지스트리 주소는 환경변수로 받고, 인증이 걸려 있으면 `REGISTRY_USER`/`REGISTRY_PASS`로 basic auth를 얹는다. 비밀번호는 스크립트에 박지 않고 환경변수로만 넘긴다.

```bash
# 레지스트리 주소는 환경변수로 주입. 끝의 슬래시는 정리한다.
REGISTRY_URL="${REGISTRY_URL:-http://10.10.20.30:30500}"
REGISTRY_URL=${REGISTRY_URL%/}

# 자격증명이 있을 때만 -u 옵션을 붙인다.
if [[ -n "$REGISTRY_USER" && -n "$REGISTRY_PASS" ]]; then
    AUTH_CREDENTIALS="-u ${REGISTRY_USER}:${REGISTRY_PASS}"
else
    AUTH_CREDENTIALS=""
fi
```

## 3. 여러 리포지토리를 한 번에

정리 대상이 리포지토리 수십 개였다. 하나씩 손으로 치기 귀찮아서 얇은 래퍼 스크립트를 하나 더 뒀다. REGISTRY_URL을 한 번 export하고, 지울 리포지토리를 나열해 위 스크립트를 반복 호출하는 게 전부다.

```bash
#!/bin/bash
export REGISTRY_URL='http://10.10.20.30:30500'

# 살릴 리포지토리는 주석 처리해두면 목록에서 눈으로 관리하기 편하다.
#./delete-all-manifests.sh admin-front
./delete-all-manifests.sh admin-api
./delete-all-manifests.sh app-api
./delete-all-manifests.sh chat-api
./delete-all-manifests.sh gateway-api
./delete-all-manifests.sh report-api
# ... (정리 대상 리포지토리 나열)
```

거창할 것 없는 목록이지만, 지울 것과 남길 것을 주석으로 토글하면서 관리할 수 있어서 실수는 줄었다. 이 목록 자체를 dry-run으로 먼저 한 바퀴 돌려보는 것도 같은 이유다.

## 4. 어디가 용량을 먹는지 조회

지우기 전에 "어느 리포지토리가 얼마나 먹는지"를 봐야 우선순위가 선다. 레지스트리는 이걸 대시보드로 안 주니 API를 긁어 직접 집계했다.

`_catalog`로 전체 리포지토리를, 각 리포지토리의 `tags/list`로 태그를, 태그마다 매니페스트를 받아 레이어 크기를 합산한다. 응답 크기는 `.layers[].size`를 더하면 나온다.

```bash
# 매니페스트의 레이어 크기를 모두 더해 태그 하나의 용량(byte)을 구한다.
SIZE_BYTES=$(echo "$BODY" | jq -r '[.layers[]?.size] | add // 0')
```

세 군데를 신경 써야 제대로 나온다.

- <b>페이지네이션</b>: 리포지토리·태그가 많으면 응답이 `Link` 헤더로 쪼개져 온다. `rel="next"`를 따라가며 전부 모으는 함수를 하나 두고 catalog·tags 조회에 공용으로 썼다.
- <b>중복 집계</b>: 서로 다른 태그가 같은 이미지(같은 digest)를 가리키는 일이 흔하다. `latest`와 `v1.2.3`이 같은 빌드인 식이다. digest를 키로 묶어 한 번만 세지 않으면 용량이 뻥튀기된다. awk에서 `repo + digest`를 키로 합치고 태그는 콤마로 이어 붙였다.
- <b>사람이 읽는 단위</b>: byte 그대로 찍으면 눈에 안 들어와서 GB/MB/KB로 변환하고, 큰 순으로 정렬해 출력했다.

```awk
# byte를 사람이 읽는 단위로.
function human(x) {
    if (x>=1073741824) return sprintf("%.2f GB", x/1073741824)
    if (x>=1048576)    return sprintf("%.2f MB", x/1048576)
    if (x>=1024)       return sprintf("%.2f KB", x/1024)
    return sprintf("%d B", x)
}
```

출력은 `SIZE | HASH ID | REPOSITORY | TAGS` 한 줄짜리 표로 나온다. 이걸 보고 덩치 큰 리포지토리부터 정리 목록에 올렸다.

> [!NOTE]
> 여기서 재는 건 매니페스트가 참조하는 레이어의 합이다. 여러 태그가 레이어를 공유하면 실제 디스크 점유는 이 합계보다 적다. 정확한 물리 용량은 결국 스토리지에서 `du`로 봐야 한다. 이 스크립트는 "어디를 먼저 손댈까"를 정하는 상대 비교용으로 충분했다.

## 5. GC로 실제 디스크 회수

매니페스트를 다 지웠으면 마지막은 GC다. 이걸 안 하면 앞의 삭제는 디스크에 아무 영향이 없다(1번에서 헤맨 지점이다). 레지스트리 컨테이너 안에서 실행한다.

```bash
# 참조가 끊긴 blob을 실제로 삭제한다.
# --dry-run을 붙이면 무엇을 지울지만 출력하고 지우지는 않는다.
registry garbage-collect /etc/docker/registry/config.yml --dry-run
registry garbage-collect /etc/docker/registry/config.yml
```

`garbage-collect`에도 `--dry-run`이 있다. 삭제 스크립트와 마찬가지로 먼저 dry-run으로 어떤 blob이 지워질지 확인하고 실제 GC를 돌렸다. GC까지 마치고 나서야 디스크 사용량이 눈에 띄게 빠졌다.

> [!IMPORTANT]
> GC는 push가 없는 시점에 도는 게 안전하다. 삭제 대상을 계산하는 동안 새 이미지를 밀어넣으면, 아직 매니페스트가 안 붙은 blob을 참조 없는 것으로 보고 지워버릴 수 있다. 정리 작업은 CI가 조용한 시간대에 잡았다.

## 참고

- [Docker Registry HTTP API V2](https://distribution.github.io/distribution/spec/api/)
- [Registry garbage collection](https://distribution.github.io/distribution/about/garbage-collection/)
- [distribution/distribution (레지스트리 구현체)](https://github.com/distribution/distribution)
