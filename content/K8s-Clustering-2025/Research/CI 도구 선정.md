---
title: CI 도구 선정
date: 2025-04-16
draft: false
tags:
  - Kubernetes
  - CI
  - DevOps
  - DroneCI
  - Jenkins
  - Comparison
  - Bitbucket
cssclasses: 
description: Jenkins를 접고 쿠버네티스에 어울리는 CI를 찾다가 DroneCI로 정착한 기록.
permalink: ""
aliases:
completed: true
type:
  - comparison
---

## 요약

> [!SUMMARY]
> 사내 표준 VCS인 <b>Bitbucket 지원</b>을 1순위 조건으로 CI 도구를 훑었다. 그 관문을 통과한 후보들 중에서, 단순하고 직관적인 사용성이 돋보인 <b>DroneCI</b>를 골랐다. YAML 파이프라인에 쿠버네티스 네이티브라 지금 환경과 결이 맞았다.

## 1. 개요

사내에 쿠버네티스 클러스터를 들이면서, 레거시에서 쓰던 Jenkins를 대신할 <b>CI(Continuous Integration)</b> 도구가 필요했다. Jenkins의 어디가 걸렸는지, 새 도구에 뭘 요구했는지, 후보들을 어떻게 걸렀는지를 정리했다.

## 2. 선정 배경

레거시 서버의 Jenkins를 그대로 마이그레이션하는 게 제일 빠른 길이긴 했다. 하지만 굳이 짐을 그대로 짊어지고 넘어올 이유를 못 찾았다. Jenkins의 걸리는 점은 이미 겪을 만큼 겪었다.

- <b>파이프라인 설정</b>: `Jenkinsfile`은 Groovy 기반이라, 파이프라인이 복잡해지면 가독성이 급격히 떨어진다.
- 기능을 플러그인에 크게 기대는데, 플러그인끼리 충돌하거나 버전 물고 늘어지는 문제가 종종 났다.
- 메모리·CPU를 제법 먹어서 경량 환경엔 부담이었다.
- 애초에 쿠버네티스 같은 클러스터 네이티브 환경을 염두에 두고 설계된 물건이 아니라, 동적 스케일 아웃 붙이기가 영 불편했다.

그래서 새 CI 도구엔 이런 걸 요구했다.

- <b>Bitbucket 지원</b>: 사내 표준 VCS가 Bitbucket이다. 이게 안 되면 다른 게 아무리 좋아도 후보에서 빠진다. 사실상 첫 관문이었다.
- <b>빌드 환경</b>: `Docker container`, `Maven`, `Node.js` 빌드가 무리 없이 돌아야 한다.
- <b>선언적 파이프라인</b>: YAML 기반 Pipeline as Code를 지원할 것.
- <b>단순성</b>: 개발자들이 금방 배워서 쓸 수 있을 것.
- <b>커뮤니티</b>: 막혔을 때 찾아볼 자료가 있고, 계속 업데이트되고 있을 것.

## 3. 비교

Bitbucket 지원 여부를 첫 필터로 두고 후보를 걸렀다.

| 이름 | 장점 | 단점 및 보류 사유 |
| --- | --- | --- |
| <b>DroneCI</b> | 쿠버네티스 네이티브, 간단한 YAML 설정, Bitbucket 지원 | 일부 고급 기능은 유료 |
| Tekton | 쿠버네티스 네이티브, CRD 기반 강력한 확장성 | 학습 곡선이 높고 파이프라인 구성이 복잡 |
| Concourse CI | 명확한 개념(Resource·Task·Job), 뛰어난 UI | 다소 독선적인(Opinionated) 설계, 커뮤니티가 작음 |
| Gitea Actions | GitHub Actions 유사 워크플로우, Gitea와 완벽 통합 | 아직 실험적, Gitea 외 VCS 지원 미흡 |
| Woodpecker CI | DroneCI의 완전 오픈소스 포크, 쉬운 설정 | Bitbucket 미지원으로 탈락 |

가장 아까웠던 건 Woodpecker CI였다. DroneCI를 오픈소스로 포크한 물건이라 설정이 간단하고 라이선스 걱정도 없는데, 하필 Bitbucket을 공식 지원하지 않아 첫 관문에서 걸렸다. Tekton은 확장성은 최고지만 이번 규모에 쓰기엔 파이프라인 구성이 과했고, Concourse CI는 설계 철학이 강해 팀에 강요하기 부담스러웠다. Gitea Actions는 Gitea 안에선 매끈하지만 Bitbucket 쪽이 아직 미덥지 않았다.

## 4. 선정 사유

남은 후보 중 <b>DroneCI</b>로 정했다. 무게를 둔 지점은 이렇다.

1. <b>Bitbucket 지원(핵심)</b>: 첫 관문이자 마지막까지 가장 무거웠던 기준이다. 이 하나로 Woodpecker 같은 유망주까지 잘려 나갔고, 덕분에 선택지가 깔끔하게 좁혀졌다.
2. <b>단순한 사용성</b>: Bitbucket을 지원하는 후보들 중 DroneCI는 UI와 YAML 파이프라인이 유독 간명했다. 복잡한 Jenkinsfile에서 벗어나 누구나 파이프라인을 읽고 쓸 수 있다는 게 컸다. CI를 나 혼자 쓰는 게 아니라 개발자들이 같이 써야 하니, 학습 곡선을 낮추는 게 곧 도입 성공률이었다.
3. <b>쿠버네티스 네이티브</b>: 각 단계가 격리된 컨테이너에서 돌아 플러그인 의존성 문제에서 자유롭고, 클러스터 리소스도 효율적으로 쓴다. Jenkins에서 답답했던 부분을 정확히 메워 줬다.

## 참고

- [DroneCI 공식 문서 (Bitbucket 연동)](https://docs.drone.io/server/provider/bitbucket-cloud/)
- [Bitbucket App password 생성 (Atlassian 공식 문서)](https://support.atlassian.com/bitbucket-cloud/docs/create-an-app-password/)
