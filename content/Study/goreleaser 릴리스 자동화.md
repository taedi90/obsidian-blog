---
title: goreleaser 릴리스 자동화
date: 2026-02-12
draft: false
tags:
  - release
  - goreleaser
  - homebrew
  - deck
banner: 
cssclasses: 
description: 다른 오픈소스는 릴리스를 어떻게 하나 뜯어보고, 그걸 벤치해서 goreleaser로 멀티플랫폼 바이너리·deb/rpm·Homebrew tap·체인지로그까지 태그 하나에 묶은 릴리스 파이프라인을 직접 설계한 기록.
permalink: 
aliases: 
completed: true
featured: true
type:
  - note
---

## 요약

> [!SUMMARY]
> [[폐쇄망 전용 싱글 바이너리 워크플로우 도구 Deck 만들기|Deck]]을 남에게 배포할 단계가 되자 릴리스 절차가 필요해졌는데, 제대로 설계해 본 적이 없었다. 그래서 다른 오픈소스 프로젝트(`gh`·`helm`·`k9s`·`trivy`)가 어떻게 릴리스하는지부터 분석하고, 공통 패턴을 [goreleaser](https://goreleaser.com/)로 옮겼다. 태그 하나를 push하면 멀티플랫폼 바이너리와 `deb`/`rpm`, Homebrew tap 자동 갱신, 체인지로그가 한 번에 산출된다.

릴리스를 "빌드해서 zip 파일 하나 올리기" 정도로 알고 있었던 인식이, 다른 프로젝트의 사례를 살펴본 뒤에 완전히 바뀌었다.

## 1. 남들은 어떻게 릴리스하나 (벤치)

유명한 Go CLI들의 릴리스 절차를 살펴보니 훨씬 체계적이었다. `gh`, `helm`, `k9s`, `trivy` 같은 사례를 보면서 공통점을 추렸다.

- OS·아키텍처 조합별 바이너리를 다 만든다. linux/darwin × amd64/arm64는 기본이다.
- 바이너리에 버전·커밋·빌드 시각이 기록되어 있다. `deck version` 출력이 단순히 "dev"가 아니라 정확한 태그와 커밋 정보를 반환한다.
- 설치 경로가 여러 개다. tar.gz 아카이브 직접 다운로드, `apt`/`yum`용 `deb`/`rpm`, 그리고 macOS용 `brew install`이 있다.
- 체인지로그가 커밋에서 자동 생성된다. 사람이 릴리스노트를 처음부터 작성하는 것이 아니라, 커밋 메시지가 분류되어 올라간다.
- 이 전부가 태그를 밀면 자동으로 굴러간다. 사람이 손으로 zip을 올리지 않는다.

Go 생태계에서는 이 작업을 대부분 goreleaser로 처리한다는 사실도 이때 알았다. 도구는 goreleaser로 정하고, "무엇을 릴리스할지"만 내가 설계하기로 했다.

## 2. 멀티플랫폼 바이너리와 버전 주입

`.goreleaser.yaml`의 `builds` 항목이 크로스컴파일을 담당한다. Go는 `GOOS`/`GOARCH` 값만 바꾸면 크로스컴파일이 되므로, 조합을 나열하면 goreleaser가 한 번에 모두 빌드한다.

```yaml
builds:
  - env: [CGO_ENABLED=0]        # 정적 바이너리 — 폐쇄망 타깃에 의존성 없이 떨군다
    goos: [linux, darwin]
    goarch: [amd64, arm64]
    ldflags:
      - -s -w
      - -X .../buildinfo.Version={{ .Version }}
      - -X .../buildinfo.Commit={{ .Commit }}
      - -X .../buildinfo.Date={{ .Date }}
```

`CGO_ENABLED=0`으로 정적 바이너리를 생성하는 것이 폐쇄망용 도구에는 특히 중요했다. 대상 서버의 glibc 버전과 무관하게 바이너리를 배치하기만 하면 동작한다. `ldflags`의 `-X` 플래그로 버전·커밋·빌드 시각을 코드 변수에 주입하므로, 릴리스 바이너리가 자신의 출처를 정확히 알 수 있다.

## 3. 설치 경로를 여러 개 열기

<b>tar.gz(archives).</b> 각 플랫폼 바이너리를 tar.gz 형식으로 묶는다. 이때 `LICENSE`, `README`, `docs/`까지 아카이브에 포함해서, 폐쇄망에서 받은 압축만 풀어도 문서가 함께 있도록 했다.

<b>deb/rpm(nfpms).</b> goreleaser의 `nfpms` 기능이 같은 바이너리를 `.deb`/`.rpm` 패키지로도 만든다. `apt`/`yum` 절차에 익숙한 서버에 그대로 설치할 수 있다.

<b>Homebrew tap(brews).</b> macOS 사용자를 위해 `brew install` 경로를 열었다. `brews` 설정이 릴리스 때마다 Homebrew formula를 자동 생성해서 별도 tap 리포지터리에 커밋한다.

```yaml
brews:
  - name: deck
    repository:               # formula 를 올릴 tap 리포
      owner: Airgap-Castaways
      name: homebrew-tap
      token: "{{ .Env.HOMEBREW_TAP_GITHUB_TOKEN }}"
    commit_msg_template: "brew: update deck formula to {{ .Tag }}"
    test: |
      system "#{bin}/deck", "version"
    install: |
      bin.install "deck"
```

tap이라는 개념이 처음엔 낯설었지만, 알고 보면 단순하다. `homebrew-tap`은 formula 파일만 모아 둔 별도 GitHub 리포지터리고, 사용자가 `brew tap <owner>/tap` 명령을 한 번 실행하면 그 리포지터리의 formula를 `brew install`로 사용할 수 있다. goreleaser는 새 버전이 나올 때마다 그 리포지터리에 "formula를 이 태그로 올려라"라는 커밋을 대신 push해 준다. 사용자는 `brew upgrade` 명령만 실행하면 최신 버전이 된다. tap 리포지터리에 대한 쓰기 권한이 필요하므로 별도 토큰(`HOMEBREW_TAP_GITHUB_TOKEN`)을 넘겨야 한다.

## 4. 체인지로그를 커밋에서 자동 생성

릴리스노트를 매번 손으로 작성하는 일은 피하고 싶었다. goreleaser의 `changelog` 기능이 커밋 메시지를 규칙(Conventional Commits)에 따라 분류해서 그룹으로 묶어 준다.

```yaml
changelog:
  groups:
    - title: Features         # ^feat
      regexp: '^feat'
    - title: Bug Fixes        # ^fix
      regexp: '^fix'
    - title: Maintenance      # refactor/chore/docs/test
      regexp: '^(refactor|chore|docs|test)'
    - title: Other
```

부수 효과가 좋았다. 커밋 메시지를 자연스럽게 `feat:`/`fix:` 규칙으로 작성하게 된다. 규칙을 지키지 않으면 "Other" 그룹으로 분류되기 때문이다. 릴리스 헤더에는 하이라이트를 환경변수(`DECK_RELEASE_HIGHLIGHTS`)로 삽입해서, 자동 분류 결과 위에 사람이 한 줄 요약을 얹을 여지도 남겼다.

## 5. 태그 하나로 굴러가게

마지막은 전체 절차를 "태그를 push하면 끝난다"는 원칙으로 묶는 것이다. `v*` 패턴의 태그가 push되면 릴리스 워크플로우가 실행된다.

- 먼저 스모크 테스트를 수행한다. `make test`/`make lint`로 기본 검사를 확인하고, `release-check`로 goreleaser 설정의 유효성을 검증하며, `release-snapshot`으로 실제 릴리스 없이 산출물이 올바르게 나오는지 미리 만들어 본다. 이 과정에서 tar.gz를 풀어 바이너리가 실행되는지와 `deb` 패키지가 설치되는지까지 확인한다.
- 검사를 통과하면 goreleaser가 실제 릴리스를 생성한다. 바이너리와 패키지를 GitHub Releases에 업로드하고, 체인지로그를 붙이며, brew formula를 tap 리포지터리에 커밋한다. prerelease 여부는 태그 형태(`-rc` 등)로 자동 판별하고, 같은 태그의 재실행은 기존 릴리스를 교체(`mode: replace`)하도록 설정했다.

이제 릴리스 때 내가 하는 일은 태그 하나를 push하는 것뿐이다. 손으로 zip 파일을 올리는 릴리스 방식은 한 번 정도는 견디지만 반복하면 실수가 쌓인다는 사실을, 다른 프로젝트를 벤치마킹해서 직접 구현해 보고 납득했다.

## 참고

- [[폐쇄망 전용 싱글 바이너리 워크플로우 도구 Deck 만들기]]
- [[GitHub Actions 입문기]]
- [GoReleaser](https://goreleaser.com/)
- [Homebrew — Taps](https://docs.brew.sh/Taps)
- [Conventional Commits](https://www.conventionalcommits.org/)
