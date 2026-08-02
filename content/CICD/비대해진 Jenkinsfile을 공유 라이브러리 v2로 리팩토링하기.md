---
title: 비대해진 Jenkinsfile을 공유 라이브러리 v2로 리팩토링하기
date: 2026-06-11
draft: false
tags:
  - jenkins
  - ci-cd
  - shared-library
  - refactoring
  - groovy
  - test
banner: 
cssclasses: 
description: 파일마다 복제되고 stale 버전으로 갈라지던 Jenkinsfile을, 버전 핀한 공유 라이브러리로 뽑아내고 얇게 다시 쓴 기록.
permalink: 
aliases: 
completed: true
type:
  - improvement
---

## 요약

> [!SUMMARY]
> 5개 Jenkinsfile이 파일당 수백 줄로 불어나고 핵심 클래스가 여러 파일에 복제되면서, 그중 하나가 stale 버전으로 남아 test/prod drift가 이미 진행 중이었다. 공통 로직을 태그로 핀한 공유 라이브러리로 추출해 Jenkinsfile을 얇게 다시 쓰고, 단위테스트·섀도우 diff·self-heal을 얹은 뒤 기존 잡을 건드리지 않고 무중단으로 컷오버했다.

## 1. 왜 손대야 했나

CI/CD 파이프라인은 "일단 돌아가니까" 미루기 딱 좋은 종류의 코드다. 우리도 그랬다. Jenkins를 몇 번 옮기면서 "1 파일에 모든 로직을 담는" self-contained 방식을 택했고, 이전엔 그게 민첩했다. 문제는 그게 계속 쌓였다는 점이다.

진단부터 정량으로 박아뒀다. 5개 Jenkinsfile이 <b>약 4,100줄, 상당 부분이 파일 간 중복</b>이었다. 공유 라이브러리는 0개, 전부 Jenkins UI에 붙은 인라인 스크립트. 중복 자체보다 무서운 건 그 중복이 이미 <b>갈라지기(drift)</b> 시작했다는 사실이었다.

- 모듈 정의를 담는 `ModuleConfig` 클래스가 여러 파일에 각각 선언돼 있었다. `getSafeName()` 같은 메서드는 byte 단위로 동일한데, 필드는 이미 발산한 상태였다. 특히 테스트용 파이프라인 하나는 `extraBuildArgs`·`imageTagOverride` 필드가 빠진 <b>stale 버전</b>이었다. 즉 test 파이프라인과 prod 파이프라인이 다른 모듈 모델을 쓰고 있었다는 뜻이다.
- 모듈 카탈로그 로더 약 150줄이 near-verbatim으로 복제돼 있었고, 그 테스트 파이프라인은 아예 모듈 목록을 코드에 하드코딩해 놓아 카탈로그 원본(`modules.yaml`)과 어긋나는 게 보장돼 있었다.
- 병렬 빌드 엔진이 파일마다 미묘하게 다른 3가지 구현으로 갈라져 있었고, Docker Hub 로그인/로그아웃 보일러플레이트는 네 번 반복됐다.

여기에 리팩토링하며 같이 청산할 보안 부채도 눈에 띄었다. 배포 파이프라인 한 곳에 <b>외부 벡터 DB 클러스터 API 자격증명이 base64 리터럴 필드로 코드에 박혀</b> 있었고, 여러 `sh` 호출이 셸 문자열에 변수를 직접 보간해 injection surface를 만들고 있었다. (자세한 값은 당연히 여기 옮기지 않는다.)

멀티브랜치 watch 같은 기능을 하나 더 얹기 전에 토대부터 다시 깔아야 했다. 기능을 얹기 전에 <b>파이프라인을 유지보수·검증하는 방법론을 먼저 정립</b>하는 게 이 작업의 목표였다.

## 2. 공통 로직을 라이브러리로 추출

방향은 단순하다. 로직을 `src/` 클래스로 옮기고, Jenkinsfile은 그걸 호출만 하는 껍데기로 만든다. Jenkins의 <b>Global Shared Library</b>는 repo 루트에 `vars/`·`src/`·`resources/` 세 디렉토리를 기대한다.

- `src/` — 재사용 Groovy 클래스. 순수 로직이라 JVM에서 단위테스트하기 좋다.
- `vars/<name>.groovy` — 한 파일이 한 스텝. `call()` 메서드를 정의하면 Declarative 파이프라인에서 그 이름 그대로 호출된다.
- `resources/` — Groovy가 아닌 자산(환경별 config 등).

