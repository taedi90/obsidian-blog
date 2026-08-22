---
title: MariaDB PESSIMISTIC_WRITE 와 데드락(feat. Gap lock)
date: 2024-09-28
draft: false
tags:
  - mariadb
  - deadlock
  - gap-lock
  - pessimistic-write
  - innodb
banner: 
cssclasses: 
description: InnoDB에서 인덱스 없는 컬럼을 WHERE 조건으로 PESSIMISTIC_WRITE를 걸었더니 Gap Lock까지 잡히며 데드락이 나던 문제를, 원인을 파고들어 PK 기반 조회로 푼 기록.
permalink: 
aliases:
completed: true
featured: true
---
## 요약
> [!SUMMARY]
> InnoDB에서 인덱스 없는 컬럼을 WHERE 조건으로 <b>PESSIMISTIC_WRITE</b>를 걸면 <b>레코드 락(Record Lock)</b>뿐 아니라 <b>갭 락(Gap Lock)</b>까지 함께 걸릴 수 있고, 이게 의도치 않은 데드락으로 이어진다.
> - 공식문서는 <b>REPEATABLE READ</b> 격리 수준 이상에서 Gap Lock 이 발생하는 경우를 설명하지만 READ_COMMITTED 와 READ_UNCOMMITTED 격리 수준에서도 Gap Lock 이 발생했다.
> - 비교유(Non-Unique) 인덱스를 WHERE 조건으로 사용해도 동일하게 데드락이 발생할 것이라 생각했지만 의외로 데드락이 발생하지 않았다.
> - 데드락을 피하기 위해서는 상황에 따라 아래 방법 등을 고민해볼 수 있다.
> 	- 비유니크 인덱스 조건을 <b>`WHERE PK IN (A, B)`</b>와 같이 기본 키(PK)를 이용한 조건으로 변경
> 	- 비관적 락이 아닌 낙관적 락으로 로직 변경 
> 	- 트랜젝션 오류 시 재시도 로직 추가

## 1. 환경
- MariaDB 10.8.3 (InnoDB)
- Spring Boot 2.5.1
- JDK 1.8

## 2. 이슈
사내 솔루션에서 <b>비관적 락(PESSIMISTIC_WRITE)</b>을 사용하는 로직에 트랜잭션 간 경합이 발생하며 간헐적으로 데드락이 발생하는 문제를 겪었다. 문제 상황을 재현하기 위해 아래와 같이 코드를 구성해보았다.

### 엔티티
```java
@Entity  
@Table(name = "target_table", catalog = "test")  
@Data  
public class TargetTable {  
  
    @Id  
    @GeneratedValue(strategy = GenerationType.AUTO)  
    @Column(name = "id")  
    private Integer id;  
  
    @Column(name = "col1")  
    private Integer col1;  
  
}
```

### 오류 발생 지점
```java
private List<TargetTable> findEntityListWithLock(int col1) {  
    return rdbService.getQueryFactory()  
            .selectFrom(QTargetTable.targetTable)  
            .where(QTargetTable.targetTable.col1.eq(col1))  
            .setLockMode(LockModeType.PESSIMISTIC_WRITE)  
            .fetch();  
}
```

### 오류 메시지
```java
Caused by: javax.persistence.OptimisticLockException: org.hibernate.exception.LockAcquisitionException: could not extract ResultSet
```

### ❓ 의문점
일반적인 경합 상황이라면, 먼저 락을 획득한 트랜잭션이 끝날 때까지 `innodb_lock_wait_timeout` 설정값인 50초 동안 대기한 후 타임아웃 오류가 발생해야 한다고 예상했다. 하지만 실제로는 락 획득 시도 후 1초도 안 되어 데드락 예외가 발생했다.

게다가 예외 종류도 락 획득 실패 시 예상했던 `PessimisticLockException`이 아니라 `OptimisticLockException`이어서 의아했다.

이러한 점들 때문에 단순한 경합 문제가 아닌, 로직 상에서 의도치 않은 다른 원인이 있을 것이라 판단했고, 원인을 더 깊이 분석해 보기로 했다.

## 3. 해결
### MariaDB 로그 확인
서비스 오류 로그만으로는 정확한 원인 파악이 어려워, MariaDB의 데드락 로그를 직접 확인해보기로 했다. (확인 방법은 [[MariaDB 데드락 로그 확인]] 참고)

