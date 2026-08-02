---
title: "온프레미스 3서버 납품 환경의 HA/Failover 대안 검토: Restart Policy·Healthcheck의 한계와 Docker Swarm"
date: 2023-12-05
draft: false
featured: true
tags:
  - docker
  - docker-swarm
  - high-availability
  - failover
  - on-premise
banner: 
cssclasses: 
description: 3서버 납품 환경에서 재기동 때마다 컨테이너가 안 살아나고 Galera·Redis가 꼬이던 걸, restart policy·healthcheck·Docker Swarm 세 방식으로 저울질한 기록.
permalink: 
aliases: 
completed: true
type:
  - comparison
---

## 요약

> [!SUMMARY]
> 온프레미스에 서버 3식을 납품하면서 HA/Failover를 표방했는데, 정작 서버나 도커가 재기동되면 컨테이너가 자동으로 살아나지 않고 Galera·Redis 클러스터는 멤버십이 꼬였다. restart policy(`always`/`unless-stopped`), healthcheck + 자가 재기동 스크립트, Docker Swarm 세 방식을 저울질했고, <b>unhealthy 컨테이너를 자동으로 재생성해주는 건 Swarm뿐</b>이라는 게 핵심 차이였다. 다만 Swarm은 폐쇄망 registry, 공유 스토리지, stateful 서비스의 노드 고정, Galera bootstrap 선행 조치를 요구해서 그 값을 치를지가 진짜 판단 지점이었다.

## 1. 개요

우리 제품은 사이트에 납품할 때 권장 사양으로 서버 3식을 제안한다. 명분은 HA와 Failover다. 그런데 막상 운영을 들여다보니 그 명분이 무색했다.

- 서버 3대 중 1대가 재부팅되면 그 위의 컨테이너는 자동으로 안 뜬다. 서버는 그냥 idle로 남고, 관리자가 수동으로 컨테이너를 올려줘야 한다.
- 컨테이너는 떠 있어도 내부 프로세스가 죽어 있는 경우(이른바 `APPLICATION FAILED TO START`)를 도커는 모른다.
- MariaDB(Galera), Redis 같은 클러스터류는 재기동되면 클러스터 멤버로 다시 못 붙거나 master/replica 배정이 꼬인다.

"3식 납품 = HA"라는 말이 반쯤은 구호였던 셈이다. 이걸 제대로 채우려고 후보를 세 개 놓고 비교했다. restart policy만으로 버티기, healthcheck에 자가 재기동 트릭을 얹기, 그리고 Docker Swarm 도입.

> [!INFO]
> unhealthy 컨테이너를 재기동하는 healthcheck 트릭 자체는 [[Docker Healthcheck 실패 시 컨테이너 재기동 설정|따로 정리해둔 글]]이 있다. 이 글은 그 트릭을 포함해 "3서버 납품에서 뭘 고를 것인가"를 저울질한 의사결정 기록이다.

## 2. 선정 배경

세 방식을 이해하려면 도커가 어디까지 해주고 어디서 손을 놓는지부터 봐야 한다.

<b>restart policy</b>는 컨테이너가 <b>종료</b>됐을 때만 개입한다. `restart: unless-stopped`를 걸면 사용자가 임의로 stop하지 않는 한 컨테이너가 죽으면 도로 띄운다. 서버 재부팅 후 자동 기동도 이걸로 어느 정도 해결된다. 문제는 두 가지다. 컨테이너가 떠 있되 안이 죽은 상태는 종료가 아니라서 손을 안 댄다. 그리고 경험상 서비스에 따라 `always`를 줘도 재기동이 안 되거나 순서 문제로 실패하는 케이스가 있었다(원인은 끝내 못 밝혔다. 어느 고객사 개발서버의 Oracle이 재시작 때 자동으로 안 뜨던 게 대표적이다).

<b>healthcheck</b>는 상태를 <b>판정</b>만 한다. `curl`로 헬스 API를 찔러 `healthy`/`unhealthy`를 매기는데, 딱 거기까지다. unhealthy로 표시될 뿐 도커가 그 컨테이너를 다시 만들어주지는 않는다. 그래서 자가 치유(auto healing)를 흉내 내려면 편법이 필요했다.

