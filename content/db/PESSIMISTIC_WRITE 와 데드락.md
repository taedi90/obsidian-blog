---
title: PESSIMISTIC_WRITE 와 데드락
date: 2024-09-04
draft: true
tags:
banner:
cssclasses:
description:
permalink:
aliases:
completed:
---
## 📝 요약
> [!summary]
> **REPEATABLE READ** 격리 수준에서는 비유니크 인덱스를 조건으로 **PESSIMISTIC_WRITE**를 사용하면 InnoDB에서 **레코드 락(Record Lock)**뿐만 아니라 **갭 락(Gap Lock)**도 수행될 수 있으며, 이러한 갭 락은 의도치 않은 데드락을 유발할 수 있다.
> 데드락을 피하기 위해서는 상황에 따라 아래 방법 등을 고민해볼 수 있다.
> - 비유니크 인덱스 조건을 **`WHERE PK IN (A, B)`**와 같이 기본 키(PK)를 이용한 조건으로 변경
> - 격리 수준을 **READ COMMITTED** 이하로 변경
> - 비관적 락이 아닌 낙관적 락으로 로직 변경 
> - 트랜젝션 오류 시 재시도 로직 추가

## ⚙️ 환경
- mariadb 10.8.3 (InnoDB)
- Spring boot 2.5.1
- JDK 1.8

## 💬 이슈
사내 솔루션의 비관적 락(PESSIMISTIC_WRITE) 을 사용하는 로직에 트랜젝션 간 경합이 발생할 경우 간헐적으로 deadlock 이 발생하는 이슈가 발생했다.  

```
Caused by: javax.persistence.OptimisticLockException: org.hibernate.exception.LockAcquisitionException: could not extract ResultSet
```

오류 시점의 서비스 로그를 파악해보니 특이점이 있었는데
- 일반적인 경합에서는 먼저 락을 획득한 트랜젝션이 종료되기 까지 `innodb_lock_wait_timeout` 설정 대로 50초간 대기 후 오류가 발생할 것으로 예상되지만, 문제 상황에서는 lock 획득 시도 후 1초 이내에 데드락 이슈 발생
- 오류 또한 OptimisticLockException 으로 lock 획득 불가 시 발생하는 PessimisticLockException 과 stackTrace 가 달랐음
이런 이유로 로직 상 의도되지 않은(비 일반적인) 문제라 생각하고 내용을 깊게 알아보기로 하였다.  

## 🧗 해결
글에는 불필요한 내용을 제외했지만 실제 비즈니스 로직은 트랜젝션이 작은 단위가 아니었다. 다른 테이블에 대한 insert 및 update 도 존재했고, 거기에다 rabbitMQ messageListener 나 redis RLock 등도 트랜젝션 내 외부에 존재해 서로 간의 간섭이 있는지도 우려되는 상황이었다. 하지만 서비스 로그에서는 원인을 파악하기 어려웠고 좀 더 상세한 분석이 필요했다.  

### MariaDB 로그 확인
동일한 오류를 발생시켜 `SHOW ENGINE INNODB STATUS` 쿼리의 'LATEST DETECTED DEADLOCK' 데이터를 확인하려 했지만 가장 최근의 deadlock 만 기록되는 이유로 로그 확인이 어려웠다. (문제가 발생하는 순간 연쇄적으로 다른 deadlock 이 발생하고 있는 듯 했다.)  

그래서 mariadb 에 아래 설정을 추가 후 재기동했고, 이후 발생하는 모든 deadlock 로그를 mysql_error.log 파일에서 확인할 수 있었다.  

```config
[mysqld]
# 모든 데드락 로그를 저장
innodb_print_all_deadlocks = 1
```

이후 동일한 상황을 발생시켰고 오류 로그를 획득할 수 있었다.  