추출 순서는 중복과 위험이 큰 것부터 잡았다. 모듈 카탈로그와 `ModuleConfig`를 먼저, 그다음 커밋 태그 규칙, Docker Hub 로그인, 이미지 존재 확인, 재시도 루프 순이었다. 예를 들어 파일마다 복제돼 있던 `ModuleConfig`는 라이브러리의 클래스 하나로 합쳤다. 아래는 그 핵심 부분이다. (`@NonCPS`는 이 메서드를 Jenkins의 CPS 변환 밖에서 평범한 Groovy로 실행하라는 표시로, 순수 계산에 붙인다.)

```groovy
// src/com/example/pipeline/ModuleConfig.groovy — 여러 파일에 복제돼 있던 모듈 모델을 한 곳으로.
class ModuleConfig implements Serializable {
    String name
    String imageName
    String imageTagOverride   // stale fork에는 이 필드가 빠져 있었다 → drift의 원흉
    Map    extraBuildArgs = [:]
    String type

    @NonCPS String getSafeName() { return name.replaceAll('[^a-zA-Z0-9_-]', '_') }
    @NonCPS boolean isCore()     { return this.type == 'CORE' }

    // mod-{commit} 태그 규칙. 버전 오버라이드가 있으면 mod-{override}-{commit}.
    @NonCPS String commitTag() {
        if (imageTagOverride) { return "mod-${imageTagOverride}-${specificCommitHash}" }
        return "mod-${specificCommitHash}"
    }
}
```

카탈로그 로더도 마찬가지로 `ModuleCatalog.expand()` 하나로 합쳤다. YAML 하나를 읽어 core/service/버전드 모듈을 펼쳐 `ModuleConfig` 리스트로 돌려준다. 이제 카탈로그를 읽는 코드가 세상에 딱 하나만 존재한다는 게 요점이다.

> [!NOTE]
> Groovy는 접착제로만 쓴다. 실제 작업(빌드·푸시·git)은 `sh` 스텝이나 에이전트에서 돌리고, 라이브러리 클래스는 "무엇을 할지 계획"만 만든다. 컨트롤러 메모리를 지키기 위해서이기도 하고, 부수효과 없는 계획 함수는 그대로 단위테스트 대상이 되기 때문이기도 하다.

## 3. 얇은 Jenkinsfile과 태그 핀

Jenkinsfile 맨 위 한 줄이 이 리팩토링의 상징이다.

```groovy
// 라이브러리를 released 태그로 고정해서 로드한다. 브랜치가 아니라 불변 태그다.
@Library('pipeline-lib@vX.Y.Z') _
import com.example.pipeline.ModuleConfig
import com.example.pipeline.ModuleCatalog
```

버전 핀 정책은 <b>released 태그 단일 핀 + 카나리</b>로 정했다. 산출물을 만드는 실제 잡은 절대 브랜치(float)를 따라가지 않는다. 라이브러리를 바꿀 땐 브랜치에서 개발 → 단위테스트 → 카나리 잡 1개로 검증 → 태그 컷, 이 순서를 거친다. float은 카나리 잡 전용이다.

핀을 태그로 두면 좋은 점이 하나 더 있다. 우리가 self-contained 방식을 택했던 이유가 "Jenkins를 자주 옮긴다"는 우려였는데, 실제로 서버를 통째 교체하는 일은 드물었다. 그리고 잡이 불변 태그를 가리키고 있으면 마이그레이션 시 재현성은 태그가 보장한다. self-contained가 지켜주던 걸 태그 핀이 더 싸게 지켜주는 셈이다.

이제 파이프라인 스테이지는 라이브러리 호출의 나열이 된다. 예를 들어 빌드 계획 단계는 이렇게 얇아진다.

```groovy
// 카탈로그 로드 → diff로 변경 모듈 탐지 → 빌드 대상 선정. 로직은 전부 라이브러리에 있다.
def allModules   = moduleCatalog(registryDomain)
def changedFiles = sh(script: "git diff --name-only ${baseCommit} HEAD", returnStdout: true)
                     .trim().split('\n').findAll { it }
def detected     = ChangeDetector.mapFilesToModules(changedFiles, allModules)
def targets      = BuildPlanner.selectTargetModules(
                       allModules, selectedModules, forceAll, fromCommit, baseCommit, detected)
```

## 4. 단위테스트로 로직 박제와 drift 제거

바꾸기 전에 먼저 한 건 <b>현재 동작을 박제</b>하는 일이었다. 지금 이 코드가 무슨 결정을 내리는지부터 테스트로 고정했다.

