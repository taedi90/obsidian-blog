---
title: GitHub Actions 입문기
date: 2026-02-22
draft: false
tags:
  - github-actions
  - cicd
  - deck
banner: 
cssclasses: 
description: Jenkins·Drone CI·GitLab CI만 써오다 GitHub Actions를 처음 쓰면서 정리한 것들. 재사용 워크플로우(workflow_call), 매트릭스, make 기반 스텝, 태그 릴리스, Pages 배포까지 실제 여러 리포에 짠 구성을 종합했다.
permalink: 
aliases: 
completed: true
type:
  - note
---

## 요약

> [!SUMMARY]
> CI라면 Jenkins·Drone CI·GitLab CI만 써봤는데, [[폐쇄망 전용 싱글 바이너리 워크플로우 도구 Deck 만들기|Deck]]을 GitHub에서 하며 GitHub Actions를 처음 만졌다. 이후 사내 여러 리포 CI도 Actions로 옮기며 이벤트 트리거·job/step·재사용 워크플로우(`workflow_call`)·매트릭스·`make` 위임·릴리스/배포 트리거가 손에 익었다. 로직은 `make`로 밀어 로컬과 CI를 일치시키고, 공통 본체는 `workflow_call`로 한 번만, 보안 스캔은 상시 잡으로 둔 게 골자다.

Jenkins·GitLab CI에서 하던 걸 Actions 어휘로 다시 배우는 과정이었다.

## 1. 기존 CI와 다르게 느낀 점

먼저 감을 잡느라 알던 것과 대응부터 시켰다.

- GitLab CI는 리포 하나에 `.gitlab-ci.yml` 하나, `stages`로 순서를 잡는다. GitHub Actions는 `.github/workflows/` 아래 파일 여러 개를 두고 각각을 이벤트로 켠다.
- Jenkins는 서버(컨트롤러+에이전트)를 내가 세우고 관리해야 했다. Actions는 GitHub 호스티드 러너가 있어 `runs-on: ubuntu-latest`면 실행 환경이 그냥 주어진다. (self-hosted도 되지만, 관리 부담 없이 시작할 수 있는 게 컸다.)
- 제일 낯설었던 건 이벤트 기반이라는 점이다. "push되면", "PR 열리면", "태그 밀면", "매일 밤", "수동 버튼"이 각각 별도 트리거고, 하나의 워크플로우가 그중 무엇에 반응할지를 `on:`에 적는다.

```yaml
# 이벤트가 워크플로우를 켠다 — PR/브랜치별로 다른 파일을 둘 수 있다
on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:      # 손으로 실행하는 버튼
```

## 2. job과 step, 그리고 make로 몰기

워크플로우는 `jobs`로 나뉘고, 각 job은 격리된 러너에서 돈다. job 안은 `steps`의 나열이고, step은 액션(`uses:`)이나 셸 명령(`run:`)이다.

```yaml
jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5        # 리포 체크아웃 — 재사용 액션
      - uses: actions/setup-go@v5        # Go 설치
      - run: make build
      - run: make lint
      - run: make verify-generated       # 생성물(문서 등)이 최신인지
```

여기서 원칙을 하나 정했다. 실제 로직은 전부 `make`로 밀었다. `run:`에 긴 스크립트를 박지 않고 `make build`, `make lint`, `make vuln`처럼 부른다. CI YAML이 얇아져 읽기 쉽고, 같은 명령을 로컬에서도 그대로 돌릴 수 있어 "CI에서만 되고 내 노트북에선 안 되는" 상황이 준다. Jenkins Groovy에 로직을 몰아넣었다가 로컬 재현이 안 돼 고생했던 게 반면교사였다.

## 3. 재사용 워크플로우로 중복 없애기

