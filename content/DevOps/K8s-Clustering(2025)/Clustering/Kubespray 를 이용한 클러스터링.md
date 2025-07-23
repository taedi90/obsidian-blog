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

### 노드 설정
authorized_keys 에 키를 등록해줘야하고 sshd 서비스가 정상동작하는지 확인해야한다. 당연히 agent 노드에서 클러스터로 ssh 접근이 가능하도록 네트워크가 준비된 상태여야한다.

### ansible 환경 구성
python venv 를 활성화(선택사항)하고 requirements.txt 에 맞춰 라이브러리들을 설치해야한다.

### 클러스터링
클러스터링을 진행한다.

### 확인
- kubectl 을 이용하여 정상적으로 접근 되는지
- 노드들은 모두 ready 상태인지
등을 테스트 하며 이상이 있을 경우 journalctl, ansible log 등을 참고하여 원인을 분석하고 해결한다.