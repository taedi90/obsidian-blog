---
title: HPA와 VPA, 무엇을 선택해야 할까?
date: 2025-07-17
draft: true
tags:
  - kubernetes
  - autoscaling
  - devops
  - hpa
  - vpa
banner: 
cssclasses: 
description: 애플리케이션의 부하에 따라 리소스를 유연하게 조절하는 쿠버네티스의 핵심 기능, HPA와 VPA의 차이점을 비교하고 올바른 사용 전략을 알아본다.
permalink: 
aliases: 
completed: true
type:
  - note
---

> [!SUMMARY]
> HPA(Horizontal Pod Autoscaler)는 파드 개수를 조절하여 스케일 아웃/인하고, VPA(Vertical Pod Autoscaler)는 파드의 리소스 할당량(CPU/Memory)을 조절하여 스케일 업/다운한다. 두 방식은 함께 사용할 때 주의가 필요하며, 보통 HPA는 실시간 트래픽 대응에, VPA는 리소스 최적화에 사용된다.

## 1. 개요

쿠버네티스 환경에서 애플리케이션을 운영하다 보면, 트래픽이나 작업량의 변화에 따라 필요한 리소스의 양도 계속해서 변하게 된다. 이런 변화에 수동으로 대응하는 것은 비효율적이고 실수가 발생하기 쉽다. 그래서 쿠버네티스는 <b>자동 확장(Auto Scaling)</b>이라는 강력한 기능을 제공하는데, 그 중심에는 HPA와 VPA가 있다.

HPA(Horizontal Pod Autoscaler)와 VPA(Vertical Pod Autoscaler)는 애플리케이션의 리소스 사용량에 따라 자동으로 파드의 개수를 늘리거나(Scale-out) 개별 파드에 할당된 리소스를 늘리는(Scale-up) 방식으로 동작한다. 이 두 가지 방식의 차이점을 명확히 이해하고 상황에 맞게 사용하는 것이 안정적인 클러스터 운영의 핵심이라고 할 수 있다.

## 2. HPA (Horizontal Pod Autoscaler)

### 2-1. 정의와 특징

HPA는 <b>파드(Pod)의 개수를 수평적으로 확장</b>하는, 즉 스케일 아웃(Scale-out)과 스케일 인(Scale-in)을 자동화하는 기능이다. CPU나 메모리 사용률, 또는 외부 시스템으로부터 받은 사용자 정의 메트릭(Custom Metric)을 기준으로 파드의 복제본(replica) 수를 자동으로 조절한다.

HPA의 주요 특징은 다음과 같다.
- <b>수평 확장</b>: 파드 복제본(replica) 수를 늘리거나 줄인다.
- <b>메트릭 기반</b>: CPU, 메모리 사용량뿐만 아니라, 초당 요청 수(RPS)나 메시지 큐의 길이 같은 다양한 메트릭을 활용할 수 있다.
- <b>빠른 반응성</b>: 실시간에 가까운 부하 변화에 신속하게 대응하여 서비스 안정성을 높인다. 여러 파드에 부하를 분산하므로 갑작스러운 트래픽 증가에도 유연하게 대처할 수 있다.

### 2-2. 동작 원리

HPA의 동작은 비교적 단순하게 이루어진다.
1.  HPA 컨트롤러는 메트릭 서버(Metrics Server)를 통해 주기적으로 파드의 리소스 사용률을 수집한다.
2.  수집된 현재 사용률과 HPA에 설정된 목표 사용률을 비교한다.
3.  `필요한 파드 수 = 현재 파드 수 * (현재 사용률 / 목표 사용률)` 공식에 따라 필요한 파드 수를 계산한다.
4.  계산된 결과에 따라 디플로이먼트(Deployment)나 스테이트풀셋(StatefulSet)의 `replicas` 필드를 업데이트하여 파드 수를 조절한다.

### 2-3. 사용 예시

아래는 CPU 사용률이 평균 70%를 초과하면 파드 수를 최대 10개까지 늘리는 HPA 설정이다.

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
이 설정을 통해 `web-app` 디플로이먼트는 최소 2개의 파드를 유지하며, 부하가 증가하면 자동으로 파드를 늘려 안정적인 서비스를 제공하게 된다.

## 3. VPA (Vertical Pod Autoscaler)

### 3-1. 정의와 특징

VPA는 <b>개별 파드의 리소스 요청(request) 및 한도(limit)를 수직적으로 확장</b>하는, 즉 스케일 업(Scale-up)과 스케일 다운(Scale-down)을 자동화하는 기능이다. 실제 리소스 사용량을 분석하여 각 파드에 할당되는 CPU와 메모리 양을 동적으로 최적화한다.

VPA의 주요 특징은 다음과 같다.
- <b>수직 확장</b>: 개별 파드의 CPU/메모리 `requests`와 `limits`를 조정한다.
- <b>리소스 최적화</b>: 실제 사용량에 기반하여 리소스를 할당하므로, 불필요한 리소스 낭비를 줄여 비용 효율성을 높일 수 있다.
- <b>파드 재시작 필요</b>: VPA가 새로운 리소스 설정을 적용하려면 해당 파드를 재시작해야 한다는 점이 가장 큰 특징이자 단점이다. 이 때문에 서비스 중단이 발생할 수 있다.

