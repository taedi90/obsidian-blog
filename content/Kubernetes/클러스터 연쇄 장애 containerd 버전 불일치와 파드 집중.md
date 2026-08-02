---
title: 클러스터 연쇄 장애 — containerd 버전 불일치와 파드 집중이 만든 카스케이드
date: 2026-07-24
draft: false
tags:
  - kubernetes
  - containerd
  - incident
  - troubleshooting
  - node-scheduling
banner: 
cssclasses: 
description: 테스트 클러스터에서 12개 서비스가 연쇄로 죽었다. 노드 자체는 멀쩡했지만 containerd 버전 파편화와 한 노드로 몰린 파드가 만든 카스케이드 장애를 진단한 기록.
permalink: 
aliases: 
completed: true
type:
  - issue
---

## 요약

> [!SUMMARY]
> 테스트 클러스터에서 12개 이상 서비스가 연쇄로 응답 불가에 빠졌다. 노드 자원은 멀쩡했고 컨트롤 플레인도 정상이었다. 원인은 두 가지가 겹쳤다. containerd 버전이 노드마다 1.6.25부터 1.6.33까지 파편화되어 있었고, 구버전(1.6.25) 노드에 파드 54개가 몰려 있었다. 구버전 containerd 위에서 파드 간 통신이 죽으면서 `OCI runtime: namespace path lstat /proc/0/ns/ipc not found` 에러가 터지고, 파드 종료조차 안 되는 상태로 번졌다. 임시로 ArgoCD selfHeal을 끄고 ApplicationSet을 정비해 안정화했다.

## 1. 환경

- 테스트 클러스터, 워커 노드 5대
- container runtime: containerd (버전 혼재 1.6.25 ~ 1.6.33)
- 서비스 메시: Istio
- 배포: Helm 차트 → Helmfile → ArgoCD (GitOps)
- 영향 네임스페이스: 앱 네임스페이스 (약 290개 파드)
- 노드명·네임스페이스 등은 가상값으로 바꿔 적는다.

## 2. 이슈

테스트 클러스터가 느리다는 리포트가 들어왔다. 처음엔 단순 부하인가 싶었는데, 곧 "느린" 게 아니라 "죽어가는" 상태라는 걸 깨달았다.

조사를 시작하자마자 이런 게 보였다.

```
api-server: connection refused
orchestrator: connection refused
preprocess-api: connection refused
index-api: context deadline exceeded
```

12개 이상 서비스가 `connection refused`나 `context deadline exceeded`를 뱉고 있었다. 파드 종료도 안 됐다. `FailedKillPod` 에러가 찍히고, `OCI runtime: namespace path lstat /proc/0/ns/ipc not found`라는 처음 보는 에러까지 나왔다.

> [!NOTE]
> `OCI runtime: namespace path lstat /proc/0/ns/ipc not found`는 containerd가 컨테이너의 네임스페이스 경로를 못 찾을 때 나오는 에러다. 컨테이너 런타임 자체가 파드 상태를 추적하지 못하고 있다는 뜻이다. 보통 containerd 버전 불일치나 런타임 버그에서 나온다.

## 3. 해결

### 1. 노드는 멀쩡한데 파드는 죽는다

먼저 노드를 봤다. CPU 3~10%, 메모리 17~50%. 전부 정상 범위. `MemoryPressure`, `DiskPressure`, `PIDPressure` 조건도 없다. 노드 자원이 부족해서 일어난 일이 아니었다.

컨트롤 플레인도 정상이었다. apiserver `readyz` 체크가 전부 통과하고 응답 지연 67ms. 즉 "쿠버네티스 자체는 멀쩡한데 그 위에서 도는 파드들만 죽고 있었다".

그러면 원인은 두 군데에서 찾아야 한다. 런타임(containerd)과 파드 배치.

### 2. containerd 버전 파편화

전 노드의 containerd 버전을 찍어봤다.

| 노드 | containerd 버전 | 파드 수 |
|---|---|---|
| worker-01 | 1.6.28 | 98 |
| worker-02 | 1.6.32 | (일반) |
| worker-03 | <b>1.6.25</b> | <b>54</b> |
| worker-04 | 1.6.28 | (일반) |
| worker-05 | 1.6.33 | 8 |
| worker-06 | 1.6.33 | 9 |

1.6.25부터 1.6.33까지 4개 버전이 섞여 있었다. 그 중 worker-03이 가장 구버전(1.6.25)이었고, 장애가 난 8개 서비스 중 6개가 worker-03 위에서 돌고 있었다.

