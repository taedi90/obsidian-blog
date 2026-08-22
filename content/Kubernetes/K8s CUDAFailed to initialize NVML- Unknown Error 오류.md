---
title: K8s Failed to initialize NVML 오류
date: 2023-02-08
draft: false
tags:
  - k8s
  - cuda
banner: 
cssclasses: 
description: 쿠버네티스 파드에서 GPU를 사용할 때 발생하는 `CUDAFailed to initialize NVML` 오류 해결.
permalink: 
aliases:
completed:
---
## 요약

> [!important]  
> GPU 를 사용하는 파드에 'privileged' 권한을 부여한다.  

## 1. 이슈

쿠버네티스 클러스터에 Nvidia GPU 를 사용하는 파드를 생성하면 처음에는 정상적으로 동작하지만, 일정 시점 이후에 기능이 제대로 동작하지 않는 현상이 발생했다. 파드 내부에서 `nvidia-smi` 명령어를 실행했을 때 'Failed to initialize NVML: Unknown Error' 오류가 발생했다.

  

## 2. 해결

여러 레퍼런스를 살펴보았지만 정확한 원인을 이해하거나 파악하지 못했다. 다만 동일한 증상을 재현하는 방법은 알아냈는데, 호스트에서 `systemctl daemon-reload` 명령어를 입력한 직후에 파드 내부에서 `nvidia-smi` 를 확인하면 동일한 문제가 나타났다.

  

검색해서 찾은 내용을 바탕으로 며칠간 테스트를 진행했고, 다음과 같은 결과를 얻었다.

  

### 환경

- kubernetes 1.25.0
- gpu-operator 22.9.0
- cuda 11.7

  

### 시도 또는 고려해본 사항

1. cgroup2 로 변경 → 리스크 때문에 진행하지 않음
2. containerd 버전 다운그레이드 → 실패
3. runc version 1.1.2 이하로 낮추기 → 실패
4. nvidia-experimental 런타임 사용 → 실패(`runtimehandler "nvidia-experimental" not supported`)
    
    ```yaml
    # gpu-operator operator.runtimeClass 설정
    runtimeClassName: nvidia-experimental
    ```
    
5. 헬스 체크를 통해 오류가 발생하면 파드를 삭제하기 → 정상 동작하지만 깔끔한 방법 같지 않아서 적용하지는 않았음
    
    ```yaml
    # 쉘 스크립트로 다음 사항을 검증한다.
    nvidia-smi || exit 1
    ```
    
6. gpu 파드에 privileged 권한 부여하기 → 정상 동작함
    
    ```bash
    # 파드 설정에 다음 내용을 추가한다.
    securityContext:
        privileged: true
    ```
    

  

cuda 에 대한 이해도가 낮아서 정상적인 해결 방법임에도 불구하고 제대로 적용하지 못했을 가능성도 있다.

  

'privileged' 권한 부여는 최대한 지양하고 싶었지만 달리 방법이 없었고, 설정을 적용한 이후로 2개월 이상 테스트를 진행해 보아도 동일 증상은 나타나지 않았다.

  

## 참고

- [https://github.com/NVIDIA/nvidia-docker/issues/1671](https://github.com/NVIDIA/nvidia-docker/issues/1671)
- [https://stackoverflow.com/questions/72932940/failed-to-initialize-nvml-unknown-error-in-docker-after-few-hours](https://stackoverflow.com/questions/72932940/failed-to-initialize-nvml-unknown-error-in-docker-after-few-hours)
- [https://stackoverflow.com/questions/58176096/downgrading-docker-from-19-03-2-to-18-09-9-on-centos-7](https://stackoverflow.com/questions/58176096/downgrading-docker-from-19-03-2-to-18-09-9-on-centos-7)
- [https://kubernetes.io/docs/concepts/containers/runtime-class/](https://kubernetes.io/docs/concepts/containers/runtime-class/)
