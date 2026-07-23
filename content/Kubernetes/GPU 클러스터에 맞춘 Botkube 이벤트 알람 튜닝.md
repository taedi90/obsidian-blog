---
title: GPU 클러스터에 맞춘 Botkube 이벤트 알람 튜닝
date: 2026-02-24
draft: false
tags:
  - kubernetes
  - botkube
  - slack
  - observability
  - gpu
banner: 
cssclasses: 
description: 노이즈투성이던 클러스터 이벤트 알람을, 크리티컬 사유만 추리고 GPU 파드가 정상적으로 거치는 FailedScheduling을 제외 규칙으로 걸러 실제 조치가 필요한 것만 Slack으로 받도록 다듬은 기록.
permalink: 
aliases: 
completed: true
type:
  - note
---

## 🚀 요약

> [!SUMMARY]
> 클러스터 이벤트가 실시간으로 안 보이는 데다, 막상 알람을 켜니 노이즈가 쏟아졌다. Botkube로 크리티컬한 이벤트 사유만 추리고, GPU 파드가 뜰 때 정상적으로 한 번 거치는 `Insufficient nvidia.com/gpu` 계열 `FailedScheduling`을 메시지 제외 규칙으로 걸러냈다. 여기에 알람 채널과 커맨드 채널을 나누고 환경별로 values를 분리해, "실제로 사람이 봐야 하는 이벤트"만 Slack으로 가게 만들었다.

클러스터에서 뭔가 터졌을 때 그걸 알아채는 경로가 마땅치 않았다. 누가 `kubectl get events`를 쳐야 상황을 알았고, 그마저도 이미 파드가 몇 번 재시작한 뒤였다. 그래서 이벤트를 Slack으로 밀어주는 Botkube를 붙였는데, 기본 설정 그대로 켜니 이번엔 반대 문제가 생겼다. 알람이 너무 많이 왔다. 특히 GPU 파드가 뜰 때마다 스케줄링 실패 알람이 도배됐다. 알람이 많으면 결국 아무도 안 본다. 그래서 "무엇을 보낼지"보다 "무엇을 안 보낼지"를 정하는 쪽으로 튜닝했다.

## 1. 기본 설정의 문제

Botkube의 쿠버네티스 소스를 그냥 켜면 웬만한 이벤트를 다 보내준다. 문제는 그중 대부분이 굳이 알람으로 받을 필요가 없다는 거다. 우리 환경에서 특히 시끄러웠던 건 두 종류였다.

- <b>Unhealthy</b>: readiness/liveness 프로브가 잠깐 실패할 때마다 뜬다. 파드가 뜨는 중이거나 순간적으로 응답이 늦으면 나오는데, 대부분 알아서 정상으로 돌아간다.
- <b>FailedScheduling</b>: 스케줄 가능한 노드를 아직 못 찾았을 때 뜬다. 자원이 붐빌 때 잠깐 나왔다가 배치되면 사라지는 경우가 많다.

이 둘이 섞여 들어오니 정작 봐야 할 `CrashLoopBackOff`나 `OOMKilled`가 파묻혔다. 알람 채널을 열면 스크롤이 한참 내려가는데 정작 조치할 건 안 보이는 상태였다.

## 2. 크리티컬 사유만 추리기

방향은 단순하다. 파드 이벤트 중 <b>실제로 사람이 개입해야 하는 사유(reason)</b>만 include하고, 노이즈성 사유는 exclude한다. `sources` 아래 `botkube/kubernetes` 플러그인의 `resources`에서 파드 타입에만 이벤트 필터를 걸었다.