> [!IMPORTANT]
> containerd 버전 파편화 자체가 즉각 장애를 일으키진 않는다. 하지만 구버전(1.6.25)에는 알려진 런타임 버그가 있고, 그 위에 파드가 몰려 있으면 문제가 한 노드에 집중되어 터진다. 버전 통일은 "좋은 관행"이 아니라 장애 전파를 막는 실질적 방호벽이다.

### 3. 파드 집중: 왜 한 노드에 54개가 몰렸나

worker-03에 파드 54개가 있었다. 전체 약 290개 중 거의 20%. 노드 affinity나 taint/toleration 설정이 불균형하게 잡혀 있었고, 특정 서비스들이 특정 노드 라벨로 몰리는 패턴이 있었다.

장애가 난 8개 서비스 중 6개가 worker-03에 있었다.

구버전 containerd + 파드 집중. 한 노드에서 런타임이 비정상 동작을 시작하면, 그 위에 있는 파드 전체가 연쇄로 영향을 받는다. `connection refused`는 파드가 살아 있는데 다른 파드가 연결을 못 맺는 상태고, `context deadline exceeded`는 시그널 자체가 안 통하는 상태다.

### 4. 카스케이드: 왜 번졌나

14개 파드가 동시에 재시작했다. 이는 배포 롤아웃으로 보인다. 그런데 구버전 containerd 위에서 재시작한 파드들이 정상적으로 시작하지 못하면서, 이 파드들에 의존하는 다른 서비스들도 연쇄로 죽었다.

여기에 GPU 메모리 고갈이 겹쳤다. 일부 노드의 GPU 메모리가 94~98%에 달했고, 모든 GPU의 연산利用率(compute utilization)이 0%인데 메모리만 꽉 차 있었다. 즉 GPU 작업이 대기 중이거나 메모리 릭이 있었는데, 새 GPU 작업이 스케줄링되지 못하면서 클러스터 전체 지연으로 번진 것이다.

그리고 ArgoCD가 selfHeal=true로 설정되어 있어서, 드리프트를 자동 교정하느라 파드를 계속 재생성하고 있었다. 장애 상황에서 ArgoCD가 진도를 내는 바람에 불안정이 가중되었다.

### 5. 임시 조치: ArgoCD selfHeal 끄기

급한 불부터 껐다. GitOps 리포의 ApplicationSet 매니페스트에서 core 레이어의 `selfHeal`을 `true` → `false`로 바꿨다. ArgoCD가 드리프트를 자동 교정하지 않게 하고, 현재 클러스터 상태를 존중하도록 한 것이다.

```yaml
# ApplicationSet 매니페스트에서 core 레이어의 selfHeal을 끈다.
# 안정화 후 다시 켠다.
spec:
  syncPolicy:
    automated:
      selfHeal: false  # true → false
```

> [!IMPORTANT]
> 장애 상황에서 ArgoCD selfHeal이 켜 있으면, ArgoCD가 "상태가 다르다"며 파드를 재생성한다. 그런데 런타임이 비정상인 노드 위에서 재생성된 파드가 또 죽으면, ArgoCD가 또 재생성하고... 악순환이다. selfHeal을 끄면 최소한 ArgoCD가 만드는 추가 churn은 멈춘다.

최근 커밋들도 같이 정비했다. `ignoreApplicationDifferences`를 빈 리스트로 정본화해서 syncPolicy 드리프트를 제거하고, `applicationsSync`를 `create-update` 모드로 통일했다. 이건 장애를 일으킨 원인이라기보다, 장애 상황에서 ArgoCD가 할 수 있는 해를 줄이는 조치였다.

### 6. 근본 대응: containerd 버전 통일

임시 조치로 안정화한 뒤, 근본 원인을 손보기로 했다.

- <b>containerd 버전 통일</b> — 전 노드를 동일 버전(1.6.33)으로 올리기. 노드별 드레인 후 containerd 업그레이드.
- <b>파드 분산</b> — worker-03에 몰린 파드를 다른 노드로 분산. node affinity, topology spread constraints 검토.
- <b>selfHeal 정책 수립</b> — 평소엔 켜두되, 장애 상황에서는 끄는 운영 수칙 문서화.

## 4. 확인

임시 조치(selfHeal 끄기) 적용 후 ArgoCD의 추가 churn이 멈췄다. 이후 점진적으로 구버전 노드의 containerd를 업그레이드하면서 카스케이드가 수렴했다.

> [!NOTE]
> 이 장애의 교훈은 "노드 자원이 멀쩡해도 런타임 버전 하나가 발목을 잡을 수 있다"는 거다. 컨테이너 런타임은 쿠버네티스 아래에 깔린 투명한 층이라, 보통은 의식하지 않는다. 하지만 그 층에 균열이 있으면, 그 위의 모든 파드가 흔들린다. 버전 통일은 투명한 층을 단일한 층으로 만드는 가장 기본적인 일이다.
