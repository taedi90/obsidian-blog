---
title: PESSIMISTIC_WRITE 와 데드락(feat. Gap lock)
date: 2024-09-04
draft: true
tags:
  - mariadb
  - gaplock
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
사내 솔루션의 비관적 락(PESSIMISTIC_WRITE) 을 사용하는 로직에 트랜젝션 간 경합이 발생할 경우 간헐적으로 deadlock 이 발생하는 증상이 발생했다.  

### 오류 메소드
```java
private List<TargetTable> findEntityListWithLock(int col1) {  
    return rdbService.getQueryFactory()  
            .selectFrom(QTargetTable.targetTable)  
            .where(QTargetTable.targetTable.col1.eq(col1))  
            .setLockMode(LockModeType.PESSIMISTIC_WRITE)  
            .fetch();  
}
```

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
### 오류 메세지
```
Caused by: javax.persistence.OptimisticLockException: org.hibernate.exception.LockAcquisitionException: could not extract ResultSet
```

### ❓의문점
- 일반적인 경합에서는 먼저 락을 획득한 트랜젝션이 종료되기 까지 <span style="background:#d3f8b6">innodb_lock_wait_timeout</span> 설정 값인 50초 동안 대기 후 오류가 발생해야 하지만, 문제 상황에서는 lock 획득 시도 후 1초 안에 데드락 이슈 발생
- 오류 또한 <span style="background:#d3f8b6">OptimisticLockException</span> 으로 lock 획득 불가 시 발생하는 PessimisticLockException 과 stackTrace 가 달랐음

이런 이유로 로직 상 의도되지 않은(비 일반적인) 문제라 생각하고 내용을 깊게 알아보기로 하였다.  

## 🧗 해결
### MariaDB 로그 확인
우선 서비스 오류 로그 만으로는 정확한 상황을 판단하기 어려워 MariaDB 의 데드락 로그를 확인해 보았다. (확인 방법은 [[MariaDB 데드락 로그 확인]] 참고)  

```
2024-09-27 18:01:00 0x7f86936af700  
*** (1) TRANSACTION:  
TRANSACTION 28480029, ACTIVE 0 sec starting index read  
mysql tables in use 1, locked 1  
LOCK WAIT 3 lock struct(s), heap size 1128, 2 row lock(s)  
MariaDB thread id 901455, OS thread handle 140215975606016, query id 53815334 172.19.0.1 root Sending data  
select targettabl0_.id as id1_184_, targettabl0_.col1 as col2_184_ from test.target_table targettabl0_ where targettabl0_.col1=50 for update  
*** WAITING FOR THIS LOCK TO BE GRANTED:  
RECORD LOCKS space id 218104 page no 3 n bits 8 index PRIMARY of table `test`.`target_table` trx id 28480029 lock_mode X locks rec but not gap waiting  
Record lock, heap no 2 PHYSICAL RECORD: n_fields 4; compact format; info bits 0  
 0: len 4; hex 80000001; asc     ;;  
 1: len 6; hex 000000000000; asc       ;;  
 2: len 7; hex 80000000000000; asc        ;;  
 3: len 4; hex 8000000a; asc     ;;  
  
*** CONFLICTING WITH:  
RECORD LOCKS space id 218104 page no 3 n bits 8 index PRIMARY of table `test`.`target_table` trx id 28480030 lock_mode X locks rec but not gap  
Record lock, heap no 2 PHYSICAL RECORD: n_fields 4; compact format; info bits 0  
 0: len 4; hex 80000001; asc     ;;  
 1: len 6; hex 000000000000; asc       ;;  
 2: len 7; hex 80000000000000; asc        ;;  
 3: len 4; hex 8000000a; asc     ;;  
  
Record lock, heap no 3 PHYSICAL RECORD: n_fields 4; compact format; info bits 0  
 0: len 4; hex 80000002; asc     ;;  
 1: len 6; hex 000000000000; asc       ;;  
 2: len 7; hex 80000000000000; asc        ;;  
 3: len 4; hex 80000014; asc     ;;  
  
Record lock, heap no 5 PHYSICAL RECORD: n_fields 4; compact format; info bits 0  
 0: len 4; hex 80000004; asc     ;;  
 1: len 6; hex 000000000000; asc       ;;  
 2: len 7; hex 80000000000000; asc        ;;  
 3: len 4; hex 80000014; asc     ;;  
  
  
*** (2) TRANSACTION:  
TRANSACTION 28480030, ACTIVE 0 sec fetching rows  
mysql tables in use 1, locked 1  
LOCK WAIT 3 lock struct(s), heap size 1128, 4 row lock(s)  
MariaDB thread id 901452, OS thread handle 140215980521216, query id 53815330 172.19.0.1 root Sending data  
select targettabl0_.id as id1_184_, targettabl0_.col1 as col2_184_ from test.target_table targettabl0_ where targettabl0_.col1=20 for update  
*** WAITING FOR THIS LOCK TO BE GRANTED:  
RECORD LOCKS space id 218104 page no 3 n bits 8 index PRIMARY of table `test`.`target_table` trx id 28480030 lock_mode X locks rec but not gap waiting  
Record lock, heap no 6 PHYSICAL RECORD: n_fields 4; compact format; info bits 0  
 0: len 4; hex 80000005; asc     ;;  
 1: len 6; hex 000000000000; asc       ;;  
 2: len 7; hex 80000000000000; asc        ;;  
 3: len 4; hex 80000032; asc    2;;  
  
*** CONFLICTING WITH:  
RECORD LOCKS space id 218104 page no 3 n bits 8 index PRIMARY of table `test`.`target_table` trx id 28480029 lock_mode X locks rec but not gap  
Record lock, heap no 6 PHYSICAL RECORD: n_fields 4; compact format; info bits 0  
 0: len 4; hex 80000005; asc     ;;  
 1: len 6; hex 000000000000; asc       ;;  
 2: len 7; hex 80000000000000; asc        ;;  
 3: len 4; hex 80000032; asc    2;;  
  
*** WE ROLL BACK TRANSACTION (0)
```

