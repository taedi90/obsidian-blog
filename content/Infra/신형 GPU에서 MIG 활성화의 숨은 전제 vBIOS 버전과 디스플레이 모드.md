---
title: 신형 GPU에서 MIG 활성화의 숨은 전제 vBIOS 버전과 디스플레이 모드
date: 2025-07-29
draft: false
tags:
  - nvidia
  - mig
  - gpu
  - kubernetes
  - troubleshooting
banner: 
cssclasses: 
description: 새로 들인 Blackwell 워크스테이션 GPU에서 MIG가 Not Supported로 막혀, 드라이버·vBIOS·디스플레이 모드 세 요건으로 원인을 좁힌 기록.
permalink: 
aliases: 
completed: true
type:
  - issue
---

## 요약

> [!SUMMARY]
> 새로 들인 Blackwell 워크스테이션 GPU에서 `nvidia-smi -mig 1`이 `Not Supported`로 막혔다. 카드 불량이 아니라 요건 미충족이었고, 원인을 <b>드라이버 575 이상 + vBIOS 최소 버전 + displayMode를 graphics에서 compute로 전환</b> 세 가지로 좁혔다. vBIOS는 직접 못 구해 리셀러에 요청하고, displayMode는 `displayModeSelector`로 바꾸는 식으로 대응했다.

## 1. 환경

- OS: Rocky 9.6 (`5.14.0-570.33.2.el9_6.x86_64`)
- GPU: NVIDIA RTX PRO 6000 Blackwell Workstation Edition (96GB)
- Driver: 580.65.06
- vBIOS: 98.02.52.00.02

## 2. 이슈

MIG(Multi-Instance GPU)로 카드 한 장을 여러 인스턴스로 쪼개 쓰려고 활성화를 시도했는데 바로 막혔다.

```bash
# MIG 모드 켜기 시도
$ sudo nvidia-smi -mig 1
Unable to enable MIG Mode for GPU 00000000:21:00.0: Not Supported
Treating as warning and moving on.
All done.
```

`nvidia-smi`에서 MIG 상태는 `N/A`로 떴고, 프로파일 목록을 물어봐도 지원 기기가 없다는 답이 돌아왔다.

```bash
$ nvidia-smi mig -lgip
No MIG-supported devices found.
```

처음엔 카드가 불량인가 싶었다. 그런데 이 모델은 스펙상 MIG를 지원하는 카드다(그러니까 산 거고). 드라이버도 최신이라 "지원 안 함"이라는 메시지가 오히려 이상했다. 하드웨어 문제라기보다는 <b>내가 전제 조건 중 일부를 채우지 않은</b> 쪽에 가깝다고 판단했다.

## 3. 해결

### 1. 공식 요건으로 좁히기

