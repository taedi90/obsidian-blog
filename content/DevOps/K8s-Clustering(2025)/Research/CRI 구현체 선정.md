---
title: Kubernetes CRI 선정
date: 2025-03-16
draft: false
tags:
  - kubernetes
  - cri
  - containerd
  - docker
description: Kubernetes 클러스터 구축 시 CRI(Container Runtime Interface) 선정 과정과 Docker에서 containerd로 전환한 이유
type:
  - comparison
---

## 🚀 요약

> [!SUMMARY]
> 기존 Docker 기반 CRI에서 containerd로 전환하여 Kubernetes 표준 아키텍처를 따르고 성능과 안정성을 개선했다. Docker의 추가 레이어로 인한 복잡성과 라이선스 이슈를 해결할 수 있었다.

## 💡 개요

Kubernetes 클러스터를 구축하면서 <b>컨테이너 런타임 인터페이스(Container Runtime Interface, CRI)</b> 선정이 필요했다. 기존에는 개발팀의 Docker 친숙도를 고려해 Docker를 사용했지만, 클러스터 운영 경험이 쌓이면서 containerd로의 전환을 검토하게 되었다.

> [!INFO]
> 컨테이너 런타임 인터페이스(CRI)는 Kubernetes가 다양한 컨테이너 런타임과 통신하기 위한 표준 인터페이스다. kubelet이 컨테이너 생성, 시작, 중지 등의 작업을 수행할 때 사용한다.

## 📋 선정 배경

예전 클러스터 구성 시 개발자들의 Kubernetes 사용 경험이 부족해 빠른 개발을 위해 <b>Kubernetes가 관리하지 않는 Docker 컨테이너를 직접 운영</b>하곤 했다. Kubernetes 공식 문서에서도 권장하지 않는 방식이지만, 당시에는 개발 속도를 우선시했다.

이런 상황에서 개발자들이 `docker` 명령어에서 `nerdctl`로 <b>명령줄 인터페이스(Command Line Interface, CLI)</b>가 변경되면 혼란을 유발할 수 있을 것 같아 컨테이너 런타임 인터페이스(CRI)로 Docker를 울며겨자먹기로 사용했었다.

하지만 클러스터 운영 경험이 쌓이면서 몇 가지 문제점이 드러났다.

- Docker는 컨테이너 런타임 인터페이스(CRI)를 직접 지원하지 않아 cri-dockerd를 별도로 거쳐야 함
- containerd 대비 불필요한 추가 단계로 인한 성능 <b>오버헤드(Overhead)</b>
- Kubernetes와 Kubespray에서 표준으로 containerd를 사용하는 추세
- Docker Desktop <b>라이선스(License)</b> 이슈에 대한 우려

## 📊 비교

| 구분                 | Docker + cri-dockerd                                | containerd                  |
| -------------------- | --------------------------------------------------- | --------------------------- |
| <b>아키텍처(Architecture)</b>      | kubelet → cri-dockerd → dockerd → containerd → runc | kubelet → containerd → runc |
| <b>성능(Performance)</b>          | 추가 <b>레이어(Layer)</b>로 인한 <b>오버헤드(Overhead)</b>                         | 직접 통신으로 최적화된 성능 |
| <b>표준 지원</b>     | 비표준, 별도 <b>어댑터(Adapter)</b> 필요                            | Kubernetes 표준 <b>컨테이너 런타임 인터페이스(CRI)</b> 지원    |
| <b>유지보수</b>      | cri-dockerd 추가 관리 필요                          | 단순한 구조로 관리 용이     |
| <b>명령줄 인터페이스(CLI) 도구</b>      | docker 명령어 사용 가능                             | nerdctl 사용 (docker 호환)  |
| <b>라이선스(License)</b>      | Docker Desktop <b>라이선스(License)</b> 고려 필요                   | Apache 2.0 <b>라이선스(License)</b>         |
| <b>커뮤니티 지원</b> | <b>레거시(Legacy)</b> 지원                                         | 활발한 개발과 지원          |

> [!NOTE]
> nerdctl은 Docker CLI와 호환되는 containerd용 CLI 도구로, 대부분의 docker 명령어를 동일하게 사용할 수 있다. 개발자들의 학습 부담을 크게 줄일 수 있다.

## ✅ 선정 사유

최종적으로 <b>containerd</b>를 선정한 주요 이유는 다음과 같다.

### 1. 아키텍처 단순화
Docker 기반 구성에서 kubelet이 컨테이너를 관리하는 과정은 여러 단계를 거쳐야 했다.
```
kubelet → cri-dockerd → dockerd → containerd → runc
```

containerd를 직접 사용하면 이 중간 단계를 생략할 수 있다.
```
kubelet → containerd → runc
```

### 2. Kubernetes 표준 준수
Kubernetes 1.24부터 Docker 지원이 공식적으로 제거되었고, containerd가 기본 CRI로 자리잡았다. Kubespray 같은 클러스터 배포 도구에서도 containerd를 표준으로 사용한다.

### 3. 성능 최적화
불필요한 중간 레이어를 제거하여 컨테이너 시작 시간과 리소스 사용량을 개선했다. 특히 대규모 클러스터에서 그 차이가 더욱 명확하게 나타났다.

> [!IMPORTANT]
> 초기 우려했던 CLI 변경으로 인한 혼란은 nerdctl의 뛰어난 Docker 호환성 덕분에 거의 발생하지 않았다.

## 🔗 참고

- [Kubernetes CRI 공식 문서](https://kubernetes.io/docs/concepts/architecture/cri/)
- [containerd 공식 사이트](https://containerd.io/)
- [nerdctl GitHub 저장소