로그에서 핵심적인 내용을 확인해보면

- 트랜젝션 28480029 과 28480030 이 동시에 배타적 락을 요청하고
- 두 트랜젝션이 record 락은 획득했으나 `gap lock`은 얻지 못하는 교착상황이 발생 (lock_mode X locks rec but not gap)
- InnoDB 에서 둘 중 하나를 rollback 처리 (victim) 

임을 파악할 수 있었다.

여기서 발생한 의문점은 두 트랜젝션이 락을 걸려는 레코드는 서로 다른데 왜 교착이 발생했고 gap lock 이란 또 무엇인가? 였다. `for update` 쿼리는 row 단위로 lock 을 획득하니까 서로 다른 row 에 대해서는 경합이 발생하지 않아야 하는게 아닌가? 정답은 조건부다.

### 오류 재연
#### 테이블 세팅
```sql
MariaDB [test]> CREATE TABLE target_table (
    -> id INT NOT NULL,
    -> col1 INT DEFAULT NULL,
    -> PRIMARY KEY (id)
    -> ) ENGINE=InnoDB;
```

```
MariaDB [test]> INSERT INTO target_table VALUES (1, 10), (2, 20), (3, 30), (4, 20), (5, 50), (6, 10), (7, 20), (8, 30), (9, 40), (10, 50);
Query OK, 10 rows affected (0.035 sec)
Records: 10  Duplicates: 0  Warnings: 0
```

```sql
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
10 rows in set (0.000 sec)
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

서비스 클래스
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
  
            log.info("비관적 락 시도 - 조건 : {}", threadId * 10);  
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

### 케이스
- where 조건에 pk 로 조회하는건 오류가 발생하지 않는가?
	- 발생 안함
- repeatable_read 나 serializable 에서는 오류가 발생하지 않는가?
	- 발생 안함
- 한 트랜젝션에 for update 를 1번만 호출하면 오류가 발생하는가?
	- 발생 안함
- non-unique index 로 등록한 컬럼으로 조회하면 어떻게 될까?
	- 발생... 안함?
- setHint("javax.persistence.lock.timeout", 5000) 에서는 오류가 발생하지 않는가?
	- 무관하게 발생

### 종합
- 서로 다른 트랜젝션이 거의 동시에 락을 획득하려 했다.
- 격리 레벨은 READ_COMMITTED 와 READ_UNCOMMITTED 일 경우에만 발생했다.
- 인덱스가 아닌 컬럼을 조건으로 사용했다.
- 1개 트랜젝션에서 for update 를 두 번 호출했다. 

### 그래서 어떻게?
>Gap locking is not needed for statements that lock rows using a unique index to search for a unique row.

서비스 로직에서는 for update 문을 실행할 때 where 절에 비 유니크 인덱스 조건을 제거하고 인덱스 조건으로 row 를 검색할 수 있도록 쿼리를 수정했다. 

추가로 타임아웃(PessimisticLockException)에 대비해 트랜젝션 오류 시 비즈니스 로직을 재시도하도록 트랜젝션 외부나 스케줄링 방식으로 처리하면 더욱 완벽한 서비스를 구성할 수 있을 것 같다.  

### 테스트
테이블 생성
```
MariaDB [test]> CREATE TABLE target_table (
    -> id INT NOT NULL,
    -> col1 INT DEFAULT NULL,
    -> PRIMARY KEY (id)
    -> ) ENGINE=InnoDB;
