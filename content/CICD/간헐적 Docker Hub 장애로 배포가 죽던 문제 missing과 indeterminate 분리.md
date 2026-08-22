---
title: 간헐적 Docker Hub 장애로 배포가 죽던 문제 — missing과 indeterminate를 분리해 파이프라인 살리기
date: 2026-07-21
draft: false
tags:
  - jenkins
  - ci-cd
  - docker-hub
  - resilience
  - groovy
  - troubleshooting
banner: 
cssclasses: 
description: 48개는 멀쩡한데 1개 ref의 일시적 Docker Hub 오류로 배포 전체가 죽던 걸, 이미지 검증을 missing과 indeterminate로 갈라 살아남게 만든 기록.
permalink: 
aliases: 
completed: true
type:
  - issue
---

## 요약

> [!SUMMARY]
> 배포 전 이미지 검증에서 1개 ref가 일시적 Docker Hub 오류를 내면 스테이지 전체가 abort됐다. 이걸 <b>missing(확정 없음)</b>과 <b>indeterminate(허브 flake)</b>로 분류해, flake는 재검증하고 없는 건 빌드 잡을 트리거해 self-heal하게 바꿨다.

## 1. 환경

- Jenkins declarative pipeline (배포 잡, v2)
- 공유 라이브러리 헬퍼: 이미지 존재 검증 `imageExists`, 진단용 `dockerHubDiag`
- 파이프라인 안의 검증 함수: `classifyImages` / `ensureImagesExist` (deploy.v2 Jenkinsfile에 인라인)
- 레지스트리: Docker Hub (`docker.io/<org>/<image>:mod-<commit>`)
- 검증 수단: `docker buildx imagetools inspect`

## 2. 이슈

배포 파이프라인에는 실제 배포에 앞서 <b>Resolve Images</b> 스테이지가 있다. 이번 릴리스에 들어갈 모듈 이미지가 전부 Docker Hub에 올라와 있는지 하나씩 확인하는 단계다. 이미지 태그는 커밋 해시 기반(`mod-<commit>`)이라, 없으면 아직 빌드가 안 됐다는 뜻이고 있으면 그대로 배포로 넘어간다.

어느 날부터 이 스테이지가 간헐적으로 죽기 시작했다. 로그를 보면 모듈 수십 개는 멀쩡히 통과하는데 그중 딱 한두 개 ref에서 검증이 터지고, 그 한 건이 스테이지 전체를 abort시켰다. 48개가 정상이고 1개가 실패하면 배포가 통째로 멈추는 식이다. 문제는 재현이 안 된다는 거였다. 같은 잡을 다시 돌리면 아까 터진 ref가 이번엔 멀쩡히 통과하고, 대신 엉뚱한 다른 ref가 터졌다.

원인은 이미지 검증 헬퍼인 `imageExists`에 있었다. 당시 구현은 단순했다. `imagetools inspect`를 실행해서 종료 코드가 0이면 존재하는 것으로 보고, 아니면 fail-loud(그 자리에서 `error`로 스테이지 중단)로 처리했다.

```groovy
// 예전 imageExists (개념): inspect가 실패하면 그냥 스테이지를 죽였다.
boolean call(String imageUrl) {
    int code = sh(returnStatus: true,
                  script: "docker buildx imagetools inspect '${imageUrl}'")
    if (code != 0) {
        error "image check failed: ${imageUrl}"   // ← 여기서 배포 전체 중단
    }
    return true
}
```

`imagetools inspect`가 0이 아닌 코드로 끝나는 이유는 두 가지가 완전히 다르다. 하나는 <b>이미지가 없는 경우</b>(404, manifest unknown), 다른 하나는 <b>있는지 없는지 판단 자체가 안 되는 경우</b>(429 rate-limit, 401 auth, timeout, 네트워크)다. 예전 코드는 이 둘을 구분하지 않고 둘 다 똑같이 "실패"로 처리했다. 그래서 잠깐 스친 허브 오류 하나에 나머지 47개 검증 결과가 통째로 버려졌다.

## 3. 해결

### 1. 정말 rate limit이었나

의심한 건 Docker Hub rate limit이었다. 배포 한 번에 수십 개 ref를 짧은 시간에 조회하니, pull/manifest 요청이 임계치를 넘어 429를 맞는 그림이 그럴듯했다. 그럴듯한 가설은 일단 반증부터 해보는 게 맞다(안 그러면 엉뚱한 데 백오프만 잔뜩 넣고 끝난다).