- 호스트에서 crontab으로 unhealthy 컨테이너를 주기적으로 재기동: `docker ps -q -f health=unhealthy | xargs docker restart`. 되긴 하는데 관리 포인트가 호스트로 쪼개진다.
- healthcheck 스크립트 안에서 실패가 누적되면 컨테이너 내부 프로세스를 직접 죽이는 방법. 프로세스가 죽으면 컨테이너가 종료되고, 그제야 restart policy가 받아서 다시 띄운다.

아래가 그 자가 종료 트릭이다. 일정 횟수 헬스 체크에 실패하면 컨테이너 안 모든 프로세스에 SIGTERM을 보내고, 안 죽으면 SIGKILL로 마무리한다. 결국 컨테이너를 종료시켜 restart policy에게 넘기는 우회로다.

```yaml
# 헬스 체크가 누적 실패하면 컨테이너 프로세스를 스스로 종료시켜
# restart policy 가 재기동하도록 유도하는 우회 방식이다.
restart: unless-stopped
healthcheck:
  test:
    [
      "CMD-SHELL",
      "for run in {1..3}; do if (curl -s -f http://127.0.0.1:8080/health); then exit 0; fi; sleep 10s; done && \
       bash -c 'kill -s 15 -1 && (sleep 10; kill -s 9 -1)'"
    ]
  interval: 5s
  timeout: 200s
  retries: 1
```

이 방식은 도커만으로 굴러가서 폐쇄망에서도 추가 요건이 없다. 대신 "컨테이너를 일부러 죽여서 살린다"는 게 영 개운치 않고, 재기동 사유 추적이 어려워 로그를 따로 남겨야 한다.

<b>Docker Swarm</b>은 오케스트레이터라 결이 다르다. unhealthy 컨테이너를 <b>자기가 판단해서 재생성</b>한다(편법이 아니라 기본 동작이다). 노드가 죽으면 그 노드에 있던 서비스를 다른 가용 노드에 다시 스케줄한다. 3대를 모두 manager 겸 worker로 묶을 수 있고, 배포도 compose YAML을 거의 그대로 `docker stack deploy`로 쓴다. 대신 값을 치러야 한다.

- 로컬 이미지로는 배포가 안 된다. 폐쇄망이라면 <b>private registry를 반드시 세워야</b> 한다. (`docker swarm init`은 폐쇄망에서도 되는 걸 개발서버에서 확인했다.)
- 서비스가 노드 간을 옮겨 다니니 볼륨을 어떻게 공유할지가 숙제다. 공유 스토리지(NFS 등)가 제일 간단하지만 속도 이슈가 있고, 아니면 GlusterFS·Ceph·rsync 같은 걸 얹어야 하는데 사이트마다 정책이 걸린다.
- `depends_on`은 Swarm에서 무시된다. 원래도 이건 `docker compose up`에만 먹고 재기동 상황에선 순서 없이 다 같이 뜬다. Galera가 특히 여기서 터진다.

## 3. 비교

세 방식을 같은 축으로 놓고 봤다.

| 항목 | restart policy | healthcheck + 자가 종료 | Docker Swarm |
| --- | --- | --- | --- |
| 서버/도커 재기동 시 자동 기동 | O (단 일부 서비스 불안정) | O (restart policy에 의존) | O |
| 프로세스 이상(unhealthy) 감지 | X | O | O |
| unhealthy 컨테이너 자동 재생성 | X | △ (죽여서 restart policy에 넘김) | <b>O (네이티브)</b> |
| 노드 다운 시 타 노드 재배치 | X | X | O |
| 실행 순서/의존성 보장 | X | X | X (`depends_on` 무시) |
| 폐쇄망 추가 요건 | 없음 | 없음 | private registry 필수 |
| 볼륨 | 로컬 그대로 | 로컬 그대로 | 공유 스토리지 설계 필요 |
| 전환 공수 | 거의 없음 | 낮음 (스크립트) | 높음 (구조 전환) |

표를 채우고 나니 답이 좁혀졌다. unhealthy 컨테이너를 <b>깔끔하게 자동 재생성</b>하고 노드 다운을 감지해 재배치까지 해주는 건 Swarm뿐이다. 나머지 둘은 "컨테이너가 종료되면 다시 띄운다"는 restart policy의 틀 안에서 노는 변형이라, 노드 자체가 죽는 시나리오엔 손을 못 댄다.