테스트는 <b>JenkinsPipelineUnit</b>으로 짰다. Java 21 / Groovy 3 환경에서 Jenkins 서버 없이 파이프라인 코드를 JVM에서 돌려보는 도구다. `src/` 클래스는 순수 Spock 테스트로, `vars/` 스텝은 `sh`·`checkout` 같은 스텝을 fake로 등록(`registerAllowedMethod`)해 호출 흐름을 검증한다. 빌드 대상 선정 로직이라면 이런 식이다.

```groovy
// BuildPlannerSpec — 빌드 대상 선정 규칙을 입력 매트릭스로 못박는다.
def "force-build-all이면 모든 모듈을 대상으로 한다"() {
    given: def all = [mod('chat-api'), mod('data-api')]
    expect:
    BuildPlanner.selectTargetModules(all, [], true, false, 'base123', [mod('chat-api')])*.name ==
        ['chat-api', 'data-api']
}

def "선택한 모듈이 카탈로그에 없으면 예외를 던진다"() {
    when:  BuildPlanner.selectTargetModules([mod('chat-api')], ['chat-api', 'nope'], false, false, 'base123', [])
    then:  def e = thrown(IllegalArgumentException); e.message.contains('nope')
}
```

여기서 drift 제거 메커니즘이 들어온다. 테스트는 로직을 복붙하지 않고 <b>실제 라이브러리 코드를 그대로 로드</b>한다. 테스트와 prod가 같은 라이브러리 버전을 적재하므로, test/prod가 갈라졌던 그 drift가 구조적으로 불가능해진다. stale fork였던 테스트 파이프라인은 단위테스트가 그 역할을 대체하므로 그대로 폐기했다.

CI는 단순하다. GitHub Actions에서 Java 21을 세팅하고 `./gradlew check` 한 줄로 전체 스펙을 돌린다.

> [!IMPORTANT]
> 녹색 단위테스트를 prod 증명으로 과신하면 안 된다. mock한 `sh`·`git`·`skopeo` 출력은 실제 CLI와 갈라질 수 있고, 샌드박스/CPS 버그는 서버에서만 난다. 단위테스트는 폭이 아니라 정밀함을 담당한다. 최종 확인 루프는 아래의 섀도우 런이 맡는다.

## 5. DRY_RUN 섀도우 런

리팩토링이 "동작을 안 바꿨다"는 걸 어떻게 증명할까. 단위테스트는 정밀함을 담당하지만 전체 파이프라인의 산출물이 같은지는 못 본다. 실제 커밋으로 v1과 v2를 나란히 돌려 <b>계획 산출물이 완전히 같은지</b> 확인하는 장치가 필요했다.

그래서 빌드 파이프라인에 `DRY_RUN`(plan-only) 파라미터를 넣었다. 켜면 변경 감지와 `docker-bake.json` 생성·아카이브까지만 하고, 실제 `bake --push`는 건너뛴다. 이미지를 하나도 발행하지 않으므로 old 잡과 new 잡을 같은 커밋에 대해 안전하게 돌려볼 수 있다.

```groovy
// 계획(docker-bake.json)은 항상 아티팩트로 남긴다. v1↔v2를 이 파일로 diff 한다.
writeJSON file: 'docker-bake.json', json: bakeConfig, pretty: 4
archiveArtifacts artifacts: 'docker-bake.json', fingerprint: true, onlyIfSuccessful: false

if (params.DRY_RUN) {
    echo ">>> [Build] DRY_RUN=true: 계획만 생성/아카이브하고 push는 건너뜁니다 (${actualBuildTargets.size()} target)."
    return actualBuildTargets   // bake --push 하지 않고 반환
}
```

양쪽이 아카이브한 `docker-bake.json`을 받아 diff가 0이면, 빌드 대상 모듈·이미지 태그·registry 타깃 결정이 완전히 동일하다는 뜻이다. 배포 파이프라인에도 같은 `DRY_RUN`을 넣어, "이 상황이면 어떤 릴리스 파일을 커밋하고 어떤 PR을 열지"를 실제로 실행하지 않고 로그로만 뱉게 했다. 이중 발행 없이 결정만 비교하는 것이다.

## 6. 이미지 self-heal

배포 잡의 오래된 골칫거리는 "배포하려는 커밋의 이미지가 레지스트리에 아직 없는" 경우였다. 예전엔 그냥 실패했다. v2에선 <b>없으면 빌드 잡을 자동으로 트리거하고 기다린 뒤 재검증</b>하도록 만들었다.