두 갈래로 확인했다. 하나는 계정 한도, 하나는 재현이다.

- CI가 쓰는 계정은 pull 면제(pull-exempt) 계정이었고, 인증 엔드포인트도 분당 3000회를 허용했다. 배포 한 번의 조회량과는 자릿수가 달랐다.
- 실패했던 ref를 포함해 56개 조회를 한 번에 몰아치는 burst를 만들어 돌려봤다. 결정론적 rate limit이라면 특정 횟수에서 반드시 재현돼야 한다. 그런데 아무것도 재현되지 않았다.

rate limit이 아니었다. 이건 <b>간헐적인 Docker Hub 에지(edge) 오류</b>였다. 확률적으로 튀는 오류라, 조회량이 많을수록 그중 하나가 걸릴 확률만 올라갈 뿐이었다. 48개 중 1개가 터진 건 48번 조회를 던졌더니 그중 한 번 걸린 쪽이었다.

이 반증으로 방향이 바뀌었다. 알려진 한도 아래로 백오프하는 대신, 진짜 404와 허브 flake를 구분해서 flake는 흘려보내는 쪽으로 잡았다.

### 2. missing과 indeterminate 분리

`imageExists`를 세 갈래로 다시 짰다. inspect 종료 코드가 0이면 존재(true). 에러 출력에 `not found`·`manifest unknown` 같은 문구가 있으면 <b>확정 missing</b>(false). 그 외의 에러는 존재 여부를 판단할 수 없는 <b>indeterminate</b>로 보고, 재시도했다가 그래도 안 풀리면 `error`를 던진다. indeterminate를 절대 false(=없음)로 취급하면 안 된다. 있는 이미지를 없다고 잘못 보고하면 멀쩡한 이미지를 다시 빌드하는 등 더 나쁜 일이 벌어진다.

```groovy
// inspect 출력을 분류: 확정 부재 vs 판단 불가.
def lc = output.toLowerCase()
boolean definitelyAbsent =
    lc.contains('not found') ||
    lc.contains('manifest unknown') ||
    lc.contains('no such manifest') ||
    lc.contains('name unknown')
if (definitelyAbsent) {
    return false   // 확정 missing
}
// 그 외(429/401/timeout/network)는 indeterminate → 재시도, 안 되면 throw
```

inspect 실패 출력과 종료 코드를 한 번의 `sh` 호출에서 같이 잡아야 분류가 되므로, 스크립트 안에서 `set +e`로 죽지 않게 하고 종료 코드를 마커로 찍어 되받는 식으로 처리했다. 이미지 URL은 셸 문자열에 직접 끼워넣지 않고 환경변수(`IMAGE_URL`)로 넘겨 인젝션 여지를 없앴다.

indeterminate일 때의 재시도는 60초 고정 간격에 기본 5회다. Docker Hub의 스로틀은 슬라이딩 윈도우라, 지수 백오프로 촘촘히 두드리는 것보다 60초쯤 통째로 흘려보내면 대개 창을 넘긴다(같은 파이프라인의 retag/skopeo 재시도와 간격을 맞췄다). 5회를 다 쓰고도 못 풀면 그때는 조용히 false를 반환하는 대신 큰 소리로 throw한다. "못 미더운 상태로는 배포로 넘기지 않는다"가 원칙이라, "판단 불가"라는 걸 분명히 남기고 멈추는 쪽이 안전하다.

### 3. 재검증과 self-heal

`imageExists`가 이제 indeterminate에서 예외를 던지므로, 이걸 호출하는 `classifyImages`가 모듈별로 예외를 잡아준다. 한 ref가 허브 flake로 throw해도 나머지 모듈 검증은 계속 돌아가야 하기 때문이다. 결과를 `missing`과 `indeterminate` 두 바구니로 나눠 돌려준다.

```groovy
// 모듈마다 검증하되, indeterminate 예외는 per-module로 잡아 나머지 검증을 살린다.
def classifyImages(def modules) {
    def missing = []
    def indeterminate = []
    withDockerHubLogin {
        modules.each { module ->
            def imageUrl = imageUrlOf(module)
            try {
                if (!imageExists(imageUrl)) {
                    missing.add(module)          // 확정 없음
                }
            } catch (Exception e) {
                indeterminate.add(module)        // 허브 flake — 나중에 재확인
            }
        }
    }
    return [missing: missing, indeterminate: indeterminate]
}
```

