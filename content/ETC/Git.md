---
title: Git 기본 개념과 명령어
date: 2022-09-05
draft: true
tags:
  - git
  - vcs
  - devops
  - cli
banner: 
cssclasses: 
description: 분산 버전 관리 시스템(DVCS)인 Git의 핵심 개념을 이해하고, 저장소 생성부터 커밋, 원격 저장소 연동까지 가장 기본적인 작업 흐름과 필수 명령어 사용법을 정리한다.
permalink: 
aliases: 
completed: true
type:
  - note
---

## 1. 개요

<b>Git</b>은 소스 코드의 변경 이력을 관리하는 <b>분산 버전 관리 시스템(Distributed Version Control System, DVCS)</b>이다. 과거에 많이 사용되던 중앙 집중형 버전 관리 시스템(CVCS, 예: SVN)과 달리, Git은 모든 개발자가 자신만의 로컬 저장소(Local Repository)에서 전체 개발 이력을 포함한 완전한 복제본을 가지고 작업한다.

이러한 분산적인 특징 덕분에, 중앙 서버에 문제가 발생하거나 네트워크가 끊긴 오프라인 환경에서도 개발을 계속할 수 있다는 큰 장점이 있다. 또한, 각자의 로컬 저장소에서 자유롭게 브랜치를 만들고 실험적인 작업을 할 수 있어 현대 개발 환경의 필수 도구로 자리 잡았다.

이 문서는 Git 을 처음 접하는 사람들을 위해 Git 의 핵심 개념을 설명하고, 가장 기본적인 작업 흐름과 필수 명령어들을 소개하는 것을 목표로 한다.

## 2. Git 최초 설정

Git 을 설치한 후 가장 먼저 해야 할 일은 사용자 정보와 기본 설정을 등록하는 것이다. 이 정보는 커밋(Commit) 기록에 포함되어 누가 변경 사항을 만들었는지 식별하는 데 사용된다.

```bash
# Git 설정 목록 확인하기
git config --list

# 사용자 이름과 이메일 주소 설정 (전역 설정)
# --global 옵션은 현재 시스템의 모든 Git 저장소에 적용됨을 의미한다.
git config --global user.name "Your Name"
git config --global user.email "you@example.com"

# Git이 사용할 기본 텍스트 에디터 설정 (예: VS Code)
git config --global core.editor "code --wait"
```

설정은 `--system`, `--global`, `--local` 세 가지 수준으로 적용되며, `system → global → local` 순서로 우선순위를 가집니다. 즉, 특정 프로젝트에서만 다른 설정을 사용하고 싶다면 해당 프로젝트 폴더로 이동하여 `--local` 옵션으로 설정하면 된다. (기본값은 `--local`)

## 3. Git 저장소(Repository) 만들기

Git 으로 버전 관리를 시작하려면 먼저 Git 이 변경 이력을 추적하고 저장할 공간인 <b>저장소(Repository)</b>를 만들어야 한다. 방법은 두 가지가 있다.

### 3-1. 새로운 로컬 저장소 생성

버전 관리를 적용하고 싶은 프로젝트 폴더로 이동하여 `git init` 명령어를 실행한다. 이 명령은 해당 폴더 내에 숨김 폴더인 `.git` 디렉터리를 생성하며, 이 디렉터리에 Git 이 버전 관리에 필요한 모든 정보(메타데이터, 객체 데이터베이스 등)가 저장된다.

```bash
# 프로젝트 폴더로 이동
cd my-project

# 현재 디렉터리를 Git 저장소로 초기화
git init
```

### 3-2. 기존 원격 저장소 복제(Clone)

GitHub 와 같은 원격 서버에 이미 존재하는 프로젝트를 내 컴퓨터로 가져와 작업을 시작하는 방법이다. `git clone` 명령어는 원격 저장소의 전체 이력을 포함한 모든 데이터를 복제하여 로컬 저장소를 자동으로 생성한다.

```bash
# 원격 저장소를 'my-project' 라는 이름의 폴더에 복제
git clone https://github.com/example/remote-repo.git my-project
```

