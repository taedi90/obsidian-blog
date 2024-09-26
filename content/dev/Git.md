---
title: Git
date: 2024-09-05
draft: true
tags: 
banner: 
cssclasses: 
description: 
permalink: 
aliases: 
completed:
---
분산형 버전 관리 시스템(VCS)으로 중앙 집중형 형상 관리 도구와 흔히 비교된다. 오프라인 작업이 가능해 일시적인 서버 장애 등에도 개발을 계속할 수 있고, 서버의 데이터가 유실되어도 로컬 데이터로 복구할 수 있는 장점이 있다.

## 설치하기

---

```HTML
# 설치 여부 확인
git --version
# 설치
brew install git
```

  

## Terminal Cheat Sheet

---

- git 생성 및 삭제

```Bash
git init # git 생성 or 초기화
rm -rf .git # git 삭제
```

- clone

```Bash

# 서브모듈 포함
git clone --recurse-submodules https://github.com/taedi90/taedi90.github.io
```

- config

```Bash
git config --list # config 확인
git config --global -e # global config 수정
git config --global core.editor "code" \#--wait" # VSCode 기본 에디터로 지정
git config --global user.name "name" # 계정 이름
git config --global user.email "email@address" # 이메일 주소
```

- commit

```Bash
git add # [.],[*]
echo *.log > .ignore

git commit -m "commit_message" # 커밋하기

git diff # 커밋 간 변경사항 확인

git log
```

- etc

```Bash
git congfig --global alias.st status # 단축키 지정
```

  

전체 명령어는 아래 링크를 통해 확인이 가능하다.

> [!info] Reference  
> Quick reference guides: GitHub Cheat Sheet | Visual Git Cheat Sheet  
> [https://git-scm.com/docs](https://git-scm.com/docs)  

  

## GUI 클라이언트

---

다양한 종류의 GUI 클라이언트 중 Sourcetree 선택.

> [!info] GUI Clients  
> Git comes with built-in GUI tools for committing ( git-gui) and browsing ( gitk), but there are several third-party tools for users looking for platform-specific experience.  
> [https://git-scm.com/downloads/guis](https://git-scm.com/downloads/guis)  

  

## References

---

[https://umbum.dev/446](https://umbum.dev/446)

[https://djkeh.github.io/articles/How-to-write-a-git-commit-message-kor/](https://djkeh.github.io/articles/How-to-write-a-git-commit-message-kor/)

[gitignore.io](http://gitignore.io/)

  

  

[[Git Tutorial]]

  

  

git clone

히스토리와 저장소 모두를 복제한다.

  

스냅샷

  

체크인 체크아웃

  

  

  

  

# 1. 깃 설치

# 2. config 파일 수정

이름, 이메일, 기본 에디터 등

시스템 설정과 > 사용자 전역 설정 > 프로젝트별 설정

```PowerShell
# --system --global --local
$ git config --global user.name "John Doe"
$ git config --global user.email johndoe@example.com’
$ git config --global core.editor emacs’
```

  

# 3. git 저장소 만들기

1. 새로 만드는 방법
2. 다른 곳의 저장소를 clone 해오는 방법

```PowerShell
$ cd /Users/user/myProject #프로젝트로 사용 될 경로

$ git init #방법1. git 저장소 생성
$ git clone https://github.com/libgit2/libgit2 mylibgit #방법2. git 저장소 복제
```