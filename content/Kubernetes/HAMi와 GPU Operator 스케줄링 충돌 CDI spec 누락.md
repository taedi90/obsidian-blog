---
title: HAMi와 GPU Operator 스케줄링 충돌 — CDI spec 누락
date: 2026-07-24
draft: false
tags:
  - kubernetes
  - gpu
  - hami
  - gpu-operator
  - cdi
  - scheduling
  - troubleshooting
banner: 
cssclasses: 
description: GPU Operator의 toolkit이 management 클래스 CDI spec만 생성해서, HAMi가 골라준 GPU UUID를 CDI로 풀지 못해 스케줄링이 실패하는 충돌을 조사한 기록.
permalink: 
aliases: 
completed: false
type:
  - issue
---

## 🚀 요약

> [!SUMMARY]
> HAMi로 GPU를 쓰려고 하면 GPU Operator의 toolkit(pu-operator)이 management 컨테이너용 CDI spec만 만들고, 일반 워크로드가 쓸 개별 GPU UUID의 CDI spec은 애초에 생성하지 않아서 스케줄링이 실패한다. HAMi가 UUID를 골라줬는데 그 UUID를 정의하는 CDI spec 자체가 없으니 에러. 아직 완전히 해결한 건 아니고, 어디서 꼬이는지까지 파악한 단계다.

## ⚙️ 환경

- Kubernetes 클러스터
- GPU 관리: NVIDIA GPU Operator (toolkit/pu-operator 포함)
- GPU 가상화/공유: HAMi (Heterogeneous AI Computing Virtualization Middleware)
- 특정 노드만 HAMi를 사용하려는 구성

## 💬 이슈

목표는 단순했다. 특정 노드에서만 HAMi로 GPU를 쓰고, 나머지 노드는 GPU Operator가 평소대로 관리하는 것. 그런데 HAMi를 적용하니 HAMi를 안 쓰는 노드에서도 GPU 스케줄링이 안 됐다.

> [!NOTE]
> HAMi와 GPU Operator는 GPU를 k8s에 노출하는 방식이 다르다. GPU Operator는 NVIDIA device-plugin으로 `nvidia.com/gpu`를 광고하고, HAMi는 자체 스케줄러 훅으로 GPU를 가상화해 나눠준다. 둘이 같은 클러스터에 있으면, "누가 GPU 자원을 광고하고 누가 스케줄링을 결정하느냐"가 충돌한다.

## 🧗 해결

### 1. 증상: HAMi 노드가 아닌데도 GPU가 안 잡힌다

기대 동작은 이랬다.

- HAMi를 적용한 특정 노드만 HAMi 방식으로 GPU 스케줄링.
- HAMi를 안 쓰는 노드는 기존대로 GPU Operator가 관리.

실제 동작은 이랬다.

- HAMi를 쓰는 노드: (설정 중)
- HAMi를 안 쓰는 노드: <b>GPU 스케줄링 불가</b>

즉 특정 노드만 격리하려 했는데, 안 쓰는 노드까지 영향을 받은 거다. 클러스터 전체에 퍼진 현상이었다.

### 2. 원인 추적: CDI spec이 management 클래스만 있다

로그를 뜯어보니 GPU Operator의 toolkit(pu-operator)이 CDI(Container Device Interface) spec을 생성할 때 이런 로그를 남기고 있었다.

```
Generating CDI spec for management containers
```

"management containers"용 CDI spec만 만들고 있었다. 일반 워크로드용, 즉 `nvidia.com/gpu` 개별 UUID에 대한 CDI spec은 애초에 만들지 않는다.

여기서 꼬인다. HAMi가 GPU를 할당하면서 특정 GPU UUID를 골라주는데, 컨테이너 런타임이 그 UUID를 CDI spec으로 풀려고 한다. 그런데 그 UUID를 정의하는 CDI spec 자체가 없다. spec이 없으니 당연히 에러.

