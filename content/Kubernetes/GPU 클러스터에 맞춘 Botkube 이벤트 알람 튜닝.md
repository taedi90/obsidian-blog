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

## 요약

> [!SUMMARY]
> 클러스터 이벤트가 실시간으로 보이지 않는 데다, 막상 알람을 켜니 노이즈가 쏟아졌다. Botkube로 크리티컬한 이벤트 사유만 추리고, GPU 파드가 뜰 때 정상적으로 한 번 거치는 `Insufficient nvidia.com/gpu` 계열 `FailedScheduling`을 메시지 제외 규칙으로 걸러냈다. 여기에 알람 채널과 커맨드 채널을 나누고 환경별로 values 파일을 분리해서, "실제로 사람이 확인해야 하는 이벤트"만 Slack으로 전달되도록 만들었다.

클러스터에서 장애가 발생했을 때 그것을 인지하는 경로가 마땅치 않았다. 누군가 `kubectl get events`를 실행해야 상황을 알 수 있었고, 그마저도 이미 파드가 몇 번 재시작한 뒤였다. 그래서 이벤트를 Slack으로 전달하는 Botkube를 도입했는데, 기본 설정 그대로 켜니 이번에는 반대 문제가 생겼다. 알람이 너무 많이 왔다. 특히 GPU 파드가 뜰 때마다 스케줄링 실패 알람이 채널을 가득 채웠다. 알람이 많으면 결국 아무도 확인하지 않는다. 그래서 "무엇을 보낼지"보다 "무엇을 보내지 않을지"를 정하는 방향으로 튜닝했다.

## 1. 기본 설정의 문제

Botkube의 쿠버네티스 소스를 그냥 활성화하면 웬만한 이벤트를 모두 전송한다. 문제는 그중 대부분이 굳이 알람으로 받을 필요가 없다는 점이다. 우리 환경에서 특히 시끄러웠던 것은 아래 두 종류였다.

- <b>Unhealthy</b>: readiness/liveness 프로브가 잠깐 실패할 때마다 발생한다. 파드가 시작되는 중이거나 순간적으로 응답이 늦을 때 나타나는데, 대부분은 저절로 정상으로 돌아온다.
- <b>FailedScheduling</b>: 스케줄 가능한 노드를 아직 찾지 못했을 때 발생한다. 자원이 붐빌 때 잠깐 나타났다가 배치되면 사라지는 경우가 많다.

이 두 가지가 섞여 들어오니 정작 확인해야 할 `CrashLoopBackOff`나 `OOMKilled`가 묻혔다. 알람 채널을 열면 스크롤이 한참 내려가는데 정작 조치할 항목은 보이지 않는 상태였다.

## 2. 크리티컬 사유만 추리기

방향은 단순하다. 파드 이벤트 중 <b>실제로 사람이 개입해야 하는 사유(reason)</b>만 include 목록에 넣고, 노이즈성 사유는 exclude 목록으로 제외한다. `sources` 아래 `botkube/kubernetes` 플러그인의 `resources`에서 파드 타입에만 이벤트 필터를 적용했다.

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

파드 외에 노드·네임스페이스·PV/PVC·Deployment·StatefulSet·Job 같은 리소스도 소스에 포함하되, 이벤트 타입은 `error`만 받도록 좁혔다. 정보성(`normal`) 이벤트까지 받으면 다시 원점으로 돌아가므로, 애초에 에러만 구독하도록 했다.

```yaml
event:
  types:
    - error
```

## 3. GPU 파드가 정상적으로 거치는 FailedScheduling

여기가 이 클러스터의 고유한 부분이다. 앞에서 `FailedScheduling`을 reason 필터에서 제외했지만, 그것만으로는 부족했다. GPU 파드는 정상적으로 기동하는 경우에도 <b>스케줄링을 한 번 실패한 후에 시작</b>하기 때문이다.

파드가 `nvidia.com/gpu` 자원을 요청하면, 스케줄러 입장에서 그 순간 할당 가능한 GPU가 없으면 일단 `FailedScheduling` 이벤트를 발생시킨다. 이유 메시지는 `Insufficient nvidia.com/gpu`다. GPU가 붐비는 클러스터에서는 파드가 큐에서 잠깐 대기했다가 GPU가 확보되면 배치되는 것이 정상적인 흐름이므로, 이 이벤트는 "지금 GPU를 기다리는 중"이라는 상태 표시에 가깝다. 문제 상황이 아니다.

그런데 이것을 그대로 두면 GPU 워크로드를 올릴 때마다 알람이 울린다. GPU 파드가 많은 클러스터에서는 이것이 알람의 대부분을 차지했다. reason 필터로 `FailedScheduling`을 이미 제외했지만, 사유 이름만으로 걸러내면 "정말 스케줄이 되지 않는" 진짜 문제까지 함께 사라질 수 있어 불안했다. 그래서 사유가 아니라 <b>메시지 내용</b>으로 한 겹 더 필터를 걸었다.

