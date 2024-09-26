---
title: git bad object 오류 해결하기
date: 2023-07-21
draft: true
tags:
  - git
banner: 
cssclasses: 
description: 
permalink: 
aliases: 
completed:
---
## 이슈

git 프로젝트에서 새로운 remote 를 추가하고 데이터를 pull 하는 도중 다음 오류가 발생했다.

> fatal: bad object refs/remotes/origin/main

어떠한 이유에선지 git 설정의 ref(Reference) 에서 origin/main 이 손상된 것으로 판단되었다.

  

## 해결

.git/refs/remotes/origin/main 파일을 백업하고, git gc 를 수행해준다. 정상적으로 동작하면 백업한 tmp 파일은 삭제하면 된다.

```bash
mv .git/refs/remotes/origin/main ./tmp
git gc
```

  

## 참고

- [https://stackoverflow.com/questions/37145151/how-to-handle-git-gc-fatal-bad-object-refs-remotes-origin-head-error](https://stackoverflow.com/questions/37145151/how-to-handle-git-gc-fatal-bad-object-refs-remotes-origin-head-error)