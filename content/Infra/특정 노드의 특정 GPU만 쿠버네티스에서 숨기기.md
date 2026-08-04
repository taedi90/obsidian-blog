---
title: 특정 노드의 특정 GPU만 쿠버네티스에서 숨기기
date: 2026-02-03
draft: false
tags:
  - kubernetes
  - gpu
  - nvidia-device-plugin
  - containerd
  - resource-management
banner: 
cssclasses: 
description: 컨소시엄사와 물리 서버 GPU를 나눠 써야 해서, 한 노드의 일부 GPU만 쿠버네티스 스케줄링에서 감춘 기록.
permalink: 
aliases: 
completed: true
type:
  - tooling
---

## 요약

> [!SUMMARY]
> 한 물리 서버의 GPU를 컨소시엄사와 나눠 써야 했다. 그쪽이 쓸 GPU는 쿠버네티스가 아예 모르게 감추고, 우리 몫만 스케줄링에 태우고 싶었다. gpu-operator가 그 노드에는 device-plugin을 배포하지 않게 라벨로 막고, `NVIDIA_VISIBLE_DEVICES`로 노출할 GPU만 고정한 자체 device-plugin을 그 노드에만 따로 띄워서 해결했다. time-slicing으로 장치를 골라내는 깔끔한 길은 아직 device-plugin이 지원하지 않아 안 됐다.

## 1. 환경

- Kubernetes 클러스터, containerd 런타임 (기본 런타임이 `nvidia`)
- NVIDIA GPU Operator로 device-plugin·드라이버·container-toolkit 관리
- GPU가 여러 장 달린 워커 노드 한 대(이하 `gpu-node-01`)

## 2. 왜 특정 GPU만 숨겼는가

컨소시엄사와 물리 서버 한 대의 GPU를 나눠 쓰기로 했다. 조건이 좀 까다로웠는데, 그쪽이 쓸 GPU는 우리 쿠버네티스가 <b>손대지도, 스케줄링에 올리지도 말아야</b> 했다. 노드 자체는 우리 클러스터의 워커로 남아 있어야 하니 노드를 통째로 빼는 건 답이 아니었다. 노드는 클러스터에 두되, 그 노드에 달린 GPU 중 일부만 골라 k8s의 시야에서 지워야 했다.

요구는 이렇다.

- `gpu-node-01`은 계속 클러스터 워커로 둔다.
- 이 노드의 GPU 중 우리 몫(예: 0번)만 k8s가 스케줄 가능한 자원으로 본다.
- 나머지 GPU는 k8s가 존재조차 모르게 한다. 컨소시엄사가 호스트에서 직접 쓴다.

## 3. GPU가 k8s에 노출되는 경로부터

숨기려면 어디서 노출되는지부터 알아야 했다. 쿠버네티스가 GPU를 자원으로 인식하는 통로는 <b>NVIDIA device-plugin</b>이다. 이 녀석이 노드에서 GPU를 훑어 `nvidia.com/gpu`라는 확장 자원(Extended Resource)으로 kubelet에 광고한다. gpu-operator를 쓰면 device-plugin이 DaemonSet으로 모든 GPU 노드에 깔리고, 노드에 꽂힌 GPU 전부를 세서 올린다. 여기서 "전부"가 문제였다. 컨소시엄사 몫까지 세어 올려버리니까.

그러면 device-plugin이 <b>세는 GPU 목록 자체를 좁히면</b> 되겠다는 게 방향이었다. device-plugin이 어떤 GPU를 볼지는 `NVIDIA_VISIBLE_DEVICES` 환경변수가 결정한다. 이 값에 GPU 인덱스나 UUID를 넣으면 그 GPU만 보이고, 넣지 않은 GPU는 컨테이너 입장에서 존재하지 않는다. gpu-operator가 기본으로 띄우는 device-plugin은 이 값이 `all`이라 전부 본다.

> [!NOTE]
> `NVIDIA_VISIBLE_DEVICES`는 nvidia-container-toolkit(정확히는 컨테이너 런타임 훅)이 읽어서 컨테이너에 어떤 `/dev/nvidia*` 장치를 붙일지 정하는 값이다. `all`, `none`, 혹은 `0`, `GPU-<uuid>` 같은 목록을 받는다. device-plugin도 결국 이 규칙 위에서 도는 컨테이너라, 여기에 우리 몫만 적으면 나머지는 device-plugin 눈에도 안 보인다.