```
2024-09-27 18:01:00 0x7f86936af700  
*** (1) TRANSACTION:  
TRANSACTION 28480029, ACTIVE 0 sec starting index read  
mysql tables in use 1, locked 1  
LOCK WAIT 3 lock struct(s), heap size 1128, 2 row lock(s)  
MariaDB thread id 901455, OS thread handle 140215975606016, query id 53815334 10.0.0.1 root Sending data  
select targettabl0_.id as id1_184_, targettabl0_.col1 as col2_184_ from test.target_table targettabl0_ where targettabl0_.col1=50 for update  
*** WAITING FOR THIS LOCK TO BE GRANTED:  
RECORD LOCKS space id 218104 page no 3 n bits 8 index PRIMARY of table `test`.`target_table` trx id 28480029 lock_mode X locks rec but not gap waiting  
...
*** (2) TRANSACTION:  
TRANSACTION 28480030, ACTIVE 0 sec fetching rows  
mysql tables in use 1, locked 1  
LOCK WAIT 3 lock struct(s), heap size 1128, 4 row lock(s)  
MariaDB thread id 901452, OS thread handle 140215980521216, query id 53815330 10.0.0.1 root Sending data  
select targettabl0_.id as id1_184_, targettabl0_.col1 as col2_184_ from test.target_table targettabl0_ where targettabl0_.col1=20 for update  
*** WAITING FOR THIS LOCK TO BE GRANTED:  
RECORD LOCKS space id 218104 page no 3 n bits 8 index PRIMARY of table `test`.`target_table` trx id 28480030 lock_mode X locks rec but not gap waiting  
...
*** WE ROLL BACK TRANSACTION (0)
```

로그를 확인하면 두 트랜잭션이 `record lock`은 획득했지만 `gap lock`은 얻지 못한 상태에서 서로를 기다리다 교착 상태에 빠졌고(`lock_mode X locks rec but not gap waiting`), 결국 InnoDB 엔진이 둘 중 하나를 희생 트랜잭션(victim)으로 선택해 롤백했다는 사실을 알 수 있다.

> [!NOTE]
> <b>갭 락(Gap Lock)이란?</b>
> 갭 락은 인덱스 레코드 사이의 간격(Gap)을 잠그는 기능이다. 즉, 실제 존재하는 레코드뿐만 아니라, 조건에 해당하지만 <b>존재하지 않는 레코드의 범위까지 잠근다.</b> 이로 인해 다른 트랜잭션이 그 간격 내에 새로운 데이터를 추가(INSERT)하는 것을 방지하여 `Phantom Read` 현상을 막는다.

여기서 새로운 의문이 생겼다. 두 트랜잭션은 서로 다른 레코드를 대상으로 락을 시도했는데도 교착 상태가 발생했으며, 생소한 `Gap Lock`이 정확히 무엇인지도 확인할 필요가 있었다. 일반적으로 `FOR UPDATE` 쿼리는 레코드(Row) 단위로 락을 획득하므로, 서로 다른 레코드를 대상으로 할 때는 경합이 발생하지 않아야 한다고 생각했다. 하지만 여기에는 한 가지 중요한 조건이 숨어 있었다.

### 오류 재현
정확한 원인을 파악하기 위해 데드락이 발생하는 상황을 직접 재현해보았다.

#### 테이블 세팅
```sql
MariaDB [test]> CREATE TABLE target_table (
    -> id INT NOT NULL,
    -> col1 INT DEFAULT NULL,
    -> PRIMARY KEY (id)
    -> ) ENGINE=InnoDB;

MariaDB [test]> INSERT INTO target_table VALUES (1, 10), (2, 20), (3, 30), (4, 20), (5, 50), (6, 10), (7, 20), (8, 30), (9, 40), (10, 50);

MariaDB [test]> select * from target_table;
+----+------+
| id | col1 |
+----+------+
|  1 |   10 |
|  6 |   10 |
|  2 |   20 |
|  7 |   20 |
|  3 |   30 |
|  8 |   30 |
|  4 |   40 |
|  9 |   40 |
|  5 |   50 |
| 10 |   50 |
+----+------+
```