<details> <summary>전체 로그</summary>
<div>
```
2024-09-10 12:38:06 2195 [Note] InnoDB: Transactions deadlock detected, dumping detailed information.

  

2024-09-10 12:38:06 2195 [Note] InnoDB:

  

*** (1) TRANSACTION:

  

  

TRANSACTION 7994580, ACTIVE 0 sec fetching rows

  

mysql tables in use 1, locked 1

  

LOCK WAIT 5 lock struct(s), heap size 1128, 3 row lock(s), undo log entries 2

  

MariaDB thread id 2195, OS thread handle 139620720838400, query id 43213 172.18.0.8 root Sending data

  

select * from target_table where col1=134 for update

  

2024-09-10 12:38:06 2195 [Note] InnoDB: *** WAITING FOR THIS LOCK TO BE GRANTED:

  

  

RECORD LOCKS space id 288 page no 3 n bits 112 index PRIMARY of table `target_table` trx id 7994580 lock_mode X locks rec but not gap waiting

  

Record lock, heap no 105 PHYSICAL RECORD: n_fields 16; compact format; info bits 0

  

0: len 8; hex 80000000000000e2; asc ;;

  

1: len 6; hex 00000079fcd3; asc y ;;

  

2: len 7; hex 5f0000400c1155; asc _ @ U;;

  

3: len 8; hex 800000000000004a; asc J;;

  

4: len 8; hex 8000000000000008; asc ;;

  

5: len 30; hex 65313833336261322d326663372d343539612d623265332d363634393435; asc e1833ba2-2fc7-459a-b2e3-664945; (total 36 bytes);

  

6: len 2; hex 8046; asc F;;

  

7: len 8; hex 99b45439860a77b0; asc T9 w ;;

  

8: len 8; hex 99b454391608c230; asc T9 0;;

  

9: len 8; hex 99b454391b05a938; asc T9 8;;

  

10: len 8; hex 99b45439860a77b0; asc T9 w ;;

  

11: SQL NULL;

  

12: len 2; hex 8014; asc ;;

  

13: len 1; hex 80; asc ;;

  

14: len 8; hex 99b45439860a77b0; asc T9 w ;;

  

15: len 2; hex 8004; asc ;;

  

  

2024-09-10 12:38:06 2195 [Note] InnoDB: *** CONFLICTING WITH:

  

  

RECORD LOCKS space id 288 page no 3 n bits 112 index PRIMARY of table `target_table` trx id 7994579 lock_mode X locks rec but not gap

  

Record lock, heap no 83 PHYSICAL RECORD: n_fields 16; compact format; info bits 0

  

0: len 8; hex 80000000000000fd; asc ;;

  

1: len 6; hex 000000000000; asc ;;

  

2: len 7; hex 80000000000000; asc ;;

  

3: len 8; hex 800000000000004a; asc J;;

  

4: SQL NULL;

  

5: SQL NULL;

  

6: len 2; hex 8014; asc ;;

  

7: len 8; hex 99b45436e70c38e8; asc T6 8 ;;

  

8: SQL NULL;

  

9: SQL NULL;

  

10: SQL NULL;

  

11: SQL NULL;

  

12: SQL NULL;

  

13: SQL NULL;

  

14: len 8; hex 99b45436e70c38e8; asc T6 8 ;;

  

15: SQL NULL;

  

  

Record lock, heap no 105 PHYSICAL RECORD: n_fields 16; compact format; info bits 0

  

0: len 8; hex 80000000000000e2; asc ;;

  

1: len 6; hex 00000079fcd3; asc y ;;

  

2: len 7; hex 5f0000400c1155; asc _ @ U;;

  

3: len 8; hex 800000000000004a; asc J;;

  

4: len 8; hex 8000000000000008; asc ;;

  

5: len 30; hex 65313833336261322d326663372d343539612d623265332d363634393435; asc e1833ba2-2fc7-459a-b2e3-664945; (total 36 bytes);

  

6: len 2; hex 8046; asc F;;

  

7: len 8; hex 99b45439860a77b0; asc T9 w ;;

  

8: len 8; hex 99b454391608c230; asc T9 0;;

  

9: len 8; hex 99b454391b05a938; asc T9 8;;

  

10: len 8; hex 99b45439860a77b0; asc T9 w ;;

  

11: SQL NULL;

  

12: len 2; hex 8014; asc ;;

  

13: len 1; hex 80; asc ;;

  

14: len 8; hex 99b45439860a77b0; asc T9 w ;;

  

15: len 2; hex 8004; asc ;;

  

  

2024-09-10 12:38:06 2195 [Note] InnoDB:

  

*** (2) TRANSACTION:

  

  

TRANSACTION 7994579, ACTIVE 0 sec fetching rows

  

mysql tables in use 1, locked 1

  

LOCK WAIT 5 lock struct(s), heap size 1128, 4 row lock(s), undo log entries 2

  

MariaDB thread id 2194, OS thread handle 139620691040000, query id 43212 172.18.0.8 root Sending data

  

select * from target_table where col1=74 for update

  

2024-09-10 12:38:06 2195 [Note] InnoDB: *** WAITING FOR THIS LOCK TO BE GRANTED:

  

  

RECORD LOCKS space id 288 page no 3 n bits 112 index PRIMARY of table `target_table` trx id 7994579 lock_mode X locks rec but not gap waiting

  

Record lock, heap no 106 PHYSICAL RECORD: n_fields 16; compact format; info bits 0

  

0: len 8; hex 800000000000004d; asc M;;

  

1: len 6; hex 00000079fcd4; asc y ;;

  

2: len 7; hex 600000049a2a40; asc ` *@;;

  

