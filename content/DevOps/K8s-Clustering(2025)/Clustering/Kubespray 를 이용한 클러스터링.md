---
title: Kubespray 를 이용한 클러스터링
date: 2025-07-16
draft: true
tags:
  - kubespray
  - kubernetes
  - cluster
banner: 
cssclasses: 
description: 
permalink: 
aliases: 
completed: 
type:
  - note
---
### 인벤토리 구성
대상 클러스터의 환경에 맞게 인벤토리를 구성해줘야 한다. `kubespray`의 `inventory/sample` 파일을 참고해서 새롭게 인벤토리를 구성해준다.

주요 설정 사항은
- 
kube-proxy 를 disable 해줬고, cni 를 별도로 설치하기 위해서 옵션을 바꿔 주었다.
(kubespray 에서 설치해주는 cilium 은 envoy proxy 가 포함되지 않아서 였음)

### 