#### 테스트 코드
```java
@Slf4j  
@RequiredArgsConstructor  
@DisplayName("데드락 테스트")  
@Transactional  
public class DeadLockTest extends IntegrationTest {  
  
    private final DeadLockTestService deadLockTestService;  
    final int NUM_THREADS = 5;  
  
    @Test  
    @DisplayName("서로 다른 스레드(트랜젝션)가 동시에 락 획득 시도")  
    void test() {  
        ExecutorService executorService = new ThreadPoolExecutor(NUM_THREADS, NUM_THREADS, 0L, TimeUnit.MILLISECONDS,  
                new LinkedBlockingQueue<>());  
  
        List<Runnable> runnables = new ArrayList<>();  
  
        for (int i = 0; i < NUM_THREADS; i++) {  
            final int threadId = i + 1; // 스레드 번호  
            Runnable runnable = () -> {  
                deadLockTestService.process(threadId);  
            };  
            runnables.add(runnable);  
        }  
        // 스레드 작업 실행  
        runnables.forEach(executorService::execute);  
  
        // 스레드 풀 종료  
        executorService.shutdown();  
        try {  
            executorService.awaitTermination(Long.MAX_VALUE, TimeUnit.NANOSECONDS);  
        } catch (InterruptedException e) {  
            Thread.currentThread().interrupt();  
        }  
    }  
}
```

#### 서비스 클래스
```java
@Service  
@Slf4j  
@RequiredArgsConstructor  
public class DeadLockTestService {  
    private final RdbService rdbService;  
  
    private List<TargetTable> findEntityListWithLock(int col1) {  
        return rdbService.getQueryFactory()  
                .selectFrom(QTargetTable.targetTable)  
                .where(QTargetTable.targetTable.col1.eq(col1))  
                .setLockMode(LockModeType.PESSIMISTIC_WRITE)
                .fetch();  
    }  
  
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public void process(int threadId) {  
        // 현재 시간  
        LocalTime now = LocalTime.now();  
        // 다음 분의 00초 000밀리초까지 남은 시간 계산  
        LocalTime nextMinute = now.plusMinutes(1).truncatedTo(ChronoUnit.MINUTES);  
        long millisUntilNextMinute = ChronoUnit.MILLIS.between(now, nextMinute);   
        try {  
            // 다음 00초 000밀리초까지 대기  
            Thread.sleep(millisUntilNextMinute);  
  
            log.info("비관적 락 시도 - 조건 : col1={}", threadId * 10);  
            List<TargetTable> list = findEntityListWithLock(threadId * 10);  
            log.info("비관적 락 획득 완료 - {}", list.size());  
            list = findEntityListWithLock(threadId * 10);  
  
            Thread.sleep(10000);  
        } catch (InterruptedException e) {  
            throw new RuntimeException(e);  
        } catch (OptimisticLockException e) {  
            e.printStackTrace();  
            log.info("잡았다!");  
        } catch (PessimisticLockException e) {  
            e.printStackTrace();  
            log.info("정상적인 경우");  
        }    }  
}
```

#### 테스트 진행
이 코드를 바탕으로 여러 케이스를 실행했고, 결과는 다음과 같았다.

| 케이스                                                         | 데드락 발생 여부    |
| ----------------------------------------------------------- | ------------ |
| WHERE 조건에 PK 를 사용하는 경우                                      | 발생 안함        |
| 격리수준을 `REPEATABLE_READ` 나 `SERIALIZABLE` 로 설정하는 경우          | 발생 안함        |
| 한 트랜젝션에 `FOR UPDATE` 쿼리를 1번씩만 호출하는 경우                       | 발생 안함        |
| 비고유(Non-unique) 인덱스로 등록한 컬럼을 WHERE 조건으로 사용하는 경우              | <u>발생 안함</u> |
| `setHint("javax.persistence.lock.timeout", 5000)` 로 설정하는 경우 | 설정과 무관하게 발생  |


> [!IMPORTANT]
> 비고유(Non-unique) 인덱스를 WHERE 조건으로 사용해도 동일하게 데드락이 발생할 것이라 생각했지만 의외로 데드락이 발생하지 않았다. 이 부분에 대해서는 추가적으로 파악하지 못했다.

