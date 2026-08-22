---
title: 네트워크 단절 뒤 스플릿브레인에 빠진 RabbitMQ 미러 큐 클러스터 되살리기
date: 2023-12-21
draft: false
tags:
  - rabbitmq
  - message-queue
  - split-brain
  - clustering
  - troubleshooting
banner: 
cssclasses: 
description: 네트워크가 잠깐 끊긴 뒤 노드가 클러스터로 못 돌아오던 RabbitMQ를, 파티션을 일부러 만들어 로그로 뜯어보고 cluster_partition_handling을 바꿔 잡은 기록.
permalink: 
aliases: 
completed: true
type:
  - issue
---

## 요약

> [!SUMMARY]
> 네트워크가 잠깐 끊겼다 붙은 뒤 RabbitMQ 노드가 `running_nodes`로 재합류하지 못했다. firewalld로 파티션을 일부러 만들어 재현하고, mnesia의 `inconsistent_database`와 미러 큐 leader 승격 로그를 읽어 원인을 확인한 뒤, `cluster_partition_handling`을 `ignore`에서 `autoheal`로 바꿔 승자 노드 선출과 패자 노드 순차 재시작이 동작하도록 검증했다.

## 1. 환경

- RabbitMQ 3.x, 클래식 미러 큐(HA policy로 큐를 3노드에 미러링)
- 브로커 노드 3대: `rabbit@mq.0`, `rabbit@mq.1`, `rabbit@mq.2` (컨테이너로 기동)
- peer discovery: `classic_config` (정적 노드 목록)
- 노드 간 통신은 firewalld가 열려 있는 포트 위에서 이뤄짐
- `cluster_partition_handling = ignore` (기존 설정)

## 2. 이슈

증상 자체는 단순했다. 노드에 네트워크 장애가 한 번 발생하면, 연결이 회복된 뒤에 `rabbitmqctl cluster_status`를 봐도 `running_nodes`에 그 노드가 돌아오지 않았다. 브로커는 살아 있는데 클러스터의 관점에서는 여전히 죽은 노드로 남아 있는 상태였다.

RabbitMQ 클러스터는 노드 간 메타데이터를 <b>mnesia</b>라는 내장 분산 DB로 관리한다. 네트워크가 끊기면 각 조각이 "상대가 죽었다"고 판단하고 자기들끼리만 상태를 갱신한다. 그러다 네트워크가 회복되면, 양쪽 다 그동안 자기 쪽이 옳다고 믿은 상태를 들고 있으므로 서로의 메타데이터가 일치하지 않는다. 이것이 <b>스플릿브레인(split-brain)</b>이며, RabbitMQ 용어로는 네트워크 파티션(network partition)이다.

문제는 이 상황을 어떻게 처리할지가 `cluster_partition_handling` 설정에 달려 있는데, 당시 값이 `ignore`였다는 것이다. 이름 그대로 "파티션이 발생하든 말든 무시하고 각자 계속 동작한다"는 뜻이다. 그래서 갈라진 노드는 다시 연결되어도 스스로 합류하지 않았고, 사람이 직접 재시작해줘야 했다. 자가복구가 되지 않은 것이 당연했다. 애초에 아무것도 하지 않도록 설정되어 있었기 때문이다.

그렇다면 다른 값으로 바꾸면 정말로 자동으로 복구되는지 궁금했다. 운영 중에 네트워크를 끊어볼 수는 없으므로 파티션을 인위적으로 만들어 확인하기로 했다.

## 3. 해결

### 1. firewalld로 파티션 재현하기

네트워크 케이블을 뽑는 대신 노드 간 통신 포트만 막으면 같은 상황이 재현된다. RabbitMQ 노드끼리는 Erlang 분산 포트로 통신하므로, 이 포트를 한 노드에서만 막으면 그 노드가 클러스터에서 떨어져 나간다. 나는 firewalld zone에서 노드 간 포트를 닫는 방식으로 재현했다.

```bash
# rabbit@mq.2 노드에서 노드 간 통신 포트를 firewalld로 막아
# 이 노드 하나만 파티션시킨다. (포트 번호는 브로커 설정에 따라 다르다)
firewall-cmd --zone=public --remove-port=25672/tcp
firewall-cmd --reload
```

이 상태에서 나머지 두 노드는 `mq.2`가 죽었다고 판단하고, `mq.2`는 나머지가 죽었다고 판단한다. 한쪽에서는 클라이언트 유입(챗봇 채팅)을 계속 흘려보내 큐에 실제 메시지가 쌓이게 두고, 포트를 다시 열어 연결과 단절을 반복하며 로그를 관찰했다.

### 2. mnesia가 뱉는 inconsistent_database

포트를 다시 열자 갈라졌던 노드가 재합류를 시도했는데, 여기서 mnesia가 걸렸다. 로그에 다음과 같이 기록됐다.

```text
[warn] Autoheal: timed out waiting for a safe-to-start message from the winner ('rabbit@mq.1'); will retry
[info] RabbitMQ is asked to start...
[noti] Application mnesia exited with reason: stopped
[erro] Mnesia('rabbit@mq.2'): ** ERROR ** mnesia_event got
       {inconsistent_database, starting_partitioned_network, 'rabbit@mq.0'}
```

`inconsistent_database, starting_partitioned_network`가 핵심이다. mnesia가 부팅하면서 두 파티션이 그동안 서로 다른 상태로 동작했다는 사실을 감지한 것이다. `ignore`였다면 여기서 그대로 멈춰버렸겠지만, 이번에는 바로 앞줄에 `Autoheal:`이 기록되어 있었다. 설정을 미리 바꿔둔 상태였기 때문이다.

