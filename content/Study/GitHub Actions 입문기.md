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
> CI라면 Jenkins·Drone CI·GitLab CI만 사용해 봤지만, [[폐쇄망 전용 싱글 바이너리 워크플로우 도구 Deck 만들기|Deck]] 작업을 GitHub에서 진행하며 GitHub Actions를 처음 접했다. 이후 사내 여러 리포의 CI도 Actions로 옮기면서 이벤트 트리거와 job/step 구조, 재사용 워크플로우(`workflow_call`), 매트릭스, `make` 위임, 릴리스/배포 트리거가 손에 익었다. 실행 로직은 `make`로 위임해서 로컬과 CI를 일치시키고, 공통 본체는 `workflow_call`로 한 곳에만 두되, 보안 스캔은 상시 잡으로 유지한 것이 골자다.

Jenkins·GitLab CI에서 하던 방식을 Actions의 개념 체계로 다시 배우는 과정이었다.

## 1. 기존 CI와 다르게 느낀 점

먼저 감을 잡기 위해 알고 있던 기존 도구의 개념과 대응 관계부터 정리했다.

- GitLab CI는 리포 하나에 `.gitlab-ci.yml` 파일 하나를 두고 `stages`로 실행 순서를 잡는다. GitHub Actions는 `.github/workflows/` 아래에 파일 여러 개를 두고 각각을 이벤트로 활성화한다.
- Jenkins는 서버(컨트롤러와 에이전트)를 직접 세워서 관리해야 했다. Actions에는 GitHub 호스티드 러너가 있으므로 `runs-on: ubuntu-latest`만 지정하면 실행 환경이 그대로 주어진다. (self-hosted 러너도 사용할 수 있지만, 관리 부담 없이 시작할 수 있다는 점이 컸다.)
- 가장 낯설었던 점은 이벤트 기반이라는 것이다. "push되면", "PR이 열리면", "태그를 push하면", "매일 밤", "수동 버튼"이 각각 별도 트리거이며, 하나의 워크플로우가 그중 무엇에 반응할지를 `on:` 항목에 적는다.

```yaml
# 이벤트가 워크플로우를 켠다 — PR/브랜치별로 다른 파일을 둘 수 있다
on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:      # 손으로 실행하는 버튼
```

## 2. job과 step, 그리고 make로 몰기

워크플로우는 `jobs` 단위로 나뉘고, 각 job은 격리된 러너에서 실행된다. job 내부는 `steps`의 나열이며, step은 액션(`uses:`)이나 셸 명령(`run:`)이다.

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

여기서 원칙을 하나 정했다. 실제 로직은 전부 `make` 타깃으로 위임했다. `run:` 항목에 긴 스크립트를 넣지 않고 `make build`, `make lint`, `make vuln`처럼 호출한다. CI YAML이 얇아져 읽기 쉽고, 같은 명령을 로컬에서도 그대로 실행할 수 있으므로 "CI에서만 되고 내 노트북에서는 안 되는" 상황이 줄어든다. Jenkins Groovy에 로직을 몰아 넣었다가 로컬 재현이 안 되어 고생했던 경험이 반면교사였다.

## 3. 재사용 워크플로우로 중복 없애기

Deck에는 트리거가 여럿이다. main push용(`ci-main.yml`)과 PR용(`ci-pr.yml`)이 그것이다. 두 워크플로우가 수행하는 일(빌드·린트·검증·보안)은 거의 같아서, 복사해서 붙이면 한쪽만 수정하는 문제가 발생한다. 그래서 재사용 워크플로우(`workflow_call`)로 공통 본체를 분리하고, 트리거 파일은 그것을 호출하기만 한다.

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

GitLab CI에서 `include:`/`extends:`로 하던 재사용을 Actions에서는 `workflow_call`로 구현한다. 트리거별로 파일은 나뉘더라도 실질적인 CI 내용은 한 곳에만 존재한다.

## 4. 매트릭스와 보안 잡

<b>매트릭스.</b> 같은 job을 값만 바꾸어 병렬로 실행한다. OS·버전 조합을 검증할 때 유용하다.

```yaml
strategy:
  matrix:
    os: [ubuntu-latest, macos-latest]
runs-on: ${{ matrix.os }}
```

<b>보안 잡.</b> CI에 취약점 스캔을 상시 스텝으로 추가했다. Deck에서는 `security` job이 `make vuln`(Go 코드·의존성 스캔)을 실행한다. 취약점 점검을 "가끔 수동으로"가 아니라 PR마다 자동으로 실행하게 만든 것이 포인트다. (스캔 도구와 대응 방식은 [[govulncheck와 린트로 Go 프로젝트 기본기 잡기|따로]] 정리했다.)

## 5. 릴리스와 문서 배포 트리거

이벤트 종류가 다양하다는 것을 가장 체감한 영역은 릴리스와 배포였다.

- <b>릴리스(태그 트리거).</b> `on: push: tags: ['v*']` 형태로 설정한다. `v1.2.3` 태그를 push하면 릴리스 워크플로우가 실행된다. 스모크 테스트를 통과한 뒤 [[goreleaser 릴리스 자동화|goreleaser]]로 바이너리·패키지·brew formula를 산출한다.
- <b>문서 배포(Pages).</b> `docs/` 디렉터리가 바뀌면 [[Docusaurus 도입기|Docusaurus]]를 빌드해서 GitHub Pages로 배포한다. `permissions: pages: write` 권한 설정과 `concurrency`(진행 중인 배포를 중간에 중단하지 않도록 하는 옵션)를 처음 사용했다.
- <b>야간 e2e(스케줄).</b> `on: schedule:` 트리거로 매일 밤 종단 테스트를 실행해서, 커밋이 없는 날에도 회귀 문제를 잡아낸다.

## 6. 여러 리포에 짜면서 종합한 것

Deck 외에도 사내 리포의 CI를 Actions로 옮기면서 패턴이 굳어졌다(세부 내용은 사내 정보라 생략한다).

- 제품 리포: 빌드·테스트 매트릭스 + 컨테이너 이미지 빌드·푸시.
- 차트 리포: 헬름 차트 lint·템플릿 렌더 검증 + 사용 이미지 취약점 스캔.
- 인프라 리포: [[Terraform으로 GPU VM 찍어내기|Terraform]] `fmt`/`validate`.

리포가 달라도 굳어진 습관은 셋이었다. 로직은 `make`로 위임해서 로컬과 CI를 일치시키고, 공통 본체는 `workflow_call`로 한 번만 정의하며, 보안 스캔은 상시 잡으로 파이프라인에 포함시킨다. 결국 낯설었던 부분은 도구 자체가 아니라 이벤트 기반 모델·호스티드 러너·재사용 워크플로우라는 Actions 특유의 개념이었다.

## 참고

- [[폐쇄망 전용 싱글 바이너리 워크플로우 도구 Deck 만들기]]
- [[goreleaser 릴리스 자동화]]
- [[Docusaurus 도입기]]
- [GitHub Actions — Reusing workflows](https://docs.github.com/en/actions/using-workflows/reusing-workflows)
- [GitHub Actions — Events that trigger workflows](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows)