```

```
MariaDB [test]> INSERT INTO target_table VALUES (1, 10), (2, 20), (3, 30), (4, 20), (5, 50);
Query OK, 5 rows affected (0.035 sec)
Records: 5  Duplicates: 0  Warnings: 0
```


#### 정상적인 오류
```
Caused by: org.hibernate.PessimisticLockException: could not extract ResultSet
	at org.hibernate.dialect.MySQLDialect$3.convert(MySQLDialect.java:542)
	at org.hibernate.exception.internal.StandardSQLExceptionConverter.convert(StandardSQLExceptionConverter.java:42)
	at org.hibernate.engine.jdbc.spi.SqlExceptionHelper.convert(SqlExceptionHelper.java:113)
	at org.hibernate.engine.jdbc.spi.SqlExceptionHelper.convert(SqlExceptionHelper.java:99)
	at org.hibernate.engine.jdbc.internal.ResultSetReturnImpl.extract(ResultSetReturnImpl.java:67)
	at org.hibernate.loader.Loader.getResultSet(Loader.java:2297)
	at org.hibernate.loader.Loader.executeQueryStatement(Loader.java:2050)
	at org.hibernate.loader.Loader.executeQueryStatement(Loader.java:2012)
	at org.hibernate.loader.Loader.doQuery(Loader.java:948)
	at org.hibernate.loader.Loader.doQueryAndInitializeNonLazyCollections(Loader.java:349)
	at org.hibernate.loader.Loader.doList(Loader.java:2843)
	at org.hibernate.loader.Loader.doList(Loader.java:2825)
	at org.hibernate.loader.Loader.listIgnoreQueryCache(Loader.java:2657)
	at org.hibernate.loader.Loader.list(Loader.java:2652)
	at org.hibernate.loader.hql.QueryLoader.list(QueryLoader.java:506)
	at org.hibernate.hql.internal.ast.QueryTranslatorImpl.list(QueryTranslatorImpl.java:400)
	at org.hibernate.engine.query.spi.HQLQueryPlan.performList(HQLQueryPlan.java:219)
	at org.hibernate.internal.SessionImpl.list(SessionImpl.java:1414)
	at org.hibernate.query.internal.AbstractProducedQuery.doList(AbstractProducedQuery.java:1636)
	at org.hibernate.query.internal.AbstractProducedQuery.list(AbstractProducedQuery.java:1604)
	... 21 more
Caused by: java.sql.SQLTransientConnectionException: (conn=901278) Lock wait timeout exceeded; try restarting transaction
	at org.mariadb.jdbc.internal.util.exceptions.ExceptionFactory.createException(ExceptionFactory.java:79)
	at org.mariadb.jdbc.internal.util.exceptions.ExceptionFactory.create(ExceptionFactory.java:155)
	at org.mariadb.jdbc.MariaDbStatement.executeExceptionEpilogue(MariaDbStatement.java:274)
	at org.mariadb.jdbc.ClientSidePreparedStatement.executeInternal(ClientSidePreparedStatement.java:229)
	at org.mariadb.jdbc.ClientSidePreparedStatement.execute(ClientSidePreparedStatement.java:149)
	at org.mariadb.jdbc.ClientSidePreparedStatement.executeQuery(ClientSidePreparedStatement.java:163)
	at com.zaxxer.hikari.pool.ProxyPreparedStatement.executeQuery(ProxyPreparedStatement.java:52)
	at com.zaxxer.hikari.pool.HikariProxyPreparedStatement.executeQuery(HikariProxyPreparedStatement.java)
	at org.hibernate.engine.jdbc.internal.ResultSetReturnImpl.extract(ResultSetReturnImpl.java:57)
	... 36 more
