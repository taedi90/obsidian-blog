---
title: k8s Statefulset storageClassName 업데이트
date: 2023-01-30
draft: false
tags:
  - k8s
banner: 
cssclasses: 
description: 
permalink: 
aliases: 
completed:
---
## 이슈

Statefulset 으로 구성된 Elasticsearch 파드를 업데이트 하려니 다음과 같은 오류가 발생했다.

> Error: UPGRADE FAILED: cannot patch "elasticsearch-master" with kind StatefulSet: StatefulSet.apps "elasticsearch-master" is invalid: spec: Forbidden: updates to statefulset spec for fields other than 'replicas', 'template', 'updateStrategy', 'persistentVolumeClaimRetentionPolicy' and 'minReadySeconds' are forbidden

내용인 즉 'replicas', 'template', 'updateStrategy', 'persistentVolumeClaimRetentionPolicy' and 'minReadySeconds' 값은 update 가 불가능 하다는 것.

  

## 해결

수정을 위해서는 Statefulset 을 삭제하고 다시 생성해주는 방법이 있다고 한다.

```bash
## 현재 구성을 yaml 파일로 저장
kubectl get statefulset some-statefulset -o yaml > statefulset.yaml

## 파일 내용 수정
vim statefulset.yaml

## 파드를 제거하지 않고 Statefulset 삭제
kubectl delete statefulset some-statefulset --cascade=orphan

## 변경된 StorageClass 로 Statefulset 다시 생성
kubectl apply -f statefulset.yaml
```

  

## 참고

- [https://stackoverflow.com/questions/56603793/how-to-update-a-storageclassname-in-a-statefulset](https://stackoverflow.com/questions/56603793/how-to-update-a-storageclassname-in-a-statefulset)