---
title: NVIDIA 드라이버와 Container Toolkit 오프라인 설치
date: 2025-07-16
draft: false
tags:
  - nvidia
  - gpu
  - driver
  - cuda
  - kubernetes
  - ansible
banner: 
cssclasses: 
description: NVIDIA 공식 Ansible role을 가져다 쓰되, 오프라인 환경에 맞게 수정해서 드라이버·CUDA·container-toolkit을 한 번에 올린 기록.
permalink: 
aliases: 
completed: 
type:
  - note
---

NVIDIA에서 제공하는 Ansible role을 활용했다. 드라이버, CUDA toolkit, container toolkit 세 가지를 한 플레이북으로 묶어서 GPU 노드에 돌린다.

## 1. 문제: 공식 role은 오프라인을 안 지원한다

NVIDIA 공식 role은 패키지를 그 자리에서 다운로드한다. 폐쇄망에서는 이게 안 된다. 그래서 role 내부를 뜯어고쳐야 했다.

수정한 지점은 크게 두 군데다.

- <b>패키지 소스를 로컬 리포지토리로 변경</b>: NVIDIA repo URL 대신 오프라인 환경에 미리 구성해둔 로컬 mirror를 바라보게 했다.
- <b>다운로드 단계 우회</b>: role이 `get_url`로 바이너리를 당겨오는 부분을, 사전에 반입해둔 파일 경로를 가리키도록 바꿨다.

## 2. 플레이북

```yaml
---
- hosts: "{{ node | default('gpu_node') }}"
  become: true
  tasks:
    - name: Check for DGX packages
      stat:
        path: /etc/dgx-release
      register: is_dgx

    - name: install custom facts
      include_role:
        name: nvidia/facts

    - name: install nvidia driver
      include_role:
        name: nvidia/driver
      when:
        - ansible_local['gpus']['count']
        - cuda_playbook_install_driver|default(true)
      tags:
      - nvidia_driver

    - name: install nvidia cuda toolkit
      include_role:
        name: nvidia/cuda

    - name: test nvidia-smi
      command: nvidia-smi
      changed_when: false
      when:
        - ansible_local['gpus']['count']
        - cuda_playbook_install_driver|default(true)

    - name: install container toolkit
      include_role:
        name: nvidia/container-toolkit
      when:
        - ansible_local['gpus']['count']
        - cuda_playbook_install_constiner_toolkit|default(true)
```

`nvidia/facts` role이 `ansible_local`에 GPU 개수를 세팅한다. GPU가 없는 노드면 드라이버와 toolkit 설치를 건너뛴다. 이걸로 GPU 노드와 일반 노드를 같은 인벤토리에 두고 돌려도 안전하다.

## 3. containerd에 NVIDIA 런타임 등록

드라이버와 toolkit만 올라간 상태로는 containerd가 NVIDIA 런타임을 모른다. `group_vars/gpu_node.yml`에서 containerd 추가 런타임을 등록한다.

```yaml
# NVIDIA 드라이버 브랜치
nvidia_driver_branch: "570"
cuda_version: "cuda-toolkit-12-8"

# 컨테이너 런타임 설정
containerd_additional_runtimes:
  - name: nvidia
    type: "io.containerd.runc.v2"
    engine: ""
    root: ""
    options:
      systemdCgroup: "true"
      BinaryName: "/usr/bin/nvidia-container-runtime"
```

Kubespray가 이 값을 읽어서 containerd 설정 파일에 `nvidia` 런타임을 추가한다. 클러스터 설치 시 GPU 노드 그룹에만 이 변수가 적용된다.

## 4. 설치 순서

GPU 노드를 클러스터에 붙이는 전체 흐름은 이렇다.

1. <b>NVIDIA 드라이버·CUDA·toolkit 설치</b>: `install_cuda.yml` 플레이북으로 실행한다.
2. <b>클러스터 조인</b>: Kubespray `scale.yml` (또는 `cluster.yml`)로 수행한다.
3. <b>GPU Operator 설치</b>: Helmfile로 GPU Operator 차트를 배포한다.

> [!NOTE]
> 드라이버 설치와 클러스터 조인 순서는 바뀌어도 큰 문제는 없다. 다만 containerd 설정에 NVIDIA 런타임이 들어가야 GPU 파드가 정상적으로 스케줄링되니, 조인 전에 드라이버와 toolkit을 올리는 편이 순서상 깔끔하다.

## 5. 오프라인에서 막혔던 지점

드라이버 버전과 커널 버전 매칭이 가장 까다로웠다. Rocky Linux 9의 커널 업데이트가 밀리면, 특정 드라이버 브랜치(570 등)가 빌드되지 않는다. `dkms`가 커널 헤더를 못 찾거나 버전이 어긋나면 설치가 중간에 죽는다.

이건 사전에 패키지를 반입할 때 커널 버전과 드라이버 버전 매칭을 표로 만들어 확인하는 수밖에 없었다. (이 과정은 별도 글에서 다룬다.)