```

#### 데드락 상황
```
javax.persistence.OptimisticLockException: org.hibernate.exception.LockAcquisitionException: could not extract ResultSet
	at org.hibernate.internal.ExceptionConverterImpl.wrapLockException(ExceptionConverterImpl.java:277)
	at org.hibernate.internal.ExceptionConverterImpl.convert(ExceptionConverterImpl.java:98)
	at org.hibernate.query.internal.AbstractProducedQuery.list(AbstractProducedQuery.java:1613)
	at org.hibernate.query.Query.getResultList(Query.java:165)
	at com.querydsl.jpa.impl.AbstractJPAQuery.getResultList(AbstractJPAQuery.java:160)
	at com.querydsl.jpa.impl.AbstractJPAQuery.fetch(AbstractJPAQuery.java:202)
	at kr.aift.davinci.model.service.DeadLockTestService.findEntityListWithLock(DeadLockTestService.java:31)
	at kr.aift.davinci.model.service.DeadLockTestService.process(DeadLockTestService.java:50)
	at kr.aift.davinci.model.service.DeadLockTestService$$FastClassBySpringCGLIB$$4aff02db.invoke(<generated>)
	at org.springframework.cglib.proxy.MethodProxy.invoke(MethodProxy.java:218)
	at org.springframework.aop.framework.CglibAopProxy$CglibMethodInvocation.invokeJoinpoint(CglibAopProxy.java:779)
	at org.springframework.aop.framework.ReflectiveMethodInvocation.proceed(ReflectiveMethodInvocation.java:163)
	at org.springframework.aop.framework.CglibAopProxy$CglibMethodInvocation.proceed(CglibAopProxy.java:750)
	at org.springframework.transaction.interceptor.TransactionInterceptor$1.proceedWithInvocation(TransactionInterceptor.java:123)
	at org.springframework.transaction.interceptor.TransactionAspectSupport.invokeWithinTransaction(TransactionAspectSupport.java:388)
	at org.springframework.transaction.interceptor.TransactionInterceptor.invoke(TransactionInterceptor.java:119)
	at org.springframework.aop.framework.ReflectiveMethodInvocation.proceed(ReflectiveMethodInvocation.java:186)
	at org.springframework.aop.framework.CglibAopProxy$CglibMethodInvocation.proceed(CglibAopProxy.java:750)
	at org.springframework.aop.framework.CglibAopProxy$DynamicAdvisedInterceptor.intercept(CglibAopProxy.java:692)
	at kr.aift.davinci.model.service.DeadLockTestService$$EnhancerBySpringCGLIB$$1200910b.process(<generated>)
	at kr.aift.davinci.api.service.DeadLockTest.lambda$test$0(DeadLockTest.java:45)
	at java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1149)
	at java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:624)
	at java.lang.Thread.run(Thread.java:750)
Caused by: org.hibernate.exception.LockAcquisitionException: could not extract ResultSet
	at org.hibernate.dialect.MySQLDialect$3.convert(MySQLDialect.java:557)
	at org.hibernate.exception.internal.StandardSQLExceptionConverter.convert(StandardSQLExceptionConverter.java:42)
	at org.hibernate.engine.jdbc.spi.SqlExceptionHelper.convert(SqlExceptionHelper.java:113)
	at org.hibernate.engine.jdbc.spi.SqlExceptionHelper.convert(SqlExceptionHelper.java:99)
	at org.hibernate.engine.jdbc.internal.ResultSetReturnImpl.extract(ResultSetReturnImpl.java:67)
	at org.hibernate.loader.Loader.getResultSet(Loader.java:2297)
	at org.hibernate.loader.Loader.executeQueryStatement(Loader.java:2050)
	at org.hibernate.loader.Loader.executeQueryStatement(Loader.java:2012)
	at org.hibernate.loader.Loader.doQuery(Loader.java:948)
	at org.hibernate.loader.Loader.doQueryAndInitializeNonLazyCollections(Loader.java:349)
	at org.hibernate.loader.Loader.doList(Loader.java:2843)
	at org.hibernate.loader.Loader.doList(Loader.java:2825)
	at org.hibernate.loader.Loader.listIgnoreQueryCache(Loader.java:2657)
	at org.hibernate.loader.Loader.list(Loader.java:2652)
	at org.hibernate.loader.hql.QueryLoader.list(QueryLoader.java:506)
	at org.hibernate.hql.internal.ast.QueryTranslatorImpl.list(QueryTranslatorImpl.java:400)
	at org.hibernate.engine.query.spi.HQLQueryPlan.performList(HQLQueryPlan.java:219)
	at org.hibernate.internal.SessionImpl.list(SessionImpl.java:1414)
	at org.hibernate.query.internal.AbstractProducedQuery.doList(AbstractProducedQuery.java:1636)
	at org.hibernate.query.internal.AbstractProducedQuery.list(AbstractProducedQuery.java:1604)
	... 21 more