3: len 8; hex 8000000000000086; asc ;;

  

4: len 8; hex 8000000000000002; asc ;;

  

5: len 30; hex 64396534613766392d616338342d343336332d393430622d373338353238; asc d9e4a7f9-ac84-4363-940b-738528; (total 36 bytes);

  

6: len 2; hex 8046; asc F;;

  

7: len 8; hex 99b45439860a8b38; asc T9 8;;

  

8: len 8; hex 99b454391a0979c8; asc T9 y ;;

  

9: len 8; hex 99b454391e0a5870; asc T9 Xp;;

  

10: len 8; hex 99b45439860a8b38; asc T9 8;;

  

11: SQL NULL;

  

12: len 2; hex 8014; asc ;;

  

13: len 1; hex 80; asc ;;

  

14: len 8; hex 99b45439860a8b38; asc T9 8;;

  

15: len 2; hex 8005; asc ;;

  

  

2024-09-10 12:38:06 2195 [Note] InnoDB: *** CONFLICTING WITH:

  

  

RECORD LOCKS space id 288 page no 3 n bits 112 index PRIMARY of table `target_table` trx id 7994580 lock_mode X locks rec but not gap

  

Record lock, heap no 106 PHYSICAL RECORD: n_fields 16; compact format; info bits 0

  

0: len 8; hex 800000000000004d; asc M;;

  

1: len 6; hex 00000079fcd4; asc y ;;

  

2: len 7; hex 600000049a2a40; asc ` *@;;

  

3: len 8; hex 8000000000000086; asc ;;

  

4: len 8; hex 8000000000000002; asc ;;

  

5: len 30; hex 64396534613766392d616338342d343336332d393430622d373338353238; asc d9e4a7f9-ac84-4363-940b-738528; (total 36 bytes);

  

6: len 2; hex 8046; asc F;;

  

7: len 8; hex 99b45439860a8b38; asc T9 8;;

  

8: len 8; hex 99b454391a0979c8; asc T9 y ;;

  

9: len 8; hex 99b454391e0a5870; asc T9 Xp;;

  

10: len 8; hex 99b45439860a8b38; asc T9 8;;

  

11: SQL NULL;

  

12: len 2; hex 8014; asc ;;

  

13: len 1; hex 80; asc ;;

  

14: len 8; hex 99b45439860a8b38; asc T9 8;;

  

15: len 2; hex 8005; asc ;;

  

  

2024-09-10 12:38:06 2195 [Note] InnoDB: *** WE ROLL BACK TRANSACTION (0)

```
</div>
</details>

