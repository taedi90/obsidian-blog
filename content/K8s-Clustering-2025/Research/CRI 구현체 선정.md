---
title: Kubernetes CRI 선정
date: 2025-03-16
draft: false
aliases:
tags:
  - kubernetes
  - cri
  - containerd
  - docker
description: 개발자 친숙도 때문에 붙잡고 있던 Docker를 놓고 containerd로 넘어간 이유.
type:
  - comparison
---

## 요약

> [!SUMMARY]
> 클러스터의 CRI를 Docker에서 <b>containerd</b>로 바꿨다. Docker는 쿠버네티스와 직접 말을 못 해 cri-dockerd라는 어댑터를 한 겹 거쳐야 하는데, 그 레이어를 걷어내니 구조가 단순해지고 라이선스 걱정도 사라졌다.

## 1. 개요

클러스터를 세우면서 <b>컨테이너 런타임 인터페이스(Container Runtime Interface, CRI)</b>를 정해야 했다. 처음엔 개발팀이 Docker에 익숙하다는 이유로 Docker를 붙잡고 있었는데, 운영 경험이 쌓이면서 containerd로 넘어가는 게 맞다는 결론에 이르렀다.

> [!INFO]
> CRI는 쿠버네티스가 여러 컨테이너 런타임과 통신하기 위한 표준 인터페이스다. kubelet이 컨테이너를 만들고 시작하고 멈출 때 이 인터페이스를 쓴다.

## 2. 선정 배경

예전 클러스터에서는 개발자들의 쿠버네티스 경험이 얕아, 빠른 개발을 핑계로 <b>쿠버네티스가 관리하지 않는 Docker 컨테이너를 직접 띄워</b> 쓰곤 했다. 공식 문서가 권장하지 않는 방식인 건 알았지만, 그땐 속도가 먼저였다.

문제는 CLI였다. containerd로 가면 개발자들이 익숙한 `docker` 명령어 대신 `nerdctl`을 써야 하는데, 그 혼란이 걱정돼 CRI로 Docker를 울며 겨자 먹기로 붙들고 있었다. 그런데 운영을 하다 보니 붙들고 있을 이유보다 놓아야 할 이유가 더 쌓였다.

- Docker는 CRI를 직접 지원하지 않아, cri-dockerd라는 어댑터를 별도로 거쳐야 한다.
- 그 중간 단계 때문에 containerd 대비 불필요한 성능 <b>오버헤드(Overhead)</b>가 생긴다.
- 쿠버네티스도, Kubespray도 containerd를 표준으로 미는 추세다.
- Docker Desktop <b>라이선스</b> 이슈도 마음 한켠에 걸렸다.

## 3. 비교

| 구분 | Docker + cri-dockerd | containerd |
| --- | --- | --- |
| 아키텍처 | kubelet → cri-dockerd → dockerd → containerd → runc | kubelet → containerd → runc |
| 성능 | 추가 레이어로 인한 오버헤드 | 직접 통신으로 최적화 |
| 표준 지원 | 비표준, 별도 어댑터 필요 | 쿠버네티스 표준 CRI 지원 |
| 유지보수 | cri-dockerd 추가 관리 필요 | 구조가 단순해 관리 용이 |
| CLI | `docker` 명령어 | `nerdctl` (docker 호환) |
| 라이선스 | Docker Desktop 라이선스 고려 필요 | Apache 2.0 |
| 커뮤니티 | 레거시 지원 | 활발한 개발과 지원 |

표의 아키텍처 한 줄이 사실상 결론이다. Docker를 쓰면 kubelet부터 컨테이너까지 네 단계를 거치는데, containerd는 그걸 두 단계로 줄인다. 붙잡고 있을 명분이던 CLI 문제도, 알고 보니 `nerdctl`이 `docker` 명령어와 거의 그대로 호환돼 생각만큼 큰 벽이 아니었다.

## 4. 선정 사유

<b>containerd</b>로 정했다. 이유를 추리면 이렇다.

### 1. 아키텍처 단순화

Docker 기반에서 kubelet이 컨테이너에 닿기까지는 여러 단계를 거쳐야 했다.

```
kubelet → cri-dockerd → dockerd → containerd → runc
```

containerd를 직접 쓰면 이 중간이 사라진다.

```
kubelet → containerd → runc
```

### 2. 쿠버네티스 표준 준수

쿠버네티스 1.24부터 내장 dockershim이 제거되면서, Docker를 CRI로 쓰려면 cri-dockerd를 따로 얹어야 하는 처지가 됐다. 반대로 containerd는 기본 런타임으로 자리 잡았고, Kubespray 같은 배포 도구도 containerd를 표준으로 쓴다. 흐름을 거스를 이유가 없었다.

### 3. 성능

불필요한 중간 레이어를 걷어내니 컨테이너 시작 시간과 리소스 사용량이 나아졌다. 규모가 커질수록 이 차이가 더 눈에 띄었다.

> [!IMPORTANT]
> 초반에 제일 걱정했던 CLI 변경 혼란은 거의 없었다. `nerdctl`이 `docker` 명령어를 워낙 잘 흉내 내 준 덕이다. 붙잡고 있던 이유가 막상 넘어와 보니 별것 아니었던 셈이다.

## 참고

- [Kubernetes CRI 공식 문서](https://kubernetes.io/docs/concepts/architecture/cri/)
- [containerd 공식 사이트](https://containerd.io/)
- [nerdctl GitHub 저장소](https://github.com/containerd/nerdctl)
