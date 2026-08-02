---
title: 도커 CLI 원격 서버 접근
date: 2023-08-05
draft: true
tags:
  - docker
  - ssh
  - cli
  - devops
description: 로컬 머신에서 SSH를 통해 원격 서버의 Docker 디몬을 제어하는 방법을 알아봅니다. Docker Context를 사용하여 여러 원격 환경을 효율적으로 관리하는 과정을 다룹니다.
type:
  - issue
---

## 요약

> [!SUMMARY]
> 로컬 머신의 Docker CLI에서 SSH 프로토콜을 사용하여 원격 서버의 Docker를 직접 제어할 수 있다. `docker context`를 생성하면, 매번 원격 서버에 접속할 필요 없이 로컬 환경에서 원격지의 컨테이너를 간편하게 관리할 수 있다.

## 1. 이슈

여러 원격 서버의 Docker 컨테이너를 관리해야 할 때, 각 서버에 <b>SSH(Secure Shell)</b>로 일일이 접속하여 Docker 명령어를 실행하는 것은 번거로운 과정이었다. 특히 로컬 개발 환경에서 원격 서버의 컨테이너 상태를 빠르게 확인하거나 로그를 보고 싶을 때, 매번 터미널을 전환하고 로그인하는 과정이 개발 흐름을 끊는다고 느꼈다.

결국 로컬 터미널에서 원격 서버의 Docker를 직접 제어할 방법이 필요했다.

## 2. 해결

이 문제의 해결책은 Docker의 `context` 기능을 활용하는 것이다. `docker context`는 특정 Docker 디몬(daemon)을 가리키는 설정의 집합으로, 이를 통해 로컬 CLI에서 원격 Docker 호스트로 손쉽게 전환하며 작업할 수 있다. SSH를 이용한 원격 제어는 별도의 TCP 포트를 외부에 노출할 필요가 없어 보안적으로도 이점이 있다.

### 1. SSH 키 인증 설정 (선행 작업)

원격 서버에 비밀번호 없이 SSH로 접속할 수 있도록 키 기반 인증 설정이 선행되어야 한다. 로컬 머신의 `ssh-agent`에 비공개 키를 등록해두면 매번 키 암호를 입력하는 번거로움을 줄일 수 있다.

```bash
# ssh-agent를 실행하고 환경 변수를 현재 셸에 적용한다.
eval $(ssh-agent)

# ssh-agent에 비공개 키를 추가한다.
ssh-add ~/.ssh/id_rsa

# 등록된 키 목록을 확인한다.
ssh-add -l
```

> [!INFO]
> 물론 로컬의 공개 키(`~/.ssh/id_rsa.pub`)가 원격 서버의 `~/.ssh/authorized_keys` 파일에 등록되어 있어야 한다는 것은 기본이다.

### 2. Docker Context 생성

이제 `docker context create` 명령어를 사용하여 원격 서버를 가리키는 새로운 컨텍스트를 생성한다.

```bash
# docker context create [새 컨텍스트 이름] --docker "host=ssh://[사용자명]@[호스트 주소]:[포트]"
docker context create remote-server --docker "host=ssh://user@example.com:22"
```

- `remote-server`: 새로 생성할 컨텍스트의 이름이다. 식별하기 쉬운 이름으로 지정하면 된다.
- `host=ssh://...`: 원격 Docker 디몬의 접속 정보를 지정한다. `ssh://` 프로토콜을 사용하고, 사용자명, 호스트 주소, SSH 포트 번호를 차례로 입력한다.

### 3. Docker Context 사용 및 확인

컨텍스트 생성이 완료되면, `docker context use` 명령어로 사용하려는 컨텍스트로 전환할 수 있다.

```bash
# 생성한 remote-server 컨텍스트로 전환한다.
docker context use remote-server

# 현재 설정된 컨텍스트 목록과 사용 중인 컨텍스트를 확인한다.
docker context ls
NAME                TYPE                DESCRIPTION                               DOCKER ENDPOINT                             KUBERNETES ENDPOINT   ORCHESTRATOR
default *           moby                Current DOCKER_HOST based configuration   unix:///var/run/docker.sock
remote-server       docker                                                        host=ssh://user@example.com:22
```

이제 로컬 터미널에서 실행하는 모든 `docker` 명령어는 `remote-server` 컨텍스트, 즉 원격 서버의 Docker 디몬에게 전달된다.

> [!IMPORTANT]
> 처음 원격지에 접속할 때는 호스트 키를 신뢰할지 묻는 메시지가 나타날 수 있다. `yes`를 입력하여 `known_hosts` 파일에 해당 호스트의 정보를 등록해야 정상적으로 연결된다.
> ```
> The authenticity of host '[example.com]:22 ([211.192.34.5]:22)' can't be established.
> ...
> Are you sure you want to continue connecting (yes/no/[fingerprint])? yes
> ```

## 3. 확인

설정이 올바르게 완료되었는지 확인하는 것은 간단하다.

```bash
# 원격 서버의 컨테이너 목록을 조회한다.
docker ps

# 원격 서버의 이미지 목록을 조회한다.
docker images
```

위 명령어들의 실행 결과가 원격 서버의 Docker 정보와 일치한다면 성공적으로 설정된 것이다.

모든 원격 작업을 마친 후에는 아래 명령어로 다시 기본 `default` 컨텍스트로 돌아오는 것이 좋다.

```bash
docker context use default
```

> [!NOTE]
> Powerlevel10k와 같은 터미널 테마를 사용한다면, 현재 활성화된 Docker 컨텍스트를 프롬프트에 표시하도록 설정할 수 있다. 이를 통해 실수로 다른 환경에서 명령을 실행하는 것을 방지할 수 있다.

## 참고

- [VSCode Docs: Developing inside a container on a remote Docker host](https://code.visualstudio.com/docs/containers/ssh)
- [Docker Docs: Configure remote access for Docker daemon](https://docs.docker.com/config/daemon/remote-access/)
- [Powerlevel10k Issue: How to show docker context](https://github.com/romkatv/powerlevel10k/issues/1485)