```yaml
# 파드 이벤트는 "조치가 필요한 사유"만 통과시킨다.
# include 목록에 없는 사유는 애초에 알람으로 오지 않고,
# exclude는 include에 걸리더라도 확실히 빼고 싶은 것들이다.
resources:
  - type: v1/pods
    event:
      reason:
        include:
          - "BackOff"
          - "CrashLoopBackOff"
          - "OOMKilled"
          - "Failed"
          - "Evicted"
          - "FailedMount"
          - "ErrImagePull"
          - "ImagePullBackOff"
        exclude:
          - "Unhealthy"        # 프로브 순간 실패 노이즈
          - "FailedScheduling" # 스케줄 대기 노이즈
```

파드 외에 노드·네임스페이스·PV/PVC·Deployment·StatefulSet·Job 같은 리소스도 소스에 넣되, 이벤트 타입은 `error`로만 좁혔다. 정보성(`normal`) 이벤트까지 받으면 다시 원점이라, 애초에 에러만 구독하도록 했다.

```yaml
event:
  types:
    - error
```

## 3. GPU 파드가 정상적으로 거치는 FailedScheduling

여기가 이 클러스터의 고유한 부분이다. 위에서 `FailedScheduling`을 reason에서 뺐는데, 그것만으로는 부족했다. GPU 파드는 정상적으로 뜨는 경우에도 <b>스케줄링을 한 번 실패하고 시작</b>하기 때문이다.

파드가 `nvidia.com/gpu` 자원을 요청하면, 스케줄러 입장에서 그 순간 할당 가능한 GPU가 없으면 일단 `FailedScheduling`을 낸다. 이유 메시지는 `Insufficient nvidia.com/gpu`다. GPU가 붐비는 클러스터에서는 파드가 큐에서 잠깐 대기했다가 GPU가 나면 배치되는 게 정상 흐름이라, 이 이벤트는 사실상 "지금 GPU 기다리는 중"이라는 상태 표시에 가깝다. 문제 상황이 아니다.

그런데 이걸 그대로 두면 GPU 워크로드를 올릴 때마다 알람이 울린다. GPU 파드가 많은 클러스터에서는 이게 알람의 대부분을 차지했다. reason 필터로 `FailedScheduling`을 이미 뺐지만, 사유 이름만으로 거르면 "정말 스케줄이 안 되는" 진짜 문제까지 같이 사라질 수 있어 찜찜했다. 그래서 사유가 아니라 <b>메시지 내용</b>으로 한 겹 더 걸었다.

```yaml
# 사유(reason)가 아니라 이벤트 메시지 본문으로 거른다.
# "GPU가 부족해서 대기 중"이라는 정상 churn만 콕 집어 제외.
message:
  include:
    - ".*"
  exclude:
    - "Insufficient nvidia.com/gpu" # GPU 파드는 처음 생성 시 FailedScheduling 상태를 거침
```

이렇게 두면 "GPU 대기" 메시지만 빠지고, 그 외 스케줄링 관련 문제는 걸러지지 않는다. 도메인 특성 하나 아는 것만으로 알람 신호대잡음비가 확 올라간 지점이었다. (튜닝의 절반은 이 한 줄이었다고 봐도 될 정도다.)

## 4. 알람 채널과 커맨드 채널 분리

이벤트를 걸러 보내는 것과, 그 채널에서 뭘 할 수 있게 할지는 다른 문제다. Botkube는 소스(알람을 만드는 쪽)와 executor(명령을 실행하는 쪽)를 채널별로 따로 바인딩할 수 있다. 이걸 이용해 채널을 둘로 나눴다.

- <b>알람 전용 채널</b>: 소스(`k8s-critical-events`)만 붙이고, executor는 조회 위주의 기본 도구만 둔다. 알람이 흐르는 채널에서 아무나 클러스터를 조작하면 곤란하니까.
- <b>커맨드 전용 채널</b>: 소스는 아예 비우고(알람 없음), 대신 `helm`·`exec`까지 포함한 관리자용 executor를 붙였다. 알람과 조작을 물리적으로 분리한 셈이다.

