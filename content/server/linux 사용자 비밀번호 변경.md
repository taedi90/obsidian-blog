---
title: linux 사용자 비밀번호 변경
date: 2022-11-28
draft: false
tags: 
banner: 
cssclasses: 
description: 리눅스 사용자 비밀번호 변경 방법을 알아본다.
permalink: 
aliases: 
completed:
---
```bash
$ passwd
Changing password for [USER].
Current password:
New password:
Retype new password:
passwd: password updated successfully
```

  

쉘 스크립트 등 패스워드 입력이 불가한 경우

```bash
$ echo "[USER]:[PASSWORD]" | sudo chpasswd
```