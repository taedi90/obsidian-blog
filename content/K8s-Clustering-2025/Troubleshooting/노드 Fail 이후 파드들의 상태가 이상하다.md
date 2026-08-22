---
title: 노드 Failover 이후 남는 Error·Completed 파드 처리
date: 2025-07-02
draft: false
tags:
  - kubernetes
  - failover
  - statefulset
  - troubleshooting
banner: 
cssclasses: 
description: 노드가 죽은 뒤 새 파드는 다른 노드로 옮겨갔는데 기존 파드가 Error·Completed로 남는 현상, 그리고 Deployment는 재배치되지만 StatefulSet은 안 옮겨가는 이유를 정리한 기록.
permalink: 
aliases: 
completed: true
type:
  - issue
---

## 요약

> [!SUMMARY]
> 노드가 죽으면 그 위 파드는 다른 노드로 새로 떴는데, 죽은 노드의 <b>기존 파드가 Error·Completed로 남아</b> 목록이 지저분해졌다. 또 Deployment는 곧장 다른 노드로 재배치되는데 <b>StatefulSet은 그대로 멈춰</b> 있었다. 둘 다 쿠버네티스의 의도된 동작이다. 잔존 파드는 pod GC가 정리하고(임계치를 설정할 수 있다), StatefulSet이 옮겨가지 않는 것은 "같은 신원의 파드가 동시에 둘 뜨는 상황"을 막는 안전장치다. 방치하기보다 자동 정리와 주기 점검으로 관리하는 편이 낫다.

"거슬리는 잔존 파드"와 "안 옮겨가는 StatefulSet"은 사실 성격이 완전히 다른 문제였다.

## 1. Error·Completed 파드가 남는 이유

노드가 `NotReady`가 되면, 그 노드의 kubelet은 더 이상 자기 파드를 보고·정리하지 못한다. 컨트롤러는 대체 파드를 다른 노드에 새로 만들지만, <b>죽은 노드에 매인 옛 파드 오브젝트</b>는 API에 그대로 남는다. 그게 Error나 Completed(종료됨) 상태로 목록에 보인다.

이 잔존물은 <b>pod garbage collection</b>이 치운다. kube-controller-manager의 `--terminated-pod-gc-threshold`(기본 12500)를 넘어서면 종료된 파드를 오래된 것부터 지운다. 즉 소수가 잠깐 남는 건 정상이고, 임계치에 도달해야 정리가 돈다. 바로 안 사라진다고 고장난 게 아니다.

빨리 치우고 싶으면 아래 방법을 쓸 수 있다.

- `--terminated-pod-gc-threshold` 값을 낮춰서 종료된 파드를 더 자주 정리한다.
- Job이라면 `ttlSecondsAfterFinished` 설정으로 완료 후 자동 삭제되게 한다.
- 그 외에는 주기적으로 `kubectl delete pod --field-selector=status.phase==Failed`(또는 Succeeded) 명령으로 청소한다.

## 2. StatefulSet은 왜 옮겨가지 않는가

이게 더 중요한 지점이다. 노드 장애 직후 동작이 갈린다.

- <b>Deployment</b>(→ ReplicaSet): 파드는 서로 대체 가능하다. 노드가 죽으면 ReplicaSet이 "원하는 개수"를 맞추려 <b>즉시 다른 노드에 새 파드</b>를 만든다.
- <b>StatefulSet</b>: 각 파드가 <b>고유 신원</b>(`web-0`, `web-1`…)과 그에 묶인 볼륨을 갖는다. 그래서 "같은 신원의 파드는 동시에 최대 하나(at-most-one)"라는 조건을 보장해야 한다. 노드가 `NotReady`일 뿐 <b>정말 죽었는지 확신할 수 없으면</b>(네트워크 단절일 수도 있으니), 그 노드의 `web-0`이 아직 살아서 볼륨을 쓰고 있을 가능성을 배제하지 못한다. 그래서 컨트롤러는 <b>일부러 새 `web-0`을 안 띄운다</b>. 둘이 동시에 같은 볼륨을 쓰면 데이터가 깨지기 때문이다.

즉 StatefulSet이 "안 옮겨가는" 게 아니라, <b>안전을 위해 기다리는</b> 것이다. 옛 파드는 `Terminating`/`Unknown`으로 남는다.

## 3. StatefulSet 복구 방법

노드가 진짜 죽은 게 확실할 때만 진행시켜야 한다. 방법은 둘이다.

- <b>노드 오브젝트 삭제</b>: `kubectl delete node <dead-node>` 명령을 실행하면 그 노드에 매인 파드가 정리되고 StatefulSet이 대체 파드를 다른 노드에 띄운다. 노드가 확실히 폐기됐을 때 쓴다.
- <b>파드 강제 삭제</b>: `kubectl delete pod web-0 --grace-period=0 --force` 명령은 "이 파드는 확실히 죽었다"는 사실을 사람이 보증하는 것이다. <b>정말 죽은 게 맞을 때만</b> 써야 한다. 노드가 실은 살아 있었다면 스플릿브레인으로 볼륨이 손상될 수 있다.

자동화하려면 노드 문제 감지 후 일정 시간 뒤 노드를 자동 삭제/교체하는 쪽(노드 오토리페어·수명주기 관리)이 안전하다. 파드 강제 삭제를 자동으로 돌리는 건 위험하다.

## 4. 정리

- Error/Completed 잔존 파드는 <b>단기적으로는 정상</b>이고 pod GC가 임계치에 도달하면 치운다. 거슬리면 GC 임계치와 TTL, 주기 청소로 관리한다.
- StatefulSet이 노드 장애 때 옮겨가지 않는 것은 <b>at-most-one 보장을 위한 의도된 대기</b>다. 방치하면 그 replica가 계속 내려가 있는 상태가 되니, 노드가 확실히 죽었으면 노드 삭제(권장) 또는 신중한 강제 삭제로 진행시켜야 한다.
- 두 문제 모두 "자동 정리 + 주기 점검"으로 운영 복잡성을 미리 줄이는 것이 최선이다.

## 참고

- [Kubernetes — Pod Lifecycle (Garbage collection)](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/)
- [Kubernetes — Force delete StatefulSet Pods](https://kubernetes.io/docs/tasks/run-application/force-delete-stateful-set-pod/)