### 3-2. 동작 모드

VPA는 여러 동작 모드를 제공하여 운영 환경에 맞게 선택할 수 있다.
- <b>Auto</b>: VPA가 계산한 권장 리소스 값을 파드에 자동으로 적용하고, 필요시 파드를 재시작한다.
- <b>Recreate</b>: `Auto`와 유사하지만, 파드를 항상 재시작하여 리소스를 변경한다.
- <b>Initial</b>: 파드가 처음 생성될 때만 VPA의 권장 리소스를 적용한다.
- <b>Off</b>: VPA는 리소스 권장사항만 제공하고, 실제 파드에 적용하지는 않는다. 리소스 사용량 분석 및 모니터링 용도로 유용하다.

> [!NOTE]
> 개인적으로는 `Off` 모드를 사용하여 애플리케이션의 리소스 사용 패턴을 먼저 파악한 뒤, 그 결과를 바탕으로 `requests`와 `limits`를 수동으로 설정하거나 `Auto` 모드로 전환하는 방식을 선호한다.

### 3-3. 사용 예시

아래는 `database` 디플로이먼트에 대해 VPA를 `Auto` 모드로 설정하는 예시이다.

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
    updateMode: "Auto" # 자동으로 리소스 변경 및 파드 재시작
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
이 설정을 통해 `database` 파드는 항상 최적의 리소스를 할당받게 되지만, 리소스 변경 시 재시작될 수 있음을 인지해야 한다.

## 4. HPA vs VPA 비교

두 오토스케일러의 특징을 표로 정리하면 다음과 같다.

| 구분 | HPA (Horizontal Pod Autoscaler) | VPA (Vertical Pod Autoscaler) |
| :--- | :--- | :--- |
| <b>확장 방향</b> | 수평 (파드 개수 조절) | 수직 (파드 리소스 조절) |
| <b>핵심 역할</b> | 트래픽 변동에 대한 대응 | 리소스 사용량 최적화 |
| <b>적용 방식</b> | 실시간으로 파드 수 변경 | 파드 재시작 후 리소스 변경 |
| <b>주요 메트릭</b> | CPU, 메모리, 사용자 정의 메트릭 | 과거 리소스 사용 패턴 |
| <b>가용성</b> | 높음 (다중 파드로 부하 분산) | 낮음 (파드 재시작으로 인한 순간적인 중단) |
| <b>적합한 워크로드</b> | 웹 서버, 마이크로서비스 | 데이터베이스, 배치(Batch) 작업 |

## 5. HPA와 VPA 함께 사용하기

> [!IMPORTANT]
> HPA와 VPA를 <b>동일한 리소스 메트릭(CPU, 메모리)에 대해 함께 사용하는 것은 금지</b>된다. HPA는 파드 수를 늘리려 하고, VPA는 개별 파드의 리소스를 늘리려 하면서 서로 충돌하여 예측 불가능한 동작을 유발할 수 있기 때문이다.

하지만 두 기능을 현명하게 조합하면 시너지를 낼 수 있다. 권장되는 조합은 다음과 같다.
1.  <b>HPA</b>는 <b>사용자 정의 메트릭</b>(예: 초당 요청 수, 메시지 큐 길이)을 기반으로 파드 수를 조절한다.
2.  <b>VPA</b>는 <b>CPU와 메모리 사용량</b>을 기반으로 개별 파드의 리소스를 최적화한다.
3.  여기에 <b>클러스터 오토스케일러(Cluster Autoscaler)</b>를 함께 사용하여, 전체 노드 리소스가 부족해지면 노드 자체를 확장하도록 구성하는 것이 가장 이상적인 자동 확장 아키텍처라고 할 수 있다.

## 6. 결론

HPA와 VPA는 쿠버네티스에서 리소스를 효율적으로 관리하기 위한 필수 도구이다. HPA는 수평 확장을 통해 트래픽 변동에 유연하게 대응하고, VPA는 수직 확장을 통해 리소스 사용을 최적화한다.

어떤 것을 선택할지는 전적으로 애플리케이션의 특성에 달려있다.
-   <b>가용성이 중요하고 트래픽 예측이 어려운 웹 서비스</b>라면 HPA가 적합하다.
-   <b>안정적인 리소스 사용 패턴을 보이지만 최적화가 필요한 데이터베이스나 배치 작업</b>이라면 VPA가 좋은 선택이 될 수 있다.

결론적으로, 두 도구의 장단점을 명확히 이해하고, 서비스의 특성에 맞는 확장 전략을 수립하는 것이 중요하다. 처음에는 HPA로 시작하여 서비스 안정성을 확보한 뒤, VPA의 `Off` 모드로 리소스 사용 패턴을 분석하여 점진적으로 최적화해 나가는 방식이 안정적인 접근법이 아닐까 싶다.

## 7. 참고 링크

- [Kubernetes HPA 공식 문서](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/)
- [Kubernetes VPA 공식 문서](https://github.com/kubernetes/autoscaler/tree/master/vertical-pod-autoscaler)