## 4. 안 먹힌 길: time-slicing으로 장치 골라내기

처음엔 device-plugin의 <b>time-slicing</b> 설정으로 풀어보려 했다. time-slicing은 원래 GPU 한 장을 여러 개의 가상 슬롯으로 쪼개 여러 파드가 나눠 쓰게 하는 기능인데, 설정에 `devices` 필드가 있어서 "이 GPU들만 대상으로" 지정할 수 있는 것처럼 보였다. 그 필드에 우리 몫 GPU만 적으면 나머지는 자연스럽게 빠지지 않을까 싶었다.

결론부터 말하면 안 됐다. 설정을 넣고 device-plugin 로그를 보니 이렇게 뱉고 있었다.

```text
# 특정 device만 골라 time-slicing에 태우려고 devices 필드를 넣었더니,
# 지원하지 않는 필드라며 통째로 무시한다는 로그.
Customizing the 'devices' field in sharing.timeSlicing.resources is not yet supported in the config. Ignoring
```

`devices` 필드 커스터마이징은 아직 지원 안 하니 무시한다는 뜻이다. GPT한테 물어봤을 땐 된다고 자신만만하게 알려줬는데, 실제로는 할루시네이션이었던 셈이다. 나중에 찾아보니 device-plugin에 <b>장치를 선택·제외하는 필터 기능</b>을 넣자는 PR([#1189](https://github.com/NVIDIA/k8s-device-plugin/pull/1189))이 올라와 있었고, 딱 이 요구("k8s 밖 용도로 일부 GPU를 예약하고 싶다")를 겨냥한 것이었다. 그런데 병합되지 못하고 방치되다 닫혀 있었다. 즉, 내가 원하던 깔끔한 길은 아직 기능 자체가 없는 상태였다.

## 5. 자체 device-plugin을 그 노드에만 따로 띄우기

기능이 없으면 우회한다. device-plugin이 세는 목록을 좁히는 건 결국 `NVIDIA_VISIBLE_DEVICES`니까, gpu-operator가 관리하는 전체 device-plugin은 그대로 두고 <b>그 노드에만 내가 만든 device-plugin을 따로 얹는</b> 편법으로 갔다. 두 단계다.

<b>첫째, gpu-operator가 이 노드엔 device-plugin을 안 깔게 막는다.</b> gpu-operator는 노드 라벨을 보고 어떤 컴포넌트를 배포할지 정한다. `nvidia.com/gpu.deploy.device-plugin=false`를 걸면 그 노드에서 operator의 device-plugin이 빠진다.

```bash
# gpu-node-01에서 operator가 관리하는 device-plugin을 내린다.
kubectl label node gpu-node-01 nvidia.com/gpu.deploy.device-plugin=false --overwrite

# 되돌릴 땐 라벨을 지운다(뒤의 '-'가 삭제).
kubectl label node gpu-node-01 nvidia.com/gpu.deploy.device-plugin-
```

<b>둘째, 노출할 GPU만 고정한 device-plugin을 그 노드에 직접 띄운다.</b> 이 파드에 `NVIDIA_VISIBLE_DEVICES`로 우리 몫 GPU만 지정한다. 이러면 이 device-plugin은 그 GPU만 보고 그것만 `nvidia.com/gpu`로 광고한다. 나머지는 애초에 눈에 안 들어오니 k8s 자원 목록에서 사라진다. `nodeSelector`로 `gpu-node-01`에만 붙게 하고, 권한은 최소로 뒀다.

```yaml
# gpu-node-01 전용 device-plugin. NVIDIA_VISIBLE_DEVICES로
# k8s에 노출할 GPU만 못박고, 그 외 GPU는 광고하지 않는다.
spec:
  nodeSelector:
    kubernetes.io/hostname: gpu-node-01
  containers:
    - name: nvidia-device-plugin
      image: <nvidia device-plugin image>
      securityContext:
        privileged: false          # 전체 GPU를 긁어오는 특권 모드가 아니라
      env:
        - name: NVIDIA_VISIBLE_DEVICES
          value: "0"               # 우리 몫 GPU만. 나머지는 여기 없으니 안 보인다
        - name: NVIDIA_DRIVER_CAPABILITIES
          value: "all"
```

`privileged: false`가 핵심이다. 특권 모드로 띄우면 `NVIDIA_VISIBLE_DEVICES`와 무관하게 노드의 GPU를 전부 잡아버려서 숨기는 의미가 없어진다. 권한을 낮춰야 `NVIDIA_VISIBLE_DEVICES` 목록이 실제로 경계 역할을 한다.

이렇게 하니 `kubectl describe node gpu-node-01`의 `Allocatable`에 `nvidia.com/gpu`가 우리 몫만큼만 잡혔다. 컨소시엄사 GPU는 k8s 어디에도 안 나타났고, 그쪽은 호스트에서 그대로 쓰면 됐다.

> [!INFO]
> 노출 GPU를 지정할 때 인덱스(`0`)보다 UUID(`GPU-<uuid>`)가 안전하다. 인덱스는 재부팅이나 드라이버 재로드 때 순서가 바뀔 수 있어서, "0번을 노출한다"가 어느 순간 다른 물리 GPU를 가리킬 위험이 있다. 노출 대상이 뒤집히면 숨기려던 GPU가 열리는 사고가 나니, 고정하려는 GPU의 UUID로 박아두는 편이 마음 편하다.

## 6. 남은 구멍: 파드가 직접 GPU를 훔쳐가는 문제

여기까지 하면 <b>스케줄러 눈</b>에서는 숨겨진다. 그런데 확인하다 찜찜한 걸 발견했다. 우리 클러스터는 containerd의 <b>기본 런타임이 `nvidia`</b>였다. 이 상태에선 파드가 `nvidia.com/gpu`를 요청(request)하지 않아도, 파드 명세에 `NVIDIA_VISIBLE_DEVICES` 환경변수만 직접 박으면 GPU를 그냥 가져다 쓸 수 있다. device-plugin을 거치지 않고 런타임 훅이 곧장 장치를 붙여주기 때문이다. 숨긴 GPU라도 인덱스나 UUID만 알면 파드가 훔쳐 쓸 수 있다는 뜻이다.

이건 스케줄링을 아무리 막아도 안 닫히는 구멍이라, 막으려면 결이 다른 통제가 필요하다.

- <b>nvidia-container-toolkit 설정</b>: `/etc/nvidia-container-runtime/config.toml`의 `accept-nvidia-visible-devices-envvar-when-unprivileged`를 꺼서, 비특권 컨테이너가 `NVIDIA_VISIBLE_DEVICES` 환경변수로 GPU를 잡는 걸 원천 차단한다. (여기까지 확인만 했고 운영 반영 전 테스트는 더 필요하다.)
- <b>RuntimeClass 분리</b>: 기본 런타임을 `nvidia`로 두지 말고, GPU가 필요한 파드만 명시적으로 nvidia RuntimeClass를 쓰게 한다.
- <b>Admission Controller / ResourceQuota</b>: `NVIDIA_VISIBLE_DEVICES` 같은 위험한 환경변수를 직접 박은 파드를 정책으로 걸러내거나, GPU 자원 총량을 네임스페이스 단위로 제한한다.

한 가지 더 삽질했던 것. 숨긴 GPU를 누가 몰래 쓰는지 보려고 파드 안에서 `nvidia-smi`를 돌렸는데 프로세스 목록이 비어 나왔다. `hostPID: true`를 줘야 호스트의 GPU 프로세스가 제대로 보였다. 다만 이건 파드의 프로세스 격리를 무너뜨리고 보안 구멍을 내는 옵션이라, 잠깐 진단할 때만 켰다가 바로 껐다. 상시로 켜둘 물건은 아니다.

## 참고

- [NVIDIA k8s-device-plugin](https://github.com/NVIDIA/k8s-device-plugin)
- [k8s-device-plugin #1189 — device filter (미병합)](https://github.com/NVIDIA/k8s-device-plugin/pull/1189)
- [GPU Operator — Time-Slicing GPUs](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/gpu-sharing.html)
- [[GPU 8장 서버를 VFIO 패스스루로 4분할해 클러스터에 나눠 붙이기|GPU를 물리적으로 쪼개 나눠 붙인 이야기]]
- [[신형 GPU에서 MIG 활성화의 숨은 전제 vBIOS 버전과 디스플레이 모드|MIG로 GPU를 분할하는 방법]]
