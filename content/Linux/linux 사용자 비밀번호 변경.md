---
title: Linux 사용자 비밀번호 변경
date: 2022-11-28
draft: false
tags:
  - linux
banner: 
cssclasses: 
description: 리눅스 사용자 비밀번호 변경.
permalink: 
aliases: 
completed:
---
리눅스에서 사용자 비밀번호를 바꾸는 방법은 상황에 따라 두 가지다.

## 1. 대화형: passwd

직접 터미널에서 바꿀 때 쓰는 가장 기본적인 방법이다. 현재 비밀번호를 확인한 뒤 새 비밀번호를 두 번 입력하면 된다.

```bash
$ passwd
Changing password for [USER].
Current password:
New password:
Retype new password:
passwd: password updated successfully
```

## 2. 비대화형: chpasswd

쉘 스크립트나 프로비저닝처럼 프롬프트 입력이 불가능한 환경에서는 `chpasswd`를 쓴다. `사용자:비밀번호` 형식을 표준입력으로 넘기면 한 줄로 끝난다.

```bash
$ echo "[USER]:[PASSWORD]" | sudo chpasswd
```

> [!NOTE]
> 이 방식은 비밀번호가 셸 히스토리에 평문으로 남을 수 있다. 자동화 스크립트에서는 히스토리를 비활성화하거나 파일 입력(`chpasswd < file`)을 쓰는 편이 안전하다.