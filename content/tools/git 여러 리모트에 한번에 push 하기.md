---
title: git 여러 리모트에 한번에 push 하기
date: 2023-02-07
draft: false
tags:
  - git
banner: 
cssclasses: 
description: 
permalink: 
aliases: 
completed:
---
## 요약

```bash
## 설정
remote_1=example.com/project.git
remote_2=example2.com/project.git
remote_3=example3.com/project.git

git remote add all "${remote_1}"
git remote set-url --add all "${remote_2}"
git remote set-url --add all "${remote_3}"


## 사용
git push all # [--all] <-- 요건 모든 브랜치를 push 하려할 때만
```

## 이슈

git 을 사용하다보니 리모트 저장소를 여러개 두는 경우가 발생했다. 그러다보니 로컬에서 소스코드가 변경되면 여러 곳의 리모트에 각각 push 를 해줘야했고 이걸 한 번에 해줄 수 있는 방법이 있을까 찾아봤다.

  

## 해결

‘all’ 이라는 remote 를 등록하고 `set-url --add` 로 여러개의 리모트를 등록하는 방법을 찾게 되었다.

```bash
## 리모트 저장소 리스트 (https of ssh 경로)
remote_1=example.com/project.git # 메인 저장소 (fetch 도 포함)
remote_2=example2.com/project.git
remote_3=example3.com/project.git

git remote add all "${remote_1}"
git remote set-url --add all "${remote_2}"
git remote set-url --add all "${remote_3}"
```

  

`git remote -v` 명령어로 정상적으로 등록이 되었는지 확인한다.

  

```bash
$ git remote -v
all	example.com/project.git (fetch)
all	example.com/project.git (push)
all	example2.com/project.git (push)
all	example3.com/project.git (push)
...
```

  

이후에 `git push all` 명령어를 통해서 모든 리모트 저장소에 일괄로 push 가 가능하다. 모든 브랜치를 한번에 push 하려면 `--all` 옵션을 추가로 입력하면 된다.

  

이 설정은 `.git/config` 파일에서 직접 수정도 가능하다.

```bash
...
[remote "all"]
	url = example.com/project.git
	fetch = +refs/heads/*:refs/remotes/all/*
	pushurl = example.com/project.git
	pushurl = example2.com/project.git
	pushurl = example3.com/project.git
...
```

  

## 참고

- [https://stackoverflow.com/questions/5785549/able-to-push-to-all-git-remotes-with-the-one-command](https://stackoverflow.com/questions/5785549/able-to-push-to-all-git-remotes-with-the-one-command)