MIG는 카드가 지원 목록에 있다고 바로 켜지는 게 아니었다. [MIG User Guide의 Prerequisites](https://docs.nvidia.com/datacenter/tesla/mig-user-guide/#prerequisites)와, Blackwell 세대 워크스테이션 카드에만 붙는 [추가 요건](https://docs.nvidia.com/datacenter/tesla/mig-user-guide/#additional-prerequisites-for-rtx-pro-blackwell-gpus)을 같이 읽으니 조건이 세 개로 정리됐다.

- <b>nvidia-driver 575.51.03 이상</b>
- <b>vBIOS 98.02.55.00.00 이상</b> (워크스테이션 에디션 기준)
- <b>displayMode를 compute로 전환</b> (기본값은 graphics)

내 환경과 하나씩 맞춰봤다. 드라이버는 580.65.06이라 요건을 충족했다. 문제는 나머지 두 항목이었다. vBIOS가 `98.02.52.00.02`라서 요구 버전인 `...55...`에 미달했고, 워크스테이션 카드라 출고 상태가 그래픽 출력용(graphics) 모드였다. `Not Supported`의 정체는 이 두 조건이었던 셈이다.

vBIOS와 현재 표시 모드는 `nvidia-smi -q`로 확인할 수 있다.

```bash
# VBIOS Version, Display Mode 같은 상세 속성을 한 번에 조회
nvidia-smi -q
```

### 2. vBIOS와 displayMode 대응

두 요건은 대응 방법이 서로 달랐다.

<b>vBIOS.</b> 이것은 내가 임의로 받아서 플래싱할 수 있는 대상이 아니었다. 카드용 vBIOS 이미지는 공개 배포처가 없으므로, 구매처(리셀러)에 최소 버전 이상으로 올려달라고 요청하는 방법밖에 없었다. 결국 담당자에게 메일을 보내는 것이 해결책이라 다소 아쉬웠지만, 펌웨어는 본래 그런 영역이다.

<b>displayMode.</b> 이쪽은 직접 변경할 수 있었다. NVIDIA가 제공하는 [displayModeSelector](https://developer.nvidia.com/display-mode-selector-tool-home) 바이너리로 graphics ↔ compute를 전환한다(다운로드에는 developer 계정 가입이 필요하다). 워크스테이션 카드는 화면 출력 용도이므로 기본값이 graphics인데, MIG를 사용하려면 디스플레이 출력을 끄는 compute 모드여야 한다.

> [!NOTE]
> compute 모드로 바꾸면 그 카드로는 화면 출력을 할 수 없다. 처음엔 "되돌릴 수 있는지, 잘못 건드리면 카드를 사용할 수 없게 되는 것은 아닌지" 걱정했지만, 같은 `displayModeSelector`로 다시 graphics로 되돌릴 수 있다. 어차피 이 카드는 연산 전용으로 장착할 예정이라 화면 출력은 애초에 필요 없었다.

### 3. MIG 프로파일과 디바이스 플러그인 라벨

요건을 모두 충족하면 그 뒤 흐름은 표준적이다. MIG를 활성화하고, 프로파일로 인스턴스를 나눈 다음, 쿠버네티스가 그 인스턴스를 인식하도록 설정하면 된다.

먼저 카드가 실제로 어떤 분할을 지원하는지 프로파일 목록을 확인한다. 프로파일 ID는 카드 세대와 용량마다 다르므로 문서 예시를 그대로 복사하지 말고 실제 기기에서 조회해야 한다.

```bash
# MIG 활성화 후, 이 카드가 지원하는 GPU 인스턴스 프로파일 목록 조회
sudo nvidia-smi -mig 1
nvidia-smi mig -lgip
```

여기서 나온 ID로 인스턴스를 생성한다. 이 카드는 최대 4개 인스턴스로 나뉜다. 아래는 프로파일 ID를 나열해 인스턴스를 만드는 형태(ID 값은 `-lgip` 결과 기준으로 채운다).

```bash
# 프로파일 ID를 나열해 GPU 인스턴스를 생성 (예시, 실제 ID는 -lgip에서 확인)
sudo nvidia-smi mig -cgi <profile-id>,<profile-id>,... -C
```

`nvidia-smi`만으로도 기본 파티셔닝은 가능하지만, 노드 수가 늘고 카드별로 분할 형상을 다르게 유지하려면 [nvidia-mig-parted](https://github.com/NVIDIA/mig-parted)로 원하는 구성을 선언형(declarative)으로 정의해두는 편이 관리에 유리하다.

쿠버네티스 쪽은 [NVIDIA device plugin](https://docs.nvidia.com/datacenter/cloud-native/kubernetes/latest/index.html)이 붙는다. MIG 전략(`single`/`mixed`)에 따라 device plugin이 노드에 자동으로 라벨을 달아준다. mixed 전략이면 인스턴스 형상이 이런 이름으로 리소스화된다.

```text
# 분할 구성에 따라 노드에 자동으로 붙는 MIG 리소스 라벨 형태
nvidia.com/mig-<slice_count>g.<memory_size>gb
```

파드는 `nvidia.com/gpu` 대신 이 리소스 이름을 `resources.limits`로 요청하여 분할된 인스턴스 하나를 할당받는다. 카드 한 장을 여러 워크로드가 나눠 쓰도록 만드는 것이 애초에 MIG를 도입한 목적이었다.

## 4. 확인

세 요건을 모두 충족하면 활성화 자체가 경고 없이 통과하고, 프로파일 목록이 정상적으로 출력된다.

```bash
# MIG 상태와 지원 프로파일이 뜨는지 확인
nvidia-smi                # MIG 열이 N/A가 아니라 Enabled로 표기
nvidia-smi mig -lgip      # "No MIG-supported devices found"가 아니라 프로파일 목록 출력
```

쿠버네티스에서는 device plugin이 배포된 뒤 노드에 `nvidia.com/mig-*` 리소스가 등장하는지 확인한다.

```bash
# 노드에 MIG 리소스가 등록됐는지 확인
kubectl describe node <gpu-node> | grep nvidia.com/mig
```

다만 이 글을 쓰는 시점에는 vBIOS 회신을 기다리는 중이라 활성화까지 완전히 마치지 못했다. `Not Supported`가 카드 문제가 아니라 드라이버·펌웨어·표시 모드라는 세 전제 조건 문제였다는 사실, 그리고 각각을 리셀러 요청과 `displayModeSelector`로 나누어 처리해야 한다는 사실까지 규명한 단계다. vBIOS만 업그레이드되면 위 확인 절차대로 마무리된다.

## 참고

- [MIG User Guide — Prerequisites](https://docs.nvidia.com/datacenter/tesla/mig-user-guide/#prerequisites)
- [MIG User Guide — Additional Prerequisites for RTX PRO Blackwell GPUs](https://docs.nvidia.com/datacenter/tesla/mig-user-guide/#additional-prerequisites-for-rtx-pro-blackwell-gpus)
- [Display Mode Selector Tool](https://developer.nvidia.com/display-mode-selector-tool-home)
- [NVIDIA device plugin for Kubernetes](https://docs.nvidia.com/datacenter/cloud-native/kubernetes/latest/index.html)
- [nvidia/mig-parted](https://github.com/NVIDIA/mig-parted)
- [[신형 Blackwell GPU 드라이버가 안 잡힐 때 OS·드라이버 조합 매트릭스로 뚫기|MIG 이전에 드라이버부터 잡은 이야기]]
- [[특정 노드의 특정 GPU만 쿠버네티스에서 숨기기|GPU를 쿠버네티스에 노출·분할하는 다른 방법]]