Deck에는 트리거가 여럿이다. main push용(`ci-main.yml`), PR용(`ci-pr.yml`). 둘이 하는 일(빌드·린트·검증·보안)은 거의 같아서, 복붙하면 한쪽만 고치는 사고가 난다. 그래서 재사용 워크플로우(`workflow_call`)로 공통 본체를 빼고, 트리거 파일은 그걸 호출만 한다.

```yaml
# ci-reusable.yml — 공통 본체
on:
  workflow_call:            # 다른 워크플로우가 호출할 수 있게 노출
jobs:
  checks: { ... }           # build / lint / verify-generated
  security: { ... }         # make vuln

# ci-pr.yml — 트리거는 얇게, 본체는 호출
on: { pull_request: }
jobs:
  ci:
    uses: ./.github/workflows/ci-reusable.yml
```

GitLab CI의 `include:`/`extends:`로 하던 재사용을 Actions에선 `workflow_call`로 한다. 트리거별로 파일은 나뉘어도 진짜 CI 내용은 한 곳에만 있다.

## 4. 매트릭스와 보안 잡

<b>매트릭스.</b> 같은 job을 값만 바꿔 병렬로 돌린다. OS·버전 조합을 검증할 때 좋다.

```yaml
strategy:
  matrix:
    os: [ubuntu-latest, macos-latest]
runs-on: ${{ matrix.os }}
```

<b>보안 잡.</b> CI에 취약점 스캔을 상시 스텝으로 넣었다. Deck에선 `security` job이 `make vuln`(Go 코드·의존성 스캔)을 돌린다. 취약점 점검을 "가끔 수동으로"가 아니라 PR마다 자동으로 돌게 한 게 포인트다. (스캔 도구와 대응 방식은 [[govulncheck와 린트로 Go 프로젝트 기본기 잡기|따로]] 정리했다.)

## 5. 릴리스와 문서 배포 트리거

이벤트가 다양하다는 걸 제일 체감한 건 릴리스·배포였다.

- <b>릴리스(태그 트리거).</b> `on: push: tags: ['v*']`. `v1.2.3`을 밀면 릴리스 워크플로우가 돈다. 스모크 테스트 후 [[goreleaser 릴리스 자동화|goreleaser]]로 바이너리·패키지·brew formula를 낸다.
- <b>문서 배포(Pages).</b> `docs/`가 바뀌면 [[Docusaurus 도입기|Docusaurus]]를 빌드해 GitHub Pages로 배포한다. `permissions: pages: write`와 `concurrency`(진행 중 배포는 안 끊기게)를 처음 써봤다.
- <b>야간 e2e(스케줄).</b> `on: schedule:`로 매일 밤 종단 테스트를 돌려, 커밋이 없어도 회귀를 잡는다.

## 6. 여러 리포에 짜면서 종합한 것

Deck 말고도 사내 리포 CI를 Actions로 옮기면서 패턴이 굳었다(구체 내용은 사내라 생략).

- 제품 리포: 빌드·테스트 매트릭스 + 컨테이너 이미지 빌드·푸시.
- 차트 리포: 헬름 차트 lint·템플릿 렌더 검증 + 사용 이미지 취약점 스캔.
- 인프라 리포: [[Terraform으로 GPU VM 찍어내기|Terraform]] `fmt`/`validate`.

리포가 달라도 굳은 습관은 셋이었다. 로직은 `make`로 밀어 로컬과 CI를 일치시키고, 공통 본체는 `workflow_call`로 한 번만 쓰고, 보안 스캔은 상시 잡으로 파이프라인에 박는다. 결국 낯설었던 건 도구가 아니라 이벤트 기반·호스티드 러너·재사용 워크플로우라는 Actions 특유의 어휘였다.

## 참고

- [[폐쇄망 전용 싱글 바이너리 워크플로우 도구 Deck 만들기]]
- [[goreleaser 릴리스 자동화]]
- [[Docusaurus 도입기]]
- [GitHub Actions — Reusing workflows](https://docs.github.com/en/actions/using-workflows/reusing-workflows)
- [GitHub Actions — Events that trigger workflows](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows)
