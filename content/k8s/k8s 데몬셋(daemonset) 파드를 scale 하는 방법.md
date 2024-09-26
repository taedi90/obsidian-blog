---
title: k8s 데몬셋(daemonset) 파드 scale
date: 2023-01-30
draft: false
tags:
  - k8s
banner: 
cssclasses: 
description: 데몬셋(daemonset) 레플리카 수를 0 으로 변경하는 방법을 알아본다.
permalink: 
aliases: 
completed:
---
## 요약

```bash
namespace=<네임스페이스>
daemonset_name=<데몬셋 배포 명>

# 데몬셋 파드 0으로 조절
kubectl -n "${namespace}" patch daemonset "${daemonset_name}" -p '{"spec": {"template": {"spec": {"nodeSelector": {"non-existing": "true"}}}}}'

# 데몬셋 파드 재실행
kubectl -n "${namespace}" patch daemonset "${daemonset_name}" --type json -p='[{"op": "remove", "path": "/spec/template/spec/nodeSelector/non-existing"}]'
```

## 이슈

Statefulset 이나 Replicaset 은 `scale` 을 사용하여 파드를 모두 종료하거나 원하는 사이즈로 조절이 가능하다.

```bash
kubectl scale --replicas <원하는 숫자> -n <네임스페이스> statefulset <statefulset 네임>
```

Daemonset 을 `scale` 한다는 것은 말이 안되지만 (기본적으로 노드 당 1개의 파드를 구동하는 형태이므로) PVC 볼륨을 교체한다거나 기능을 일시 중단하기 위해서 모든 파드를 잠시 꺼야하는 상황이 생겼을 때의 처리 방법이 필요했다.

  

## 해결

해당 데몬셋 명세의 `nodeSelector` 를 수정하여 해당하는 노드가 아예 존재하지 않도록 하여 전체 노드에 존재하는 데몬셋 파드를 삭제할 수 있다.

(이런 식으로 응용할 수 있을거라곤 생각지도 못했다.. 와우)

```bash
namespace=<네임스페이스>
daemonset_name=<데몬셋 배포 명>

# 데몬셋 파드 0으로 조절
kubectl -n "${namespace}" patch daemonset "${daemonset_name}" -p '{"spec": {"template": {"spec": {"nodeSelector": {"non-existing": "true"}}}}}'

# 데몬셋 파드 재실행
kubectl -n "${namespace}" patch daemonset "${daemonset_name}" --type json -p='[{"op": "remove", "path": "/spec/template/spec/nodeSelector/non-existing"}]'
```

  

## 참고

- [https://stackoverflow.com/questions/53929693/how-to-scale-kubernetes-daemonset-to-0](https://stackoverflow.com/questions/53929693/how-to-scale-kubernetes-daemonset-to-0)