```yaml
# 사유(reason)가 아니라 이벤트 메시지 본문으로 거른다.
# "GPU가 부족해서 대기 중"이라는 정상 churn만 콕 집어 제외.
message:
  include:
    - ".*"
  exclude:
    - "Insufficient nvidia.com/gpu" # GPU 파드는 처음 생성 시 FailedScheduling 상태를 거침
```

이렇게 설정하면 "GPU 대기" 메시지만 빠지고, 그 외 스케줄링 관련 문제는 걸러지지 않는다. 도메인 특성 하나만 알아도 알람의 신호 대 잡음 비가 크게 올라가는 지점이었다. 튜닝의 절반은 이 한 줄이었다고 봐도 될 정도다.

## 4. 알람 채널과 커맨드 채널 분리

이벤트를 걸러서 보내는 것과, 그 채널에서 무엇을 할 수 있게 할지는 다른 문제다. Botkube는 소스(알람을 만드는 쪽)와 executor(명령을 실행하는 쪽)를 채널별로 따로 바인딩할 수 있다. 이 기능을 이용해 채널을 둘로 나누었다.

- <b>알람 전용 채널</b>: 소스(`k8s-critical-events`)만 연결하고, executor는 조회 위주의 기본 도구만 둔다. 알람이 흐르는 채널에서 아무나 클러스터를 조작하면 곤란하기 때문이다.
- <b>커맨드 전용 채널</b>: 소스는 아예 비워 두고(알람 없음), 대신 `helm`·`exec`까지 포함한 관리자용 executor를 연결했다. 알람과 조작을 물리적으로 분리한 셈이다.

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

executor 권한은 Botkube가 사용하는 RBAC 그룹(`botkube-plugins-default`)에 묶인다. 소스 플러그인과 kubectl executor 모두 이 그룹 컨텍스트로 동작하도록 `context.rbac.group`을 정적(Static)으로 지정해 두었다. 커맨드 채널에서 실행되는 kubectl이 어떤 권한으로 동작하는지는 이 그룹에 연결된 ClusterRole로 결정되는 구조이므로, 채널을 나누면서 권한 경계도 함께 확보할 수 있었다.

## 5. 환경별 values 분리

같은 설정을 개발·검증·운영에 그대로 사용할 수는 없었다. 클러스터 이름도, Slack 채널도, 심지어 어떤 네임스페이스를 감시할지도 환경마다 달라서 `values-dev.yaml`·`values-stg.yaml`·`values-prod.yaml`로 나누었다. 필터 로직(reason/message 규칙)은 세 파일에서 동일하게 유지하고, 달라지는 부분은 아래 정도다.

- `settings.clusterName`: `dev-cluster` / `stg-cluster` / `prod-cluster`. 알람 메시지에 어느 클러스터인지 표시되므로 환경 구분에 필요하다.
- Slack 채널명: 환경별 알람 채널을 따로 두었다.
- 검증 환경에서는 특정 네임스페이스를 아예 이벤트 대상에서 제외했다. 검증 환경은 배포가 잦아 서비스와 운영 네임스페이스의 변동(churn)이 심했는데, 이것은 알람으로 볼 내용이 아니라고 판단하여 `namespaces.exclude`로 제외했다.

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

Botkube를 Socket Mode Slack으로 연결하려면 Bot Token(`xoxb-...`)과 App-Level Token(`xapp-...`)이 필요하다. 지금은 이것을 환경별 values 파일에 평문으로 넣어 두고 있는데, values 파일이 저장소에 올라가므로 좋은 위치는 아니다. 토큰은 Secret으로 분리하는 것이 맞고, 아직 정리하지 못한 과제로 남아 있다. (이 글의 예시 YAML에서 토큰 값은 모두 `<REDACTED>` 처리했다.)

```yaml
communications:
  'default-group':
    socketSlack:
      enabled: true
      botToken: <REDACTED>  # 지금은 values에 평문, Secret으로 빼는 게 숙제
      appToken: <REDACTED>
```

## 7. 마무리

설치 과정에서 한 가지 어려움이 있었다. Botkube를 `helm upgrade`로 업그레이드하면 ConfigMap이 제대로 갱신되지 않는 경우가 있었다. 그래서 설정을 변경할 때는 `helm delete` 후 재설치하는 방식으로 정착했다. 알람 도구라서 잠깐 중단되어도 서비스 영향이 없으므로 이 방식이 편했다.

결과적으로 알람 채널을 열면 이제 `CrashLoopBackOff`·`OOMKilled`처럼 진짜 확인해야 할 이벤트만 남았다. GPU 대기 알람 반복이 사라진 것만으로도 채널이 읽을 만해졌다.

## 참고

- [Botkube Kubernetes source configuration](https://docs.botkube.io/configuration/source/kubernetes)
- [Botkube Kubectl executor](https://docs.botkube.io/configuration/executor/kubectl)
- [Botkube RBAC](https://docs.botkube.io/configuration/rbac)
- [Botkube Slack (Socket Mode) installation](https://docs.botkube.io/installation/socketslack/)