## 4. 기본 작업 흐름과 명령어

Git 의 기본적인 작업 흐름은 <b>수정(Modify) → 추가(Stage) → 저장(Commit)</b>의 3단계를 거칩니다. 이는 내 작업 공간(Working Directory)의 변경 사항을 Git 에 알려주고(Staging Area), 최종적으로 저장소에 하나의 버전(Commit)으로 기록하는 과정이다.

-   <b>Working Directory</b>: 실제 파일들이 있는 내 컴퓨터의 프로젝트 폴더
-   <b>Staging Area (Index)</b>: 커밋할 변경사항들을 임시로 모아두는 가상의 공간
-   <b>Repository (`.git` dir)</b>: 커밋된 버전들이 영구적으로 저장되는 공간

### 4-1. 상태 확인 (`git status`)

작업 디렉터리와 스테이징 영역의 현재 상태를 확인하는 가장 중요한 명령어이다. 어떤 파일이 수정되었는지, 어떤 파일이 스테이징되었는지 등을 보여줍니다.

```bash
# 현재 저장소의 상태를 확인
git status
```

### 4-2. 변경사항 추가 (`git add`)

작업 디렉터리에서 수정한 파일의 변경 사항을 커밋하기 위해 스테이징 영역으로 넘기는 명령어이다.

```bash
# 특정 파일 하나만 스테이징
git add main.js

# 현재 디렉터리의 모든 변경사항을 스테이징
git add .
```

### 4-3. 변경사항 저장 (`git commit`)

스테이징 영역에 있는 모든 변경 사항을 하나의 의미 있는 버전(스냅샷)으로 만들어 로컬 저장소에 영구적으로 저장한다. 커밋 시에는 `-m` 옵션을 사용하여 해당 버전에 어떤 변경 사항이 있었는지 설명하는 <b>커밋 메시지</b>를 반드시 작성해야 한다.

```bash
# 스테이징된 변경사항을 커밋 메시지와 함께 저장
git commit -m "Add user login feature"
```

> [!INFO]
> 좋은 커밋 메시지는 협업의 효율성을 크게 높이다. 일반적으로 커밋 메시지의 제목은 50자 이내의 명령문으로 작성하고, 본문에는 '무엇을'과 '왜' 변경했는지를 상세히 기술하는 것이 좋다.

### 4-4. 변경 이력 확인 (`git log`)

지금까지의 커밋 이력을 시간순으로 확인한다.

```bash
# 현재 브랜치의 커밋 이력을 조회
git log
```

### 4-5. 변경 내용 비교 (`git diff`)

저장소의 버전과 작업 디렉터리, 또는 스테이징 영역 간의 차이를 비교하여 보여줍니다.

```bash
# 작업 디렉터리와 스테이징 영역의 차이 확인
git diff

# 스테이징 영역과 마지막 커밋의 차이 확인
git diff --staged
```

## 5. GUI 클라이언트

터미널 환경이 익숙하지 않다면 Sourcetree, GitKraken 과 같은 GUI(Graphic User Interface) 클라이언트를 사용할 수도 있다. 이러한 도구들은 Git 의 복잡한 작업들을 시각적으로 표현해 주므로 브랜치의 흐름을 파악하거나 충돌을 해결할 때 도움이 될 수 있다.

## 6. 참고 자료
-   <b>Pro Git (한국어 번역)</b>: Git의 모든 것을 상세히 다루는 공식적인 책
    -   [https://git-scm.com/book/ko/v2](https://git-scm.com/book/ko/v2)
-   <b>좋은 git 커밋 메시지를 작성하기 위한 7가지 약속</b>: 협업을 위한 커밋 메시지 가이드
    -   [https://djkeh.github.io/articles/How-to-write-a-git-commit-message-kor/](https://djkeh.github.io/articles/How-to-write-a-git-commit-message-kor/)
-   <b>gitignore.io</b>: 프로젝트 유형에 맞는 `.gitignore` 파일을 쉽게 생성해주는 웹 서비스
    -   [https://www.toptal.com/developers/gitignore](https://www.toptal.com/developers/gitignore)
