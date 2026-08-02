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
> [[폐쇄망 전용 싱글 바이너리 워크플로우 도구 Deck 만들기|Deck]]을 남한테 나눠줄 단계가 되자 릴리스가 필요해졌는데, 제대로 설계해본 적이 없었다. 그래서 다른 오픈소스(`gh`·`helm`·`k9s`·`trivy`)가 어떻게 하나부터 뜯어보고, 공통 패턴을 [goreleaser](https://goreleaser.com/)로 옮겼다. 태그 하나를 밀면 멀티플랫폼 바이너리, `deb`/`rpm`, Homebrew tap 자동 갱신, 체인지로그가 한 번에 나온다.

릴리스를 "빌드해서 zip 하나 올리기"로 알던 게, 남들 걸 열어보고서 완전히 바뀌었다.

## 1. 남들은 어떻게 릴리스하나 (벤치)

유명한 Go CLI들을 열어보니 릴리스가 훨씬 촘촘했다. `gh`, `helm`, `k9s`, `trivy` 같은 걸 보면서 공통점을 추렸다.

- OS·아키텍처 조합별 바이너리를 다 만든다. linux/darwin × amd64/arm64는 기본이다.
- 바이너리에 버전·커밋·빌드시각이 박혀 있다. `deck version`이 그냥 "dev"가 아니라 정확한 태그·커밋을 뱉는다.
- 설치 경로가 여럿이다. tar.gz 직접 받기, `apt`/`yum`용 `deb`/`rpm`, macOS는 `brew install`.
- 체인지로그가 커밋에서 자동 생성된다. 사람이 릴리스노트를 처음부터 쓰는 게 아니라 커밋 메시지가 분류돼 올라온다.
- 이 전부가 태그를 밀면 자동으로 굴러간다. 사람이 손으로 zip을 올리지 않는다.

Go 진영에선 이걸 대부분 goreleaser로 한다는 것도 이때 알았다. 도구는 goreleaser로 정하고, "무엇을 낼지"만 내가 설계하기로 했다.

## 2. 멀티플랫폼 바이너리와 버전 주입

`.goreleaser.yaml`의 `builds`가 크로스컴파일을 맡는다. Go는 `GOOS`/`GOARCH`만 바꾸면 크로스컴파일이 되니, 조합을 나열하면 goreleaser가 한 번에 다 빌드한다.

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

`CGO_ENABLED=0`으로 정적 바이너리를 뽑는 게 폐쇄망 도구엔 특히 중요했다. 대상 서버 glibc 버전이 어떻든 그냥 떨구면 돈다. `ldflags`의 `-X`로 버전·커밋·빌드시각을 코드 변수에 주입해서, 릴리스 바이너리가 자기 출처를 정확히 안다.

## 3. 설치 경로를 여러 개 열기

<b>tar.gz(archives).</b> 각 플랫폼 바이너리를 tar.gz로 묶는다. 이때 `LICENSE`, `README`, `docs/`까지 아카이브에 넣어, 폐쇄망에서 받은 압축만 풀어도 문서가 같이 있게 했다.

<b>deb/rpm(nfpms).</b> goreleaser의 `nfpms`가 같은 바이너리를 `.deb`/`.rpm`으로도 패키징한다. `apt`/`yum` 흐름에 익숙한 서버에 그대로 넣을 수 있다.

<b>Homebrew tap(brews).</b> macOS 사용자를 위해 `brew install`을 열었다. `brews`가 릴리스 때마다 Homebrew formula를 자동 생성해 별도 tap 리포에 커밋한다.

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

tap이라는 게 처음엔 낯설었는데, 알고 보면 단순하다. `homebrew-tap`은 formula만 모아둔 별도 GitHub 리포고, 사용자가 `brew tap <owner>/tap` 한 번 하면 그 리포의 formula를 `brew install`로 쓸 수 있다. goreleaser는 새 버전이 나올 때마다 그 리포에 "formula를 이 태그로 올려라"라는 커밋을 대신 밀어준다. 사용자는 `brew upgrade`만 하면 최신이 된다. tap 리포에 쓸 권한이 필요하니 별도 토큰(`HOMEBREW_TAP_GITHUB_TOKEN`)을 넘긴다.

## 4. 체인지로그를 커밋에서 자동 생성

릴리스노트를 매번 손으로 쓰긴 싫었다. goreleaser의 `changelog`가 커밋 메시지를 규칙(Conventional Commits)으로 분류해 그룹으로 묶어준다.

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

부수효과가 좋았다. 커밋 메시지를 `feat:`/`fix:` 규칙으로 쓰게 된다. 안 그러면 "Other"에 처박히니까. 릴리스 헤더에는 하이라이트를 환경변수(`DECK_RELEASE_HIGHLIGHTS`)로 끼워 넣어, 자동 분류 위에 사람이 한 줄 요약을 얹을 여지도 남겼다.

## 5. 태그 하나로 굴러가게

마지막은 "태그를 밀면 다 된다"로 묶는 것이다. `v*` 태그가 push되면 릴리스 워크플로우가 돈다.

- 먼저 스모크 테스트. `make test`/`make lint`로 기본을 확인하고, `release-check`로 goreleaser 설정이 유효한지, `release-snapshot`으로 실제 릴리스 없이 산출물이 제대로 나오는지 미리 만들어본다. 이때 tar.gz를 풀어 바이너리가 실행되는지, `deb`가 설치되는지까지 확인한다.
- 통과하면 goreleaser가 실제 릴리스를 만든다. 바이너리·패키지를 GitHub Releases에 올리고, 체인지로그를 붙이고, brew formula를 tap에 커밋한다. prerelease는 태그 형태(`-rc` 등)로 자동 판별하고, 같은 태그 재실행은 기존 릴리스를 교체(`mode: replace`)하도록 뒀다.

이제 릴리스 때 내가 하는 건 태그 하나 미는 것뿐이다. 손으로 zip을 올리는 릴리스는 딱 한 번은 되지만 반복하면 실수가 쌓인다는 걸, 남들 걸 벤치해 직접 짜보고서 납득했다.

## 참고

- [[폐쇄망 전용 싱글 바이너리 워크플로우 도구 Deck 만들기]]
- [[GitHub Actions 입문기]]
- [GoReleaser](https://goreleaser.com/)
- [Homebrew — Taps](https://docs.brew.sh/Taps)
- [Conventional Commits](https://www.conventionalcommits.org/)
