---
title: HPA와 VPA, 무엇을 선택해야 할까?
date: 2025-07-17
draft: false
tags:
  - kubernetes
  - autoscaling
  - devops
  - hpa
  - vpa
banner: 
cssclasses: 
description: HPA는 파드 개수를, VPA는 파드 리소스를 조절한다. 둘의 차이와 함께 쓸 때 조심할 점.
permalink: 
aliases: 
completed: true
type:
  - note
---

> [!SUMMARY]
> HPA(Horizontal Pod Autoscaler)는 파드 개수를 조절해 스케일 아웃/인 하고, VPA(Vertical Pod Autoscaler)는 파드의 리소스 할당량(CPU/메모리)을 조절해 스케일 업/다운 한다. 보통 HPA는 실시간 트래픽 대응에, VPA는 리소스 최적화에 쓴다. 다만 같은 리소스 메트릭에 둘을 함께 걸면 충돌하니 주의해야 한다.

## 1. 개요

쿠버네티스로 애플리케이션을 운영하다 보면 트래픽이나 작업량이 변하고, 그에 맞춰 필요한 리소스도 계속 달라진다. 매번 수동으로 맞추는 건 번거롭고 실수도 잦다. 이걸 자동화하는 게 오토스케일러(autoscaler)고, 파드 단위에서는 HPA와 VPA 두 가지가 있다.

- HPA(Horizontal Pod Autoscaler): 파드 개수를 늘리고 줄인다(스케일 아웃/인).
- VPA(Vertical Pod Autoscaler): 개별 파드에 할당하는 CPU/메모리를 늘리고 줄인다(스케일 업/다운).

방향이 다르니 쓰는 상황도 다르다. 둘을 언제 쓰고, 함께 쓸 때 뭘 조심해야 하는지 정리했다.

## 2. HPA (Horizontal Pod Autoscaler)

### 2-1. 특징

HPA는 파드 개수를 수평으로 조절한다. CPU·메모리 사용률이나 사용자 정의 메트릭(custom metric)을 기준으로 복제본(replica) 수를 자동으로 바꾼다.

- <b>메트릭 기반</b>: CPU·메모리 사용률뿐 아니라 초당 요청 수(RPS), 메시지 큐 길이 같은 지표도 쓸 수 있다. 단 CPU·메모리 외의 지표는 별도의 메트릭 어댑터(custom/external metrics API)를 붙여야 한다.
- <b>빠른 반응</b>: 부하가 늘면 파드를 늘려 여러 파드에 분산하므로, 갑작스러운 트래픽 증가에도 대응이 된다.

### 2-2. 동작 원리

1. HPA 컨트롤러가 메트릭 서버(Metrics Server)에서 파드의 리소스 사용률을 주기적으로 읽는다.
2. 현재 사용률을 HPA에 설정한 목표 사용률과 비교한다.
3. `필요한 파드 수 = ceil(현재 파드 수 × 현재 사용률 / 목표 사용률)` 으로 계산한다.
4. 계산 결과를 디플로이먼트나 스테이트풀셋의 `scale` 서브리소스에 반영해 파드 수를 조절한다.

기본 동기화 주기는 15초다. 비율이 목표에서 10% 안쪽이면(기본 tolerance) 스케일을 건드리지 않는다.

### 2-3. 사용 예시

아래는 CPU 평균 사용률이 70%를 넘으면 파드를 최대 10개까지 늘리는 HPA 설정이다.

```yaml
# web-app 디플로이먼트를 대상으로 하는 HPA 설정
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: web-app-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: web-app
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
```

`web-app`은 최소 2개의 파드를 유지하다가, 부하가 늘면 자동으로 파드를 늘린다.

## 3. VPA (Vertical Pod Autoscaler)

### 3-1. 특징

VPA는 개별 파드의 리소스 요청(`requests`)과 한도(`limits`)를 수직으로 조절한다. 실제 사용량을 분석해 파드마다 CPU·메모리 할당량을 맞춰, 불필요하게 잡아둔 리소스를 줄인다.

가장 큰 특징이자 제약은, 리소스를 바꿀 때 파드를 지웠다 다시 만든다는 점이다. 그래서 변경되는 순간에 서비스가 잠깐 끊길 수 있다. (최근 버전에는 파드를 재시작하지 않고 자원을 조정하는 in-place 모드가 추가됐지만, 아직 자리를 잡아가는 중이다.)