```yaml
# 채널별로 소스와 executor를 따로 바인딩한다.
channels:
  'default':               # 알람 전용
    name: 'alarm-prod'
    bindings:
      executors:
        - k8s-default-tools # 조회 위주
      sources:
        - k8s-critical-events
  'cmd':                    # 커맨드 전용
    name: 'cluster-cmd'
    bindings:
      executors:
        - k8s-tools-admin   # helm/exec 포함 관리자용
      sources: []           # 알람은 받지 않음
```

executor 권한은 Botkube가 쓰는 RBAC 그룹(`botkube-plugins-default`)에 묶인다. 소스 플러그인과 kubectl executor 모두 이 그룹 컨텍스트로 동작하도록 `context.rbac.group`을 정적(Static)으로 지정해뒀다. 커맨드 채널에서 실행되는 kubectl이 어느 권한으로 도는지가 이 그룹에 걸린 ClusterRole로 결정되는 구조라, 채널을 나눌 때 권한 경계도 같이 챙길 수 있었다.

## 5. 환경별 values 분리

같은 설정을 개발·검증·운영에 그대로 쓸 수는 없었다. 클러스터 이름도, Slack 채널도, 심지어 어떤 네임스페이스를 볼지도 환경마다 달라서 `values-dev.yaml`·`values-stg.yaml`·`values-prod.yaml`로 나눴다. 필터 로직(reason/message 규칙)은 세 파일에서 동일하게 유지하고, 달라지는 건 아래 정도다.

- `settings.clusterName`: `dev-cluster` / `stg-cluster` / `prod-cluster`. 알람 메시지에 어느 클러스터인지 찍히니 환경 구분에 필요하다.
- Slack 채널명: 환경별 알람 채널을 따로 뒀다.
- 검증 환경에서는 특정 네임스페이스를 아예 이벤트 대상에서 뺐다. 검증망은 배포가 잦아 서비스·운영 네임스페이스의 churn이 심했는데, 이건 알람으로 볼 게 아니라 판단해 `namespaces.exclude`로 제외했다.

```yaml
# 검증 환경 values-stg.yaml: 시끄러운 네임스페이스는 이벤트에서 제외
namespaces:
  include:
    - ".*"
  exclude:
    - "app"
    - "devops"
```

## 6. Slack 토큰 처리

Botkube를 Socket Mode Slack으로 붙이려면 Bot Token(`xoxb-...`)과 App-Level Token(`xapp-...`)이 필요하다. 지금은 이걸 환경별 values에 평문으로 넣어 두고 있는데, values 파일이 리포에 올라가니 좋은 자리는 아니다. 토큰은 Secret으로 빼는 게 맞고, 아직 정리 못 한 숙제로 남아 있다. (이 글의 예시 YAML에서 토큰 값은 전부 `<REDACTED>` 처리했다.)

```yaml
communications:
  'default-group':
    socketSlack:
      enabled: true
      botToken: <REDACTED>  # 지금은 values에 평문, Secret으로 빼는 게 숙제
      appToken: <REDACTED>
```

## 마무리

설치할 때 한 가지 걸렸던 점. Botkube를 `helm upgrade`로 올리면 ConfigMap이 제대로 갱신되지 않는 경우가 있었다. 그래서 설정을 바꿀 때는 `helm delete` 후 재설치하는 쪽으로 굳혔다. 알람 툴이라 잠깐 내려가도 서비스 영향이 없어 이 방식이 마음 편했다.

결과적으로 알람 채널을 열면 이제 `CrashLoopBackOff`·`OOMKilled`처럼 진짜 봐야 할 것만 남았다. GPU 대기 도배가 사라진 것만으로도 채널이 읽을 만해졌다.

## 🔗 참고

- [Botkube Kubernetes source configuration](https://docs.botkube.io/configuration/source/kubernetes)
- [Botkube Kubectl executor](https://docs.botkube.io/configuration/executor/kubectl)
- [Botkube RBAC](https://docs.botkube.io/configuration/rbac)
- [Botkube Slack (Socket Mode) installation](https://docs.botkube.io/installation/socketslack/)
