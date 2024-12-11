---
title: "[MariaDB] 데드락 로그 확인 방법"
date: 2024-09-27
draft: false
tags:
  - mariadb
banner: 
cssclasses: 
description: 
permalink: 
aliases: 
completed:
---

## 📝 요약
> [!summary]
> - `SHOW ENGINE INNODB STATUS`
> - `set GLOBAL innodb_print_all_deadlocks =  ON`

## ⚙️ 환경
- mariadb 10.8.3
## 💬 이슈
데드락이 발생했을 때 mariadb 내부의 데드락 로그를 파악하는 방법이 필요했다.

## 🧗 해결
### 방법 1. `SHOW ENGINE INNODB STATUS` 쿼리
`SHOW ENGINE INNODB STATUS` 쿼리 결과 중 'LATEST DETECTED DEADLOCK' 데이터를 확인하면 가장 최근에 발생한 데드락 정보를 확인할 수 있다. 마지막 1개 데드락 로그만 표시하기 때문에 연쇄적으로 데드락이 발생할 경우에는 확인이 어려운 문제가 있다.

### 방법 2.  my.cnf 설정 추가
아래 설정을 추가 후 mariadb를 재기동하면 이후 발생하는 모든 deadlock 로그를 mysql_error.log 파일에서 확인할 수 있다.  
```config
[mysqld]
# 모든 데드락 로그를 저장
innodb_print_all_deadlocks = 1
```


## 🚀 참고
- [https://dev.mysql.com/doc/refman/8.4/en/innodb-parameters.html#sysvar_innodb_print_all_deadlocks](https://dev.mysql.com/doc/refman/8.4/en/innodb-parameters.html#sysvar_innodb_print_all_deadlocks)