### 3-2. 동작 모드 (updateMode)

- <b>Off</b>: 실제로 바꾸지 않고 권장값만 계산해 둔다. dry-run이나 사용 패턴 분석용.
- <b>Initial</b>: 파드가 처음 생성될 때만 권장 리소스를 적용하고, 이후 파드가 도는 동안에는 건드리지 않는다.
- <b>Recreate</b>: 생성 시점에 적용하고, 파드가 도는 중에도 파드를 지웠다 다시 만들어 리소스를 갱신한다.
- <b>Auto</b>: 사용 가능한 방법으로 자동 적용한다. 현재는 Recreate와 동일하게 동작한다.

> [!NOTE]
> 개인적으로는 `Off` 모드로 애플리케이션의 리소스 사용 패턴을 먼저 파악한 뒤, 그 결과로 `requests`·`limits`를 수동으로 잡거나 `Auto`로 넘기는 방식을 선호한다.

### 3-3. 사용 예시

아래는 `database` 디플로이먼트에 VPA를 `Auto` 모드로 거는 예시다.

```yaml
# database 디플로이먼트를 대상으로 하는 VPA 설정
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: database-vpa
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: database
  updatePolicy:
    updateMode: "Auto" # 자동으로 리소스 변경 및 파드 재생성
  resourcePolicy:
    containerPolicies:
    - containerName: database
      maxAllowed:
        cpu: "2"
        memory: "4Gi"
      minAllowed:
        cpu: "100m"
        memory: "128Mi"
```

`database` 파드는 적절한 리소스를 할당받지만, 변경될 때 재시작될 수 있다는 걸 감안해야 한다.

## 4. HPA vs VPA 비교

| 구분 | HPA (Horizontal Pod Autoscaler) | VPA (Vertical Pod Autoscaler) |
| :--- | :--- | :--- |
| <b>확장 방향</b> | 수평 (파드 개수 조절) | 수직 (파드 리소스 조절) |
| <b>핵심 역할</b> | 트래픽 변동 대응 | 리소스 사용량 최적화 |
| <b>적용 방식</b> | 실시간으로 파드 수 변경 | 파드 재생성 후 리소스 변경 |
| <b>주요 메트릭</b> | CPU, 메모리, 사용자 정의 메트릭 | 과거 리소스 사용 패턴 |
| <b>가용성</b> | 높음 (다중 파드로 부하 분산) | 낮음 (파드 재생성 중 순간적 중단) |
| <b>적합한 워크로드</b> | 웹 서버, 마이크로서비스 | 데이터베이스, 배치(batch) 작업 |

## 5. HPA와 VPA 함께 쓰기

> [!IMPORTANT]
> 같은 리소스 메트릭(CPU·메모리)에 HPA와 VPA를 함께 걸면 안 된다. HPA는 파드 수를, VPA는 개별 파드 리소스를 동시에 늘리려 하면서 서로 충돌해 예측하기 어려운 동작이 나오기 때문이다. 다만 HPA를 사용자 정의(custom)·외부(external) 메트릭에 걸면 VPA와 함께 쓸 수 있다.

그래서 굳이 조합한다면 이렇게 나눈다.

1. <b>HPA</b>는 <b>사용자 정의 메트릭</b>(초당 요청 수, 큐 길이 등)으로 파드 수를 조절한다.
2. <b>VPA</b>는 <b>CPU·메모리</b>로 개별 파드 리소스를 최적화한다.
3. 여기에 <b>클러스터 오토스케일러(Cluster Autoscaler)</b>를 더하면, 전체 노드 리소스가 부족할 때 노드까지 늘릴 수 있다.

## 6. 워크로드별 선택 기준

선택은 워크로드 성격에 달렸다.

- 가용성이 중요하고 트래픽 예측이 어려운 웹 서비스라면 HPA.
- 사용 패턴은 안정적인데 할당량 최적화가 필요한 데이터베이스나 배치 작업이라면 VPA.

처음엔 HPA로 안정성을 확보하고, VPA는 `Off` 모드로 사용 패턴을 지켜본 뒤 점진적으로 최적화하는 편이 무난하지 않을까 싶다.

## 7. 참고 링크

- [Kubernetes HPA 공식 문서](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/)
- [Kubernetes VPA (autoscaler)](https://github.com/kubernetes/autoscaler/tree/master/vertical-pod-autoscaler)