`ensureImagesExist`는 이 분류 결과를 받아 바구니별로 다르게 대응한다.

- <b>indeterminate</b>: 허브가 잠깐 삐끗한 것이니, 60초 쉬었다가 indeterminate였던 것만 한 번 더 검증한다. 대부분 이 재검증 한 번에 정상으로 풀린다. 이게 첫 flaky ref에 배포 전체가 죽던 예전 동작을 살아남게 만든 지점이다.
- <b>missing</b>: 이미지가 없는 것이니 빌드 잡을 자동 트리거해 그 이미지를 만들고(self-heal), 방금 없던 것만 다시 검증한다. 빌드까지 했는데도 없으면 그때는 확정 실패로 중단한다.
- 재검증 후에도 끝내 indeterminate가 남으면, 검증 못 한 이미지를 안고 배포로 넘어가지 않는다. 남은 목록을 한 번에 묶어 큰 소리로 실패시킨다.

```groovy
// indeterminate는 한 번 더 확인해 흘려보내고, missing은 빌드로 self-heal.
if (indeterminate) {
    sleep(time: 60, unit: 'SECONDS')
    def recheck = classifyImages(indeterminate)
    missing = missing + recheck.missing
    indeterminate = recheck.indeterminate
}
if (missing) {
    build job: env.BUILD_JOB_NAME, wait: true, parameters: [ /* 없는 것만 빌드 */ ]
    def after = classifyImages(missing)
    if (after.missing) { failMissingImages(after.missing) }
    indeterminate = indeterminate + after.indeterminate
}
if (indeterminate) {
    error "검증 못 한 이미지(indeterminate, 확정 missing 아님): ${indeterminate*.name.join(', ')}"
}
```

### 4. imagetools가 숨긴 HTTP 상세 남기기

`imagetools inspect`는 밑단의 Docker Hub 응답을 `insufficient_scope: authorization failed` 같은 한 줄로 뭉개버린다. 그게 rate 스로틀(RateLimit/Retry-After) 때문인지 진짜 권한 문제(WWW-Authenticate) 때문인지 구분이 안 된다. indeterminate가 재시도까지 다 쓰고 끝내 실패하는 그 순간에, 같은 repo를 직접 한 번 더 찔러 raw HTTP 상태와 진단 헤더를 로그에 남기는 진단 프로브(`dockerHubDiag`)를 붙였다. auth 토큰 엔드포인트와 registry manifest HEAD 각각의 상태/헤더를 찍는다.

이 프로브는 진단 전용이라 무슨 일이 있어도 예외를 던지지 않는다(에러 경로에 끼워넣어도 그 경로의 결과를 바꾸면 안 되니까). 자격증명은 curl의 Authorization 헤더로만 넘기고 비밀번호나 베어러 토큰은 절대 로그에 찍지 않는다. 다음에 또 간헐 오류가 나면, 최소한 그게 스로틀이었는지 인증이었는지는 로그만 보고 판별할 수 있다.

## 4. 확인

바꾸고 나서 확인한 건 두 가지다.

- 48개 정상 + 1개 flaky 같은 상황에서, 이제는 그 1개가 indeterminate로 분류돼 60초 뒤 재검증에서 풀리고 배포가 그대로 이어진다. 한 건의 허브 flake로 스테이지가 abort되지 않는다.
- 이미지가 없는 경우(브랜치 새로 판 직후 등)는 여전히 빌드 잡이 트리거돼 self-heal하고, 그 뒤 재검증에서 통과한다. missing과 indeterminate를 섞지 않으니, "없어서 빌드"와 "허브가 삐끗해서 재시도"가 각자 맞는 대응으로 갈라졌다.

재현 실험으로 rate limit 가설을 접지 않았다면, 아마 429 한도 언저리에 백오프만 잔뜩 넣고 원인인 간헐 에지 오류는 그대로 뒀을 것이다.

## 참고

- [Docker Hub usage and rate limits](https://docs.docker.com/docker-hub/usage/)
- [docker buildx imagetools inspect](https://docs.docker.com/reference/cli/docker/buildx/imagetools/inspect/)
- [Docker Registry HTTP API](https://distribution.github.io/distribution/spec/api/)
- [[비대해진 Jenkinsfile을 공유 라이브러리 v2로 리팩토링하기]] — 이 검증 헬퍼가 사는 공유 라이브러리를 뽑아낸 이야기