로그가 너무 길기 때문에 핵심적인 내용만 확인해보면

- 트랜젝션 7994579 과 7994580 이 동시에 배타적 락을 요청하고
- 두 트랜젝션이 record 락은 획득했으나 gap lock 은 얻지 못하는 교착상황이 발생 (lock wait)
- InnoDB 에서 둘 중 하나를 rollback 처리 (victim) 

임을 파악할 수 있었다. (물론 바로 알게된 것은 아니고 엄청난 삽질과 검색의 결과였다.)  

로그를 보고 생긴 의문점은 
- 두 트랜젝션이 락을 걸려는 레코드는 서로 다른데 왜 교착이 발생했을까?
- gap lock 이란 또 뭘까?
였다.

for update 는 row 단위로 lock 이 발생하는 것 아닌가? > 조건부

다른 트랜젝션이 
/

### 테스트
테이블 생성
```
MariaDB [test]> CREATE TABLE target_table (
    -> id INT NOT NULL,
    -> col1 INT DEFAULT NULL,
    -> PRIMARY KEY (id)
    -> );
```

```
MariaDB [test]> INSERT INTO target_table VALUES (1, 10), (2, 20), (3, 30), (4, 20), (5, 50);
Query OK, 5 rows affected (0.035 sec)
Records: 5  Duplicates: 0  Warnings: 0
```

id 를 이용한 락 확인
```
[transaction 1]> START TRANSACTION;
Query OK, 0 rows affected (0.000 sec)
[transaction 2]> START TRANSACTION;
Query OK, 0 rows affected (0.000 sec)

[transaction 1]> SELECT * FROM target_table WHERE id = 5 FOR UPDATE;
+----+------+
| id | col1 |
+----+------+
|  5 |   50 |
+----+------+
1 row in set (0.000 sec)

[transaction 2]> SELECT * FROM target_table WHERE id = 4 FOR UPDATE;
+----+------+
| id | col1 |
+----+------+
|  4 |   20 |
+----+------+
1 row in set (0.000 sec)
```

col1 컬럼을 이용한 락 확인
```
[transaction 1]> START TRANSACTION;
Query OK, 0 rows affected (0.000 sec)
[transaction 2]> START TRANSACTION;
Query OK, 0 rows affected (0.000 sec)

[transaction 1]> SELECT * FROM target_table WHERE col1 = 50 FOR UPDATE;
+----+------+
| id | col1 |
+----+------+
|  5 |   50 |
+----+------+
1 row in set (0.000 sec)

[transaction 2]> SELECT * FROM target_table WHERE col1 = 30 FOR UPDATE;
ERROR 1205 (HY000): Lock wait timeout exceeded; try restarting transaction
/* timeout 발생 */
```

2 lock struct(s), heap size 1128, 6 row lock(s)
MariaDB thread id 83579, OS thread handle 140215382992640, query id 7171893 localhost root

이 때 테이블 전체가 잠긴다

```
MariaDB [test]> SELECT * FROM target_table WHERE id IN (1, 5) FOR UPDATE;
+----+------+
| id | col1 |
+----+------+
|  1 |   10 |
|  5 |   50 |
+----+------+
2 rows in set (0.000 sec)
```

인덱스로 조회할 때는 2개의 row 만 잠기는 것을 확인할 수 있다.

2 lock struct(s), heap size 1128, 2 row lock(s)
MariaDB thread id 83579, OS thread handle 140215382992640, query id 7197926 localhost root