## 4. 선정 사유

결론만 말하면 <b>Docker Swarm</b> 쪽으로 기울었다. 이유는 표의 굵은 칸 하나다. 3식 납품의 명분이 "노드 하나 죽어도 서비스가 산다"인데, 그걸 도커 기본기나 스크립트 편법으로는 못 채운다. `docker swarm init`을 해도 기존 컨테이너가 사라지지 않아 전환 부담도 생각보다 작았다.

다만 Swarm을 켠다고 저절로 되는 게 아니어서, 도입 전에 정리해둔 요건이 있다.

<b>폐쇄망 registry.</b> 로컬 이미지 배포가 막히니 사내/사이트에 private registry가 먼저 있어야 한다. 이게 없으면 `docker stack deploy`가 이미지를 못 찾는다.

<b>stateful 서비스는 오케스트레이션에 안 맡긴다.</b> Redis·MariaDB처럼 상태를 쥔 놈들을 Swarm이 마음대로 옮기게 두면 데이터가 꼬인다. replica 1짜리 서비스로 쪼개 <b>노드마다 하나씩 고정 배치</b>(placement constraint)하고, 포트도 노드별로 따로 부여하는 방향이 맞다고 봤다. LB로 묶어 실컷 옮겨 다니게 하는 그림은 stateful엔 안 맞는다.

<b>Galera bootstrap 선행 조치.</b> 이게 제일 골치다. `depends_on`이 안 먹으니 재기동 때 Galera 노드들이 순서 없이 동시에 뜨는데, 2대 이상이 함께 재기동되면 클러스터링에 실패한다. 그래서 컨테이너 기동 전에 <b>가장 최신 시퀀스(seqno)를 가진 노드를 찾아 donor로 세우고 나머지를 joiner로 붙이는</b> 부트스트랩 로직이 별도로 필요하다. Swarm이 이걸 대신 해주지는 않는다.

`docker stack deploy`가 `.env`를 자동으로 안 읽는 것도 미리 알아둘 함정이다. compose를 렌더링해서 넘기거나 셸에서 env를 export한 뒤 배포해야 한다.

```bash
# stack deploy 는 .env 를 자동 반영하지 않아, 셸 환경변수로 올린 뒤 배포한다.
set -a
. .env
set +a
docker stack deploy -c docker-compose.yml myapp
```

healthcheck 예시에 DB 접속 정보가 들어가는 경우가 많은데, MariaDB ping 같은 체크에 평문 비밀번호를 박지 말고 환경변수로 빼는 걸 원칙으로 했다.

```bash
# 평문 비밀번호를 명령줄에 노출하지 않도록 환경변수로 주입한다. (<REDACTED>는 실제 값 아님)
mysqladmin ping -uroot -p"${MYSQL_ROOT_PASSWORD}" -h 127.0.0.1
```

정리하자면, unhealthy 자동 재생성과 노드 재배치를 얻는 대가로 registry·공유 스토리지·Galera 부트스트랩이라는 숙제를 떠안는 거래다. 3식 납품이 표방한 HA를 실제로 채우려면 이 숙제값이 아깝지 않다고 판단했다. 물론 사이트마다 스토리지 정책이 다르니, 공유 볼륨을 못 쓰는 곳에선 stateful을 노드 고정으로 도는 조합이 현실적인 절충이 될 것이다.

## 참고

- [Docker Swarm mode overview](https://docs.docker.com/engine/swarm/swarm-mode/)
- [Docker Swarm services](https://docs.docker.com/engine/swarm/services/)
- [Docker Swarm ingress networking](https://docs.docker.com/engine/swarm/ingress/)
- [Dockerfile HEALTHCHECK](https://docs.docker.com/reference/dockerfile/#healthcheck)
- [Galera Cluster crash recovery](https://galeracluster.com/library/documentation/crash-recovery.html)
- [colinmollenhour/mariadb-galera-swarm](https://github.com/colinmollenhour/mariadb-galera-swarm)
- [[Docker Healthcheck 실패 시 컨테이너 재기동 설정]]
