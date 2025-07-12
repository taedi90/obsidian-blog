---
title: CI 도구 선정
date: 2025-07-10
draft: false
tags:
  - Kubernetes
  - CI
  - DevOps
  - DroneCI
  - Jenkins
  - Comparison
  - Bitbucket
cssclasses: []
description: "기존 Jenkins의 한계를 분석하고, 쿠버네티스 네이티브 환경에 최적화된 CI 도구를 선정하는 과정을 기록했습니다. 여러 후보를 비교하여 최종적으로 DroneCI를 선택한 이유를 설명합니다."
permalink: ""
aliases: []
completed: true
type:
  - comparison
---

## 🚀 요약

> [!SUMMARY]
> 사내 표준 VCS인 **Bitbucket 지원**을 최우선 순위로 두고 여러 CI 도구를 검토한 결과, 요구사항을 만족하는 후보 중 **단순하고 직관적인 사용성**이 돋보이는 DroneCI를 최종 선정했다. DroneCI는 쿠버네티스 네이티브 환경에서 YAML 기반의 쉬운 파이프라인 관리를 가능하게 한다.

## 💡 개요

사내 쿠버네티스 클러스터 도입에 따라, 기존 레거시 환경에서 사용하던 Jenkins를 대체할 새로운 **지속적 통합(Continuous Integration, CI)** 도구를 선정하고자 했다. 이 문서는 Jenkins의 문제점을 분석하고, 새로운 도구에 대한 요구사항을 정의하며, 여러 후보군을 비교 검토하여 최종 결정을 내리는 과정을 기록한다.

## 📋 선정 배경

현재 레거시 서버의 Jenkins를 그대로 마이그레이션하는 방법이 가장 빠를 수 있었지만, Jenkins는 다음과 같은 명확한 단점을 가지고 있어 새로운 대안을 찾기로 결정했다.

> [!NOTE] 기존 Jenkins의 문제점
> - **복잡한 파이프라인 설정**: `Jenkinsfile`은 Groovy 스크립트 기반으로, 파이프라인이 복잡해질수록 가독성이 떨어지고 유지보수가 어렵다.
> - **플러그인 의존성**: 다양한 기능을 플러그인에 크게 의존하며, 플러그인 간의 충돌이나 버전 관리 문제가 발생할 수 있다.
> - **높은 리소스 사용량**: Jenkins 자체적으로 사용하는 메모리 및 CPU 리소스가 많아 경량화된 환경에는 부담이 될 수 있다.
> - **클러스터 환경과의 부조화**: 쿠버네티스 같은 클러스터 네이티브 환경을 위해 설계되지 않아, 동적 스케일 아웃 설정 등이 불편하고 비효율적이다.

이러한 문제들을 해결하기 위해, 새로운 CI 도구는 다음의 요구사항을 만족해야 한다고 판단했다.

- **VCS 연동**: **사내 표준 버전 관리 시스템(VCS)인 `Bitbucket`을 필수적으로 지원해야 한다는 점이 가장 중요한 전제 조건이었다.**
- **주요 빌드 환경 지원**: `Docker container`, `Maven`, `Node.js` 빌드를 원활하게 지원해야 한다.
- **선언적 파이프라인**: **`YAML` 기반의 선언적 파이프라인(Pipeline as Code)**을 지원하여 관리가 용이해야 한다.
- **단순성과 사용성**: 개발자들이 쉽게 배우고 사용할 수 있도록 직관적이고 단순한 사용성을 제공해야 한다.
- **활발한 커뮤니티**: 문제 발생 시 참고할 수 있는 자료가 많고, 지속적으로 업데이트되는 활발한 커뮤니티를 가져야 한다.

## 📊 비교

위 요구사항, 특히 **Bitbucket 지원 여부**를 핵심 기준으로 몇 가지 CI 도구를 후보로 선정하고 장단점을 비교했다.

| 이름 | 장점 | 단점 및 보류 사유 |
| --- | --- | --- |
| **DroneCI** | **쿠버네티스 네이티브, 간단한 YAML 설정, 다양한 플러그인, Bitbucket 지원** | 일부 고급 기능은 유료 버전에서만 제공될 수 있다. |
| **Tekton** | 쿠버네티스 네이티브, CRD 기반의 강력한 확장성, 서버리스 아키텍처 | 상대적으로 높은 학습 곡선, 파이프라인 구성이 복잡함. |
| **Concourse CI** | 명확한 개념(Resource, Task, Job), 시각적으로 뛰어난 UI | 다소 독선적인(Opinionated) 설계, 커뮤니티가 상대적으로 작음. |
| **Gitea Actions** | GitHub Actions와 유사한 워크플로우, Gitea와 완벽한 통합 | 아직 실험적인 기능이며, Gitea 외 VCS 지원이 미흡함. |
| **Woodpecker CI** | DroneCI의 완전 오픈소스 포크, 간단하고 쉬운 설정 | **Bitbucket을 공식적으로 지원하지 않아 최종 후보에서 제외됨.** |

## ✅ 선정 사유

여러 후보를 비교 검토한 결과, **DroneCI**가 우리의 요구사항에 부합하는 도구라고 최종 판단했다. 선정 과정에서 중요하게 고려한 점은 다음과 같다.

1.  **Bitbucket 지원이라는 핵심 전제 충족**
    사내 표준 VCS인 **Bitbucket을 공식적으로 지원**하는 것이 이번 CI 도구 선정의 가장 중요한 기준이었다. 이 기준에 따라 Woodpecker CI 등 일부 유망한 도구들이 초기 후보에서 제외되었고, 선택지를 좁힐 수 있었다.

2.  **단순하고 직관적인 사용성**
    Bitbucket을 지원하는 후보군 중에서 DroneCI는 **직관적인 UI와 단순한 YAML 기반 파이프라인**이 돋보였다. 이는 개발자들이 CI/CD에 대한 학습 곡선을 낮추고 빠르게 적응할 수 있게 하는 핵심적인 장점이라고 판단했다. 복잡한 Jenkinsfile에서 벗어나 누구나 쉽게 파이프라인을 이해하고 작성할 수 있다는 점이 매력적이었다.

3.  **쿠버네티스 네이티브 아키텍처**
    Jenkins의 단점을 보완할 수 있는 현대적인 아키텍처를 갖추고 있다. 파이프라인의 각 단계가 격리된 컨테이너에서 실행되므로 플러그인 의존성 문제에서도 자유롭고, 쿠버네티스 환경에서 리소스를 효율적으로 사용할 수 있다.

이러한 검토를 통해 DroneCI가 기존의 워크플로우를 충분히 지원하면서도, 더 단순하고 효율적인 방식으로 개선할 수 있다는 확신을 얻었다.

## 🔗 참고

- **DroneCI 공식 문서 (Bitbucket 연동):** [https://docs.drone.io/server/provider/bitbucket-cloud/](https://docs.drone.io/server/provider/bitbucket-cloud/)
- **Bitbucket App passwords 설정:** [https://bitbucket.org/leevistudio/workspace/settings/api](https://bitbucket.org/leevistudio/workspace/settings/api)