> [!IMPORTANT]
> 핵심은 "CDI spec이 management 클래스만 있다"는 거다. management는 operator 자신이 쓰는 관리용 컨테이너(nvidia-smi 같은 진단 도구)용이다. 일반 파드가 `nvidia.com/gpu`로 요청하는 GPU는 별도의 CDI spec이 있어야 하는데, 그게 비어 있다. HAMi가 골라준 UUID를 풀 수 없는 건 이 때문이다.

### 3. 왜 안 쓰는 노드까지 망가졌나

HAMi를 "특정 노드만" 쓰려고 했는데 왜 전체가 망가졌는지가 의문이었다. 아직 완전히 단정하긴 어렵지만, 짐작건대 HAMi의 스케줄러 확장이 클러스터 전역에 깔리면서, HAMi 노드가 아닌 곳에서도 GPU 할당 경로가 HAMi 쪽으로 타려 하고, 그 경로에서 CDI spec을 찾지 못해 실패하는 것 같다.

(이 부분은 더 검증이 필요하다. HAMi의 webhook이나 스케줄러 확장이 노드 셀렉터 없이 전역으로 동작하는 건지, 아니면 CDI spec 생성 자체가 pu-operator 레벨에서 노드 무관하게 빠진 건지. 아래 확인 항목에 남겨뒀다.)

### 4. 지금까지 파악한 것, 아직 못 한 것

파악한 것은 여기까지다.

- pu-operator toolkit이 management CDI spec만 생성.
- HAMi가 골라준 GPU UUID에 대응하는 CDI spec 부재 → 스케줄링 실패.
- HAMi 미사용 노드까지 영향받는 현상 확인(정확한 전파 경로는 미확인).

아직 못 한 것.

- <b>왜 management만 생성하는가</b> — toolkit 버전 문제인지, 설정 누락인지, 아니면 의도된 동작인지. pu-operator의 CDI 생성 로직을 더 들여다봐야 한다.
- <b>전파 경로 확인</b> — HAMi 스케줄러 확장이 노드 무관하게 전역인지, 아니면 노드 라벨로 제어할 수 있는지.
- <b>해결 방향 후보</b>:
  - HAMi 노드와 GPU Operator 노드를 아예 분리(노드 풀 단위 격리)
  - toolkit의 CDI spec 생성 클래스를 확장하는 설정이 있는지 확인
  - HAMi 대신 GPU Operator 자체의 time-slicing이나 MIG로 우회

## ✅ 확인

아직 진행 중이다. 확인해야 할 항목은 이렇다.

```bash
# 1. toolkit 파드 로그에서 CDI spec 생성 클래스를 확인한다.
kubectl logs -n gpu-operator <gpu-operator-toolkit-pod> | grep -i "CDI"

# 2. 노드에 생성된 CDI spec 파일을 본다.
ls -la /var/run/cdi/

# 3. HAMi가 골라준 UUID가 CDI spec에 존재하는지 확인한다.
# (nvidia.com/gpu= GPU-<uuid> 형태로 매칭되는지)
```

위 확인을 마치면, management 외의 CDI spec을 생성하게 만드는 방법이 있는지 toolkit 문서와 소스를 봐야 한다. 그게 안 되면 노드 풀 단위로 HAMi / GPU Operator를 아예 물리적으로 분리하는 쪽이 깔끔할 수 있다.

> [!NOTE]
> HAMi vs GPU Operator 충돌은 커뮤니티에서도 진행 중인 주제다. 두 시스템이 GPU 자원 광고와 CDI spec 생성 책임을 두고 겹치기 때문에, 같은 클러스터에서 공존시키려면 어느 한쪽의 책임 경계를 명확히 잘라야 한다. 아직 정답이 없는 영역이라, 이 글도 "해결 완료"가 아니라 "어디서 꼬이는지 파악한 기록"에 머문다.