Caused by: java.sql.SQLTransactionRollbackException: (conn=901455) Deadlock found when trying to get lock; try restarting transaction
	at org.mariadb.jdbc.internal.util.exceptions.ExceptionFactory.createException(ExceptionFactory.java:76)
	at org.mariadb.jdbc.internal.util.exceptions.ExceptionFactory.create(ExceptionFactory.java:155)
	at org.mariadb.jdbc.MariaDbStatement.executeExceptionEpilogue(MariaDbStatement.java:274)
	at org.mariadb.jdbc.ClientSidePreparedStatement.executeInternal(ClientSidePreparedStatement.java:229)
	at org.mariadb.jdbc.ClientSidePreparedStatement.execute(ClientSidePreparedStatement.java:149)
	at org.mariadb.jdbc.ClientSidePreparedStatement.executeQuery(ClientSidePreparedStatement.java:163)
	at com.zaxxer.hikari.pool.ProxyPreparedStatement.executeQuery(ProxyPreparedStatement.java:52)
	at com.zaxxer.hikari.pool.HikariProxyPreparedStatement.executeQuery(HikariProxyPreparedStatement.java)
	at org.hibernate.engine.jdbc.internal.ResultSetReturnImpl.extract(ResultSetReturnImpl.java:57)
	... 36 more
Caused by: org.mariadb.jdbc.internal.util.exceptions.MariaDbSqlException: Deadlock found when trying to get lock; try restarting transaction
	at org.mariadb.jdbc.internal.util.exceptions.MariaDbSqlException.of(MariaDbSqlException.java:34)
	at org.mariadb.jdbc.internal.protocol.AbstractQueryProtocol.exceptionWithQuery(AbstractQueryProtocol.java:194)
	at org.mariadb.jdbc.internal.protocol.AbstractQueryProtocol.exceptionWithQuery(AbstractQueryProtocol.java:177)
	at org.mariadb.jdbc.internal.protocol.AbstractQueryProtocol.executeQuery(AbstractQueryProtocol.java:321)
	at org.mariadb.jdbc.ClientSidePreparedStatement.executeInternal(ClientSidePreparedStatement.java:220)
	... 41 more
Caused by: java.sql.SQLTransactionRollbackException: Deadlock found when trying to get lock; try restarting transaction
	at org.mariadb.jdbc.internal.util.exceptions.ExceptionFactory.createException(ExceptionFactory.java:76)
	at org.mariadb.jdbc.internal.util.exceptions.ExceptionFactory.create(ExceptionFactory.java:189)
	at org.mariadb.jdbc.internal.com.read.resultset.SelectResultSet.readNextValue(SelectResultSet.java:387)
	at org.mariadb.jdbc.internal.com.read.resultset.SelectResultSet.fetchAllResults(SelectResultSet.java:293)
	at org.mariadb.jdbc.internal.com.read.resultset.SelectResultSet.<init>(SelectResultSet.java:155)
	at org.mariadb.jdbc.internal.protocol.AbstractQueryProtocol.readResultSet(AbstractQueryProtocol.java:1850)
	at org.mariadb.jdbc.internal.protocol.AbstractQueryProtocol.readPacket(AbstractQueryProtocol.java:1569)
	at org.mariadb.jdbc.internal.protocol.AbstractQueryProtocol.getResult(AbstractQueryProtocol.java:1519)
	at org.mariadb.jdbc.internal.protocol.AbstractQueryProtocol.executeQuery(AbstractQueryProtocol.java:318)
	... 42 more
```

```

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