### 데드락 발생 조건 분석
여러 테스트를 통해 데드락이 발생하는 특정 조건을 종합해볼 수 있었다. 

- 서로 다른 트랜젝션이 거의 동시에 락을 획득하려 했다.
- 격리 레벨은 READ_COMMITTED 와 READ_UNCOMMITTED 일 경우에만 발생했다.
- 인덱스가 아닌 컬럼을 조건으로 사용했다.
- 1개 트랜젝션에서 for update 를 두 번 호출했다. 

테스트 결과를 테스트 결과를 테스트 결과를 종합하면 <b>`READ_COMMITTED` 또는 `READ_UNCOMMITTED` 격리 수준</b>에서, <b>인덱스가 없는 컬럼</b>을 `WHERE` 조건으로 사용하여, <b>하나의 트랜잭션에서 `FOR UPDATE`를 두 번 이상 호출</b>하며, <b>여러 트랜잭션이 거의 동시에 락을 획득하려 할 때</b> 발생했다.

> [!IMPORTANT]
> 공식 문서에서는 `REPEATABLE READ` 격리 수준 이상에서 `Gap Lock`이 발생한다고 설명하지만, 진행한 테스트에서는 `READ_COMMITTED`와 `READ_UNCOMMITTED` 격리 수준에서도 `Gap Lock`으로 인한 데드락이 발생했다. MariaDB 버전의 이슈나 특정 상황에 따라 동작이 다를 수 있는지에 대해서는 파악하지 못했다.

### 해결 방안
> Gap locking is not needed for statements that lock rows using a unique index to search for a unique row.
> \- MariaDB 공식 문서

`Gap Lock`이 원인이라는 사실을 파악하고 로직을 수정했다. 기존에는 `FOR UPDATE` 쿼리의 `WHERE` 절에 인덱스 없는 컬럼 조건을 사용했는데, 이것을 <b>`WHERE id IN (...)`처럼 PK로 레코드를 조회하도록</b> 변경했다. 위 인용 문구대로 유니크 인덱스로 특정 행을 조회할 때는 Gap Lock이 걸리지 않으므로 데드락이 사라졌다.

![](https://i.imgur.com/wjlZyNz.png)

추가적으로, 데드락이 아니더라도 발생할 수 있는 타임아웃(`PessimisticLockException`)에 대비하여 트랜잭션 오류 시 비즈니스 로직을 재시도하는 로직을 추가한다면 더욱 안정적인 서비스를 만들 수 있을 것이라 생각한다. 이러한 재시도 로직은 트랜잭션 외부에서 처리하거나 별도의 스케줄링 방식으로 구현하면 좋겠다.

## 참고
- [mariadb 공식문서 innodb-lock-modes](https://mariadb.com/kb/en/innodb-lock-modes/)
- [mysql 공식문서 innodb-locking](https://dev.mysql.com/doc/refman/5.7/en/innodb-locking.html)
- [mysql 공식문서 innodb-deadlocks](https://dev.mysql.com/doc/refman/5.7/en/innodb-deadlocks.html)
- [mysql 공식문서 innodb-information-schema-transactions](https://dev.mysql.com/doc/refman/5.7/en/innodb-information-schema-transactions.html)
- [트랜잭션의 격리 수준(Isolation Level)에 대해 쉽고 완벽하게 이해하기](https://mangkyu.tistory.com/299)
- [MySQL Gap Lock 다시보기](https://medium.com/daangn/mysql-gap-lock-%EB%8B%A4%EC%8B%9C%EB%B3%B4%EA%B8%B0-7f47ea3f68bc)
- [MySQL Gap Lock (두번째 이야기)](https://medium.com/daangn/mysql-gap-lock-%EB%91%90%EB%B2%88%EC%A7%B8-%EC%9D%B4%EC%95%BC%EA%B8%B0-49727c005084)
- [Lock의 종류 (Shared Lock, Exclusive Lock, Record Lock, Gap Lock, Next-key Lock)](https://jaeseongdev.github.io/development/2021/06/16/Lock%EC%9D%98-%EC%A2%85%EB%A5%98-(Shared-Lock,-Exclusive-Lock,-Record-Lock,-Gap-Lock,-Next-key-Lock)/)
- [InnoDB의 Lock Escalation](https://blog.naver.com/seuis398/70132532486)