"없음"과 "확인 불가"를 구분하는 게 여기서 관건이다. Docker Hub는 rate-limit(429)이나 auth(401)로도 조회에 실패하는데, 이걸 "이미지 없음"으로 오해하면 멀쩡한 이미지를 다시 빌드하거나 배포를 잘못 막게 된다. 그래서 존재 확인 스텝은 응답을 세 갈래로 분류한다. `not found`/`manifest unknown` 류면 <b>확실히 없음(false)</b>, 조회 성공이면 있음(true), 그 외(rate-limit·auth·타임아웃)는 <b>확인 불가(indeterminate)</b>로 보고 백오프 후 재시도한다.

이 분류 위에서 배포 잡의 self-heal 흐름은 이렇게 돈다.

```groovy
// 1차 검증에서 indeterminate가 나오면 그것만 60초 뒤 재확인(일시적 Docker Hub blip 흡수).
// 그래도 정말 없는 이미지가 있으면 빌드 잡을 트리거해 채운 뒤, 없던 것만 다시 검증한다.
if (missing) {
    build job: env.BUILD_JOB_NAME, wait: true, parameters: [       // 예: App-Build-v2
        string(name: 'BRANCH_NAME', value: selectedBranch),
        booleanParam(name: 'FORCE_BUILD_ALL_MODULES', value: true),        // 전 모듈 고려하되
        booleanParam(name: 'SKIP_BUILD_IF_COMMIT_TAG_EXISTS', value: true) // 이미 있는 건 skip
    ]
    def after = classifyImages(missing)          // 없던 것만 재검증 (전체 아님)
    if (after.missing) { failMissingImages(after.missing) }
}
```

`FORCE_BUILD_ALL_MODULES=true` + `SKIP_BUILD_IF_COMMIT_TAG_EXISTS=true` 조합이 예쁘다. 트리거 원인과 무관하게 "모든 모듈을 후보로 두되 이미 있는 이미지는 건너뛴다"가 되어, 순효과는 <b>없는 커밋 태그 이미지만 딱 빌드</b>하는 것이다. 그리고 이 self-heal도 `DRY_RUN`일 땐 실제 트리거 대신 "이런 파라미터로 트리거했을 것"이라고 로그만 남긴다.

## 7. 기존 잡을 건드리지 않는 무중단 컷오버

전환하는 순간이 가장 조심스러웠다. 그래서 <b>기존 잡은 무수정으로 계속 운영하면서 라이브러리 기반 새 잡을 나란히 세우는</b> 방식(잡 레벨 strangler-fig)을 택했다.

1. 기존 `App-Build` 옆에 `App-Build-v2`를 새로 만든다. 새 잡만 라이브러리를 로드/핀한다.
2. 같은 커밋에서 `DRY_RUN`으로 old와 new를 돌려 계획 산출물 diff가 0인지 확인한다.
3. 검증되면 트리거(webhook/poll/upstream)를 new로 옮기고 old는 비활성. 문제가 생기면 트리거를 old로 되돌리면 즉시 롤백이다.
4. 합의 기간 동안 new가 무결하면 old 경로와 전환 플래그를 회수한다.

이 방식으로 기존 운영에 영향을 주지 않고 단계 전환을 했다. 골든마스터(폭), 단위테스트(정밀), 실커밋 섀도우 diff(현실) 세 가지 검증 위에서, 롤백은 트리거를 한 번 되돌리는 것으로 끝난다.

## 8. 마무리

이 토대가 깔리고 나니 원래 얹고 싶었던 멀티브랜치 watch 같은 기능은 `vars/` 스텝 하나 추가로 끝나는 일이 됐다. 카탈로그·빌드 플래너·PR 발행이 라이브러리 한 곳에 모여 있기 때문이다. 기능을 급하게 얹지 않고 방법론부터 세운 판단이 여기서 이자를 돌려줬다.

한 가지 덧붙이면, 이런 리팩토링은 "성능이 몇 배 좋아졌다" 같은 극적인 수치로 자랑하기 어렵다. 얻은 건 대체로 안 보이는 것 — 갈라질 수 없게 된 구조, 바꿔도 회귀를 잡아주는 테스트, 되돌릴 수 있는 전환이다.

## 참고

- [Jenkins — Shared Libraries](https://www.jenkins.io/doc/book/pipeline/shared-libraries/)
- [Jenkins — Pipeline Best Practices](https://www.jenkins.io/doc/book/pipeline/pipeline-best-practices/)
- [JenkinsPipelineUnit](https://github.com/jenkinsci/JenkinsPipelineUnit)