### 3. autoheal로 전환

`cluster_partition_handling`에는 몇 가지 값이 있다. 파티션을 무시하는 `ignore`, 소수파 노드가 스스로 멈추는 `pause_minority`, 그리고 파티션이 끝나면 승자를 선정해 나머지를 재시작시키는 `autoheal`이 그것이다. 노드가 3대라 다수·소수를 구분할 수는 있었지만, 나는 "일단 갈라져도 서비스는 계속 받고, 연결이 회복된 뒤에 자동으로 한쪽 기준으로 정리되는" 방식이 이 워크로드에 적합하다고 판단했다. 그래서 `autoheal`을 선택했다.

```ini
# rabbitmq.conf
# 파티션이 회복되면 승자 파티션을 정하고,
# 패자 쪽 노드들을 재시작시켜 상태를 승자 기준으로 맞춘다.
cluster_partition_handling = autoheal
```

`autoheal`의 동작을 한 문장으로 정리하면 <b>파티션이 끝난 시점에 승자(winner) 파티션을 하나 선정하고, 나머지 패자 노드는 재시작하여 승자의 상태를 받아 다시 합류</b>한다는 것이다. 승자를 어떤 기준으로 선정하는지(클라이언트 연결 수 등)까지는 이번에 깊이 살피지 않았고, 로그에서 승자가 일관되게 지정되는 것만 확인했다.

### 4. 승자 선출과 패자 노드 순차 재시작

포트를 다시 열어 파티션을 회복시키자, 이번에는 로그가 다르게 흘렀다. 미러 큐가 leader를 다시 선출하고, autoheal이 승자를 지정하고, 패자 노드가 스스로 멈췄다.

```text
[info] Mirrored queue 'app.gen-Xk3nQ' in vhost '/': Promoting mirror <rabbit@mq.2...> to leader
[info] node 'rabbit@mq.0' down: wait_pending
[info] node 'rabbit@mq.0' up
[info] Autoheal request sent to 'rabbit@mq.0'
[warn] Autoheal: we were selected to restart; winner is 'rabbit@mq.1'
[info] RabbitMQ is asked to stop...
```

`we were selected to restart; winner is 'rabbit@mq.1'`이라는 메시지가 바로 원하던 결과였다. `mq.1`이 승자가 되고, 이 노드는 패자로 선정되어 스스로 멈췄다가 다시 올라온다. 미러 큐 쪽에서는 `Promoting mirror ... to leader`가 기록되며 살아남은 복제본이 leader로 승격한다. `ignore`에서 사람이 수행하던 재시작을 `autoheal`이 대신 처리해주는 것이다.

다만 미러가 동기화돼 있지 않으면 이렇게도 찍혔다.

```text
[warn] Mirrored queue 'task_result' in vhost '/': Stopping all nodes on master
       shutdown since no synchronised mirror (replica) is available
```

동기화된 미러(replica)가 없는 큐는 master가 내려갈 때 통째로 멈춘다는 경고다. autoheal이 상태를 정리하는 것은 맞지만, 그 순간 동기화되지 않은 미러 큐의 메시지는 유실될 수 있다는 뜻이다. 자가복구가 "무손실"이라는 의미는 아니다.

## 4. 확인

파티션을 여러 번 만들고 연결을 회복하며 두 가지를 확인했다.

- 네트워크를 끊는 동안에는 `rabbitmqctl cluster_status`의 `running_nodes`가 그대로였다. `ignore`든 `autoheal`이든 끊긴 순간에는 각자 살아서 동작하므로 예상대로였다.
- 네트워크를 다시 연결하면 승자 외 노드가 순차적으로 재시작하여 클러스터에 재합류했다. `ignore`에서 사람이 손대야 했던 부분이 자동으로 정리됐다.

```bash
# 재합류 후 running_nodes에 3노드가 모두 잡히는지 확인
rabbitmqctl cluster_status
```

한 가지 신경 쓰인 점은, 파티션을 만들어도 곧바로 반응하지 않는 경우가 있었다는 것이다. 활성 연결(진행 중인 채팅)이 붙어 있으면 `running_nodes`에 변화가 늦게 오거나 노드가 잘 종료되지 않았다. 파티션 감지가 즉각적이지 않고 트래픽 상태에 따라 타이밍이 흔들린다는 점은 염두에 둘 만하다.

> [!NOTE]
> 여기까지가 클래식 미러 큐 기준 이야기다. 최신 RabbitMQ는 미러 큐를 걷어내고 Raft 기반의 quorum queue를 권장한다. quorum queue는 다수결로 leader를 뽑기 때문에 파티션 상황에서 `autoheal` 같은 사후 정리에 덜 기대게 된다. 지금 새로 구성한다면 큐 타입부터 다시 보는 게 맞다.

## 참고

- [RabbitMQ — Clustering and Network Partitions](https://www.rabbitmq.com/docs/partitions)
- [RabbitMQ — Classic Queue Mirroring](https://www.rabbitmq.com/docs/3.13/ha)
- [RabbitMQ — Quorum Queues](https://www.rabbitmq.com/docs/quorum-queues)
- [Erlang — Mnesia: Recovery from Communication Failure](https://www.erlang.org/doc/apps/mnesia/mnesia_chap7.html)
- [[RabbitMQ 3파드 동시 CrashLoopBackOff와 Operator 보안 강화|같은 RabbitMQ 클러스터의 Operator 전환·보안 강화 이야기]]
