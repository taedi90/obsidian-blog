---
title: Docker Healthcheck 실패 시 컨테이너 재기동 설정
date: 2024-12-10
draft: false
tags:
  - docker
  - infra
banner: 
cssclasses: 
description: 
permalink: 
aliases: 
completed:
---

## 📝 요약
> [!summary]
> - 도커 Healthcheck 옵션은 컨테이너의 상태를 체크만 할 수 있을 뿐 컨테이너 재기동에는 관여하지 않는다.  
> - 때문에 Auto healing 을 위해서는 Kubernetes 나 swarm mode 와 같은 오케스트레이션 도구를 사용하는 것이 좋다.
> - 부득이 도커로 Auto healing 을 구성해야 한다면 Healthcheck 스크립트에 비정상적인 컨테이너의 프로세스를 종료하는 로직을 추가하는 것을 고려해볼 수 있다.


## ⚙️ 환경
- Docker Engine : 26.1.3
## 💬 이슈
Docker Compose 의 Healthcheck 옵션을 사용하면 상태 이상에 빠진 컨테이너를 확인할 수는 있지만, 단순히 `unhealthy` 로 표시만 될 뿐 컨테이너가 자동으로 재기동 되지 않는다. 컨테이너 재기동을 위해서는 Kubernetes 나 swarm mode 와 같이 오케스트레이션 툴을 사용하는 것이 가장 깔끔한 방법 일테지만 언제나 그렇듯 인프라 구성은 항상 내맘대로 할 수 없는걸..  
때문에 Docker 환경에서 컨테이너가 Healthcheck 실패 시 Auto healing 맛이라도 살짝 낼 수 있는 방법을 알아봤다.  

## 🧗 해결
방법은 크게 두가지로 생각해볼 수 있었다.
1. 컨테이너 외부(호스트)에서 unhealty 상태의 컨테이너를 cron 등으로 모니터하고 재기동 하는 방법
2. Healthcheck 스크립트 내부에서 fail 발생 시 컨테이너 내부의 프로세스를 kill 하는 방법  

1번 방식이 바람직해 보이긴 했지만 Healthcheck 설정 외에 호스트 작업 또한 필요하기 때문에 관리 포인트가 나뉘게 되는 불편함이 있어 간결하게 2번을 선택했다.  

```yaml
restart: unless-stopped
healthcheck:
  interval: 5m
  timeout: 10m
  test:
    [
      "CMD-SHELL",
      "PORT=8080 bash -c 'for run in {1..5}; do \
        if (curl -s -f http://127.0.0.1:$${PORT}/health) | grep -q -E \"\\\"status\\\"\\s*:\\s*\\\"UP\\\"\"; then \
		  echo -n Healthcheck success; \
		  exit 0; \
        fi; \
        sleep 60s; \
      done && 
      echo -n Healthcheck failed &&
      kill -s 15 -1 && (sleep 10s; kill -s 9 -1)'"
    ]
```

- `bash -c` : sh 에서는 일부 명령이 제대로 동작하지 않을 수 있기 때문에 명시적으로 bash 쉘을 사용한다.
- `for run in {1..5}` : 1에서 5까지 총 5회 반복 (retry count)
- `if (curl -s -f http://127.0.0.1:8080/health) | grep -q -E \"\\\"status\\\"\\s*:\\s*\\\"UP\\\"\"` : 응답에 `"status" : "UP"` 이라는 문자열이 포함되어 있을 경우에만 Healthcheck 에 성공한 것으로 간주한다.
- `sleep 60s` : Healthcheck 에 실패할 경우 60초 동안 대기 (retry interval)
- `kill -s 15 -1 && (sleep 10s; kill -s 9 -1)` : 10회 시도 모두 실패했을 경우 모든 프로세스에 SIGTERM(15) 신호를 전송해 종료 시도 && 이후 종료되지 않은 프로세스를 강제 종료 (SIGKILL, 9)  

만약 healthcheck api 의 HTTP status code 만 체크하면 된다면 if 문을 아래와 같이 수정하면 된다.  
```bash
if (curl -s -f http://127.0.0.1:$${PORT}/health); then
```

## 🎸 기타
그런데 이렇게 하면 컨테이너가 재기동 된 사유를 추적하기 어렵기 때문에 애플리케이션 로그 또는 스크립트 동작 간에 로그를 남길 수 있도록 조치를 하는 것이 필요해 보인다.  

## 🚀 참고
- [https://stackoverflow.com/questions/47088261/restarting-an-unhealthy-docker-container-based-on-healthcheck](https://stackoverflow.com/questions/47088261/restarting-an-unhealthy-docker-container-based-on-healthcheck)
- [https://docs.docker.com/reference/dockerfile/#healthcheck](https://docs.docker.com/reference/dockerfile/#healthcheck)
