---
title: linux 특정 소유자 폴더 찾기
date: 2022-12-19
draft: false
tags: 
banner: 
cssclasses: 
description: find 명령어를 사용해 특정 user 와 group  소유의 파일을 찾는 방법을 알아본다.
permalink: 
aliases: 
completed:
---
## 요약

> find / -user [사용자] -type d

## 이슈

도커 이미지를 만드는 과정에서 특정 사용자 소유의 폴더를 찾아 권한을 변경해야하는 작업이 필요했다.

## 해결

```bash
# 루트 "/" 경로에서 "haproxy" 사용자 소유의 디렉토리 검색
find / -user haproxy -type d

# 소유자 변경
find / -user haproxy -exec chown new-user '{}' \;
```

## 참고

- [https://server-talk.tistory.com/20](https://server-talk.tistory.com/20)
- [https://stackoverflow.com/questions/22462124/find-command-in-bash-script-resulting-in-no-such-file-or-directory-error-only](https://stackoverflow.com/questions/22462124/find-command-in-bash-script-resulting-in-no-such-file-or-directory-error-only)