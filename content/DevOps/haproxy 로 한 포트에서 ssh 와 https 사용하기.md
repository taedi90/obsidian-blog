---
title: haproxy 로 한 포트에서 ssh 와 https 사용하기
date: 2023-02-02
draft: false
tags:
  - network
banner: 
cssclasses: 
description: 동일한 포트로 https 프로토콜과 ssh 프로토콜을 함께 사용하는 방법을 알아본다.
permalink: 
aliases: 
completed:
---
## 요약

- haproxy.cfg 파일

```bash
global
  <설정>

defaults
  <설정>


frontend https-front
  mode tcp
  option tcplog
  bind *:443

  tcp-request inspect-delay 5s
  tcp-request content accept if HTTP

  acl client_attempts_ssh payload(0,7) -m bin 5353482d322e30

  use_backend ssh if client_attempts_ssh
  default_backend https

backend ssh
  mode tcp
  server ssh <ssh 서버 아이피>:<ssh 서버 포트>
  timeout server 2h

backend https
  mode tcp
  server https <아이피>:<포트>
```

  

## 이슈

443 포트로 유입되는 요청에 대해서 https 와 ssh 프로토콜을 각기 다른 서버나 포트로 나눠주는 프록시가 필요했다. (포트 부족 이슈)

  

맨 처음 Nginx stream 으로 설정이 가능할지 확인해봤지만, 단순히 TCP/UDP 트래픽을 전달하는 기능만 담당하고 스트림의 실제 내용은 확인하지 않기 때문에 불가능 하다는 결론을 얻었다.

  

## 해결

`haproxy.cfg` 파일에 다음과 같은 내용을 추가했다. “<>” 표시 된 부분은 추가적인 입력이 필요한 부분

```bash
global
  # log 설정
  log stdout format raw local0
  # 백그라운드 모드
  daemon
  # 스레드 수 (nbproc 는 deprecated)
  nbthread 8
  # 스레드 당 최대 연결 수
  maxconn 3000

defaults
  log  	global # global 로그 설정을 따름
  mode 	tcp # tcp | http ...
  option       	tcplog # httplog
  option       	dontlognull # 로그 비대화 방지
  timeout queue 1m # maxconn 도달 시, 503 응답을 보내기 까지의 시간
  timeout connect 10s # backend(real-server) 연결 최대 지연시간
  timeout client 60m # 외부 클라이언트 요청이나 데이터 연결 최대시간
  timeout server 60m # 서버가 데이터를 전송할 떄 연결 최대 시간


frontend https-front
  mode tcp
  option tcplog
  bind *:443

  tcp-request inspect-delay 5s
  tcp-request content accept if HTTP

  # access control list (액세스 제어 규칙 리스트)
  # https://www.haproxy.com/blog/introduction-to-haproxy-acls/
  acl client_attempts_ssh payload(0,7) -m bin 5353482d322e30

  use_backend ssh if client_attempts_ssh
  default_backend https

backend ssh
  mode tcp
  server ssh <ssh 서버 아이피>:<ssh 서버 포트>
  timeout server 2h

backend https
  mode tcp
  server https <아이피>:<포트>
```

  

위에서 눈여겨볼 부분은 `acl client_attempts_ssh payload(0,7) -m bin 5353482d322e30` 으로 구문을 파악해보면

- `payload(0,7)` : 페이로드 첫 7바이트를
- `-m bin` : 16진수 문자열로 취급했을 때
- `5353482d322e30` : 이 16진수 값과 일치하는지 확인

하게 된다.

여기서 `5353482d322e30` 는 ascii 로 변환하면 “SSH-2.0” 이다. SSH 프로토콜 규약에 따라 커넥션이 생성되면 양 측은 무조건 식별 문자열을 송신해야하는데, 이 문자열은 “SSH-2.0” 로 시작하는 것을 활용한 것이다.

  

이후 haproxy 를 재시작하고 443 포트로 https 와 ssh 프로토콜을 각각 요청하면 haproxy 에서 설정한 각기다른 backend 로 트래픽이 전달되는 것을 확인할 수 있다.

  

## 참고

단순히 이 기능만 필요하다면 [sslh](https://github.com/yrutschle/sslh) 라는 애플리케이션이 더 간결할 것 같다.

  

- [https://www.haproxy.com/blog/introduction-to-haproxy-acls/](https://www.haproxy.com/blog/introduction-to-haproxy-acls/)
- [https://www.haproxy.com/documentation/hapee/1-8r1/onepage/#7.1](https://www.haproxy.com/documentation/hapee/1-8r1/onepage/#7.1)
- [https://www.rfc-editor.org/rfc/rfc4253](https://www.rfc-editor.org/rfc/rfc4253)
- [https://gist.github.com/zukka77/a5ddb8d81ef9a82e2ff797e3a578c97e](https://gist.github.com/zukka77/a5ddb8d81ef9a82e2ff797e3a578c97e)