```
MariaDB [(none)]> SELECT * FROM information_schema.INNODB_LOCKS;
+---------------------+-------------+-----------+-----------+-----------------------+------------+------------+-----------+----------+-----------+
| lock_id             | lock_trx_id | lock_mode | lock_type | lock_table            | lock_index | lock_space | lock_page | lock_rec | lock_data |
+---------------------+-------------+-----------+-----------+-----------------------+------------+------------+-----------+----------+-----------+
| 27753272:218104:3:2 |    27753272 | X         | RECORD    | `test`.`target_table` | PRIMARY    |     218104 |         3 |        2 | 1         |
| 27753271:218104:3:2 |    27753271 | X         | RECORD    | `test`.`target_table` | PRIMARY    |     218104 |         3 |        2 | 1         |
+---------------------+-------------+-----------+-----------+-----------------------+------------+------------+-----------+----------+-----------+
2 rows in set (0.008 sec)



```


```sql
MariaDB [(none)]> show variables like '%isolation%';
MariaDB [(none)]> SELECT @@SESSION.tx_isolation;
+---------------+-----------------+
| Variable_name | Value           |
+---------------+-----------------+
| tx_isolation  | REPEATABLE-READ |
+---------------+-----------------+
```

비유니크 인덱스에 대한 쿼리 였기 때문에 gap lock 이 발생했다는 것을 깨달았고

격리수준이나 낙관적락으로 로직을 변경해도 될까?

해당 row 가 아니라 레코드가 위치한 페이지 전체나 일부를 lock 하려한다!
INNODB_LOCKS 를 확인해봐도 경합하는 부분만 보이지 이거뭐

### 로직적 오류 재연 - 실패

### 쿼리적 오류 재연 - 일부 성공

데드락 발생 시나리오
```sql
[transaction 1]> START TRANSACTION;
[transaction 1]> SELECT * from dv_datamart.tb_rm_agent_multistatus  
         WHERE agent_id = 74 FOR UPDATE ;
[transaction 2]> START TRANSACTION;
[transaction 2]> SELECT * from dv_datamart.tb_rm_agent_multistatus  
         WHERE agent_id = 134 FOR UPDATE ;
[transaction 1]> SELECT * from dv_datamart.tb_rm_agent_multistatus  
         WHERE agent_id = 74 FOR UPDATE ; /* 데드락 발생 */
```
## 🚀 참고
- [mariadb 공식문서 innodb-lock-modes](https://mariadb.com/kb/en/innodb-lock-modes/)
- [mysql 공식문서 innodb-locking](https://dev.mysql.com/doc/refman/5.7/en/innodb-locking.html)
- [mysql 공식문서 innodb-deadlocks](https://dev.mysql.com/doc/refman/5.7/en/innodb-deadlocks.html)
- [mysql 공식문서 innodb-information-schema-transactions](https://dev.mysql.com/doc/refman/5.7/en/innodb-information-schema-transactions.html)
- [트랜잭션의 격리 수준(Isolation Level)에 대해 쉽고 완벽하게 이해하기](https://mangkyu.tistory.com/299)
- [MySQL Gap Lock 다시보기](https://medium.com/daangn/mysql-gap-lock-%EB%8B%A4%EC%8B%9C%EB%B3%B4%EA%B8%B0-7f47ea3f68bc)
- [MySQL Gap Lock (두번째 이야기)](https://medium.com/daangn/mysql-gap-lock-%EB%91%90%EB%B2%88%EC%A7%B8-%EC%9D%B4%EC%95%BC%EA%B8%B0-49727c005084)
- [https://jaeseongdev.github.io/development/2021/06/16/Lock%EC%9D%98-%EC%A2%85%EB%A5%98-(Shared-Lock,-Exclusive-Lock,-Record-Lock,-Gap-Lock,-Next-key-Lock)/](https://jaeseongdev.github.io/development/2021/06/16/Lock%EC%9D%98-%EC%A2%85%EB%A5%98-(Shared-Lock,-Exclusive-Lock,-Record-Lock,-Gap-Lock,-Next-key-Lock)/)
- [https://blog.naver.com/seuis398/70132532486](https://blog.naver.com/seuis398/70132532486)