---
title: flowise OOMKilled — 버전업 후 메모리 부족 장애 분석
date: 2026-07-24
draft: false
tags:
  - kubernetes
  - flowise
  - oomkilled
  - memory
  - troubleshooting
  - helm
  - startup-probe
banner: 
cssclasses: 
description: flowise를 새 버전으로 올렸더니 1Gi 메모리 limit에서 OOMKilled가 났다. startup probe 실패부터 원인 추적, 메모리 상향까지의 과정을 정리한 기록.
permalink: 
aliases: 
completed: true
type:
  - issue
---

## 요약

> [!SUMMARY]
> flowise를 이전 버전에서 새 버전으로 올렸더니 컨테이너가 시작하자마자 OOMKilled로 종료되었다. 메모리 limit이 1Gi였는데 새 버전은 초기화 단계에서 이 한도를 넘겨버렸다. 로그에는 에러 없이 "Auth initialized successfully"까지 기록되고, 그다음 4초 만에 SIGKILL(137)로 종료되었다. startup probe가 500을 반환하는 것을 보고 앱 자체 문제인 줄 알았는데, 원인은 단순히 메모리 부족이었다. limit을 1Gi에서 4Gi로 올려서 해결했다.

## 1. 환경

- Kubernetes + Istio 사이드카 인젝션
- flowise: 앱 차트의 서브차트로 배포
- 배포: Helm 차트 → Helmfile → ArgoCD
- 이전 버전: 정상 동작 (1Gi limit 내)
- 장애 버전: 새 버전 (1Gi limit 초과)
- 서비스명·차트명·버전 번호 등은 가상값으로 바꿔 적는다.

## 2. 이슈

flowise 디플로이먼트가 롤아웃된 후에도 파드가 정상 상태로 돌아오지 않았다. 파드는 `PodInitializing` 단계에 머물렀고, 일단 시작해도 `CrashLoopBackOff`로 빠졌다.

처음에는 여러 원인이 뒤섞여 있었다. 순서대로 풀어가야 했다.

## 3. 해결

### 1. 첫 번째 낚시: 사이드카가 안 뜬다

파드가 `PodInitializing` 단계를 벗어나지 못하고 있었다. 상태를 보니 istio-proxy 사이드카 컨테이너에 `Container ID`도, `Image ID`도 없었다. 아직 kubelet이 컨테이너를 생성하지 않은 상태였다.

원인은 flowise 메인 컨테이너의 이미지 pull이 지연되는 것이었다. `Pulling image` 이벤트는 기록되었지만 그 이후에 `Pulled`, `Created`, `Started`가 나타나지 않았다. 이미지 크기가 1.14GB라서 pull에 2분이 걸렸고, 그동안 사이드카는 대기 상태로 머물렀다.

> [!NOTE]
> Istio 사이드카는 메인 컨테이너가 최소한 생성되어야 시작된다. 메인 컨테이너 이미지 pull이 지연되면 사이드카도 함께 멈춘다. "사이드카가 안 뜬다"가 진짜 원인이 아니라, 메인 컨테이너 pull이 늦어진 것뿐일 수 있다.

### 2. 두 번째 낚시: startup probe 500

이미지 pull이 끝나고 컨테이너가 시작되었다. 그런데 이번에는 startup probe가 500을 반환했다.

```
Startup probe failed: HTTP probe failed with statuscode: 500
```

500이면 앱 자체에 문제가 있는가 싶었다. 로그를 보니 flowise가 초기화를 시작하기는 했다.

```
Data Source initialized
Database migrations completed
Identity Manager initialized
Nodes pool initialized
Encryption key set
Auth initialized successfully
```

여기까지는 정상이었다. 그런데 "Auth initialized successfully" 이후에 "listening" 로그가 기록되지 않았다. 그리고 파드가 `CrashLoopBackOff`로 빠졌다. 재시작 횟수는 2, 3회씩 계속 늘어났다.

> [!IMPORTANT]
> startup probe 500과 "listening" 로그 부재가 겹치면 보통 앱 자체 버그를 의심한다. 하지만 이번에는 달랐다. 앱이 에러를 낸 것이 아니라, 커널이 프로세스를 종료한 것이었다. 로그에 에러가 없다는 사실이 오히려 단서가 되었다.

### 3. 진짜 원인: OOMKilled

파드의 마지막 종료 상태를 확인하니 답이 있었다.

```
exitCode: 137
reason: OOMKilled
```

exitCode 137은 SIGKILL을 의미한다. 커널이 프로세스를 종료했고, reason은 `OOMKilled`다. 메모리 limit(1Gi)을 넘겼기 때문에 커널이 강제로 종료한 것이다.

타임라인을 재구성하면 이렇다.

1. 컨테이너 시작
2. 초기화 완료: Data Source, DB migrations, Identity, Nodes pool, Encryption, Auth (약 2초)
3. "Auth initialized successfully" 로그 출력
4. 이후 약 4초 더 실행
5. 커널이 OOMKiller를 발동시켜 SIGKILL로 종료 (총 19초)

총 19초 만에 종료되었다. "Auth initialized"까지는 성공했지만, HTTP 서버가 listening 상태가 되기 전에 메모리 사용량이 limit을 넘겨서 종료된 것이다. 그래서 startup probe가 500을 반환했다. 앱이 응답할 수 있는 상태가 되기도 전에 종료되었기 때문이다.

> [!NOTE]
> 이전 버전은 1Gi 안에서 정상 동작했다. 새 버전은 초기화 단계(정확히는 Auth 이후 HTTP 서버 시작 단계)에서 메모리 사용량이 1Gi를 넘겼다. 버전업하면서 메모리 풋프린트가 커진 것이다. 이런 변화는 릴리스 노트에 명시되지 않는 경우가 대부분이라, 배포 후 장애로 발견하게 된다.

### 4. 해결: 메모리 상향

배포 차트의 flowise 서브차트에서 리소스를 조정했다.

```yaml
# flowise 서브차트 values.yaml
# 이전: request 512Mi, limit 1Gi
# 이후: request 1Gi, limit 4Gi
resources:
  requests:
    cpu: 100m
    memory: 1Gi    # 512Mi → 1Gi
  limits:
    cpu: 2000m
    memory: 4Gi   # 1Gi → 4Gi
```

request를 limit의 1/4 비율(1Gi/4Gi)로 맞췄다. request를 1Gi로 올린 이유는, limit 4Gi에 비해 request가 너무 낮으면 스케줄링은 되지만 실제로는 메모리 부족으로 종료되는 상황이 반복될 수 있기 때문이다. request는 보장되는 최소 자원이므로, 앱이 안정적으로 동작하기 위한 최소선을 1Gi로 잡았다.

CPU 값은 그대로 두었다(100m request / 2000m limit). 이번 장애는 CPU와 무관했다.

### 5. 이슈 트래킹과 PR

내부 이슈 트래커에 장애를 등록하고, 배포 차트에 PR을 올렸다. PR이 머지되면 GitOps로 배포되는 구조이므로, 메모리 수정이 포함된 상태로 배포되었다.

## 4. 확인

수정 후 flowise 새 버전이 정상적으로 `Running` 상태로 돌아왔다. "Auth initialized successfully" 이후에 "listening" 로그가 기록되었고, startup probe가 통과했다. 재시작 없이 안정적으로 동작했다.

> [!IMPORTANT]
> 이번 장애의 교훈은 두 가지다. 첫째, startup probe 500이 앱 버그가 아니라 OOM일 수 있다는 점이다. 로그에 에러가 없는 "조용한 종료"는 OOMKilled를 의심해야 한다. 둘째, 버전업 후 메모리 풋프린트 변화는 릴리스 노트에 기록되지 않는 경우가 많다. 이전 버전에서 1Gi로 충분했더라도 새 버전에서는 부족할 수 있으므로, 버전업하는 서비스의 리소스 limit은 여유 있게 잡는 것이 안전하다.
