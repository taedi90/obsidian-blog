---
title: 신형 Blackwell GPU가 안 잡힐 때 OS·드라이버 조합 매트릭스로 뚫기
date: 2025-07-30
draft: false
tags:
  - nvidia
  - gpu
  - driver
  - troubleshooting
  - offline-install
banner:
cssclasses:
description: 레퍼런스가 거의 없는 신형 GPU 드라이버가 안 잡히던 걸, OS와 드라이버를 조합해 표로 실험해 동작 조합을 찾고 오프라인 플레이북으로 굳힌 기록.
permalink:
aliases:
completed: true
type:
  - issue
---

## 요약

> [!SUMMARY]
> NVIDIA RTX PRO 6000(Blackwell) GPU가 `nvidia-smi`에서 `No devices were found`로 안 잡혔다. BIOS에서 fastboot·CSM·secure boot를 끄고, OS(Rocky 9.5/9.6·Ubuntu 24.04)와 드라이버(570/575/580의 open·dkms·server 계열)를 표로 조합해 돌려보니 <b>open 커널 모듈 계열 + 충분히 최신인 OS 커널</b>일 때만 동작했다. 이 동작 조합을 오프라인 설치 플레이북으로 표준화했다.

## 1. 환경

- GPU: NVIDIA RTX PRO 6000 (Blackwell)
- OS 후보: Rocky 9.5 / 9.6, Ubuntu 24.04
- 드라이버 후보: 570 / 575 / 580 브랜치 (open · dkms · server 계열)

## 2. 이슈

곧 고객사 프로젝트에 같은 모델을 납품할 예정이라, 사내에서 미리 물려보고 검증하려고 새 워크스테이션에 카드를 꽂았다. 그런데 OS를 올리고 드라이버를 깐 뒤 `nvidia-smi`를 치니 이게 나왔다.

```text
No devices were found
```

드라이버는 분명 설치됐는데 장치가 안 잡힌다. `dmesg`를 보니 커널 모듈 쪽에서 걸려 있었다.

```text
[drm:nv_drm_load [nvidia_drm]] *ERROR* [nvidia-drm] [GPU ID 0x00002100] Failed to allocate NvKmsKapiDevice
[drm:nv_drm_probe_devices [nvidia_drm]] *ERROR* [nvidia-drm] [GPU ID 0x00002100] Failed to register device
```

`NvKmsKapiDevice` 할당에 실패하고 장치 등록까지 못 가는 상황이다. 커널 모듈이 로드는 되는데 실제 GPU에 붙지를 못하는 것이다. 처음엔 흔한 커널 헤더 문제인 줄 알고 `kernel`, `kernel-modules`를 추가로 깔아봤는데 증상은 그대로였다.

문제는 이 카드가 <b>갓 나온 신형 아키텍처</b>라 참고할 사례가 거의 없다는 점이었다. 검색해도 나오는 건 한두 세대 전 카드 이야기뿐이고, "이 OS에 이 드라이버 깔면 된다"는 딱 떨어지는 답이 없었다. 그러면 직접 조합을 돌려보는 수밖에 없다.

## 3. 해결

### 1. BIOS (fastboot·CSM·secure boot)

신형 GPU + 커널 모듈 조합에서 흔히 발목 잡는 게 펌웨어 설정이라, 먼저 BIOS부터 정리했다.

- fastboot 비활성화 — 부팅 시 장치 초기화를 건너뛰지 않게
- CSM(레거시 부팅) 비활성화 — 순수 UEFI로
- secure boot 비활성화 — 서명 안 된 커널 모듈이 막히지 않게

fastboot만 껐을 땐 증상이 그대로였다. 셋을 다 끄고 나서야 뒤에 이어질 드라이버 조합 실험이 그나마 변수를 줄인 상태에서 굴러갔다. (secure boot는 모듈 서명을 붙이면 켠 채로도 되지만, 검증 단계에선 변수를 줄이는 게 우선이라 껐다.)

### 2. 어떤 드라이버를 써야 하나

BIOS를 정리하고도 어떤 조합은 되고 어떤 조합은 안 됐다. 여기서 갈린 게 <b>드라이버의 커널 모듈 종류</b>였다.

NVIDIA 드라이버는 커널 모듈이 크게 두 갈래다. 예전부터 쓰던 독점(proprietary) 모듈과, 최근 주력으로 넘어온 open 커널 모듈. NVIDIA는 신형 아키텍처부터 open 커널 모듈을 표준으로 밀고 있고, 신형 실리콘 지원도 open 쪽이 먼저 붙는다. 그래서 패키지 이름에 `-open`이 붙은 계열과 그렇지 않은 계열(`-dkms`, `-server`)이 결과를 갈랐다.

> [!NOTE]
> Ubuntu의 `nvidia-driver-XXX-server`는 데이터센터용 독점 드라이버, `-server-open`과 `-open`은 open 커널 모듈 버전이다. Rocky(RHEL 계열)는 `dnf module`의 스트림으로 `XXX-open`과 `XXX-dkms`가 나뉜다. 이름이 비슷해서 헷갈리는데, 신형 카드에서는 "open이 붙었는가"가 핵심이었다.

### 3. OS·드라이버 조합 매트릭스

레퍼런스가 없으니 그냥 표를 만들어 하나씩 돌렸다. OS를 세로, 드라이버 브랜치·종류를 안쪽에 두고 `nvidia-smi`가 GPU를 잡는지로 성공/실패를 채웠다.

| OS | 드라이버 | 결과 | 비고 |
| --- | --- | --- | --- |
| Rocky 9.5 | 570-dkms | 실패 | |
| | 570-open | 실패 | |
| Ubuntu 24.04 | 575-dkms | 실패 | |
| | 570-server | 실패 | 독점 서버 드라이버 |
| | 570-server-open | 성공 | |
| | 575-open | 성공 | |
| Rocky 9.6 | 570-open | 성공 | 570.172.08 |
| | 580-open | 성공 | |
| | 580-dkms | 실패 | |

표를 채우고 나니 두 가지가 보였다.

<b>첫째, open 계열이라야 붙었다.</b> `-dkms`나 독점 `-server`는 브랜치를 바꿔봐도 계속 실패했고, `-open`·`-server-open`은 성공했다. 신형 아키텍처 지원이 open 커널 모듈로 먼저 들어온다는 이야기가 실제로 그대로 나타난 셈이다.

<b>둘째, OS 커널 버전도 변수였다.</b> 같은 `570-open`인데 Rocky 9.5에선 실패하고 9.6에선 성공했다. 드라이버만 맞추면 되는 게 아니라, OS가 얹고 나오는 커널이 이 신형 카드를 받아줄 만큼 최신이어야 했다. 9.5의 커널 베이스가 낡아서 open 모듈이 카드에 못 붙었고, 9.6이 새 커널을 물고 나오면서 풀린 것으로 봤다. "드라이버가 문제"라고만 생각하다가는 못 잡는 부분이었다.

> [!IMPORTANT]
> 그래서 결론은 하나의 버전 숫자가 아니라 <b>조합</b>이었다. "open 커널 모듈 + 그 카드를 받아줄 만큼 최신인 OS 커널". Rocky는 9.6 이상 + `XXX-open`, Ubuntu는 24.04 + `XXX-open`/`server-open`으로 가면 됐다.

### 4. 오프라인 설치 플레이북으로 표준화

동작 조합을 찾았으니, 다음에 같은 카드를 또 세팅할 때 이 삽질을 반복하지 않게 설치 과정을 플레이북으로 굳혔다. 납품 환경이 대체로 폐쇄망이라 오프라인 설치가 기본 전제였다.

Ubuntu는 open/server-open 드라이버를 이렇게 정리했다.

```bash
# 기존 nvidia 패키지를 완전히 걷어내고 (조합 실험 잔재 제거)
sudo apt-get remove --purge 'nvidia-*'
sudo apt-get autoremove && sudo apt-get clean

# 최신 드라이버 저장소를 붙인 뒤 open 계열로 설치
sudo add-apt-repository ppa:graphics-drivers/ppa
sudo apt update
ubuntu-drivers devices            # 카드에 권장되는 드라이버 확인
sudo apt install nvidia-driver-575-open
```

Rocky는 `dnf module`에서 open 스트림만 켜서 설치했다.

```bash
# CUDA 저장소를 붙이고
sudo dnf config-manager --add-repo \
  https://developer.download.nvidia.com/compute/cuda/repos/rhel9/x86_64/cuda-rhel9.repo

dnf module list nvidia-driver     # 사용 가능한 스트림 확인
sudo dnf module enable nvidia-driver:580-open -y   # open 스트림만 활성화
sudo dnf module install nvidia-driver:580-open -y
```

폐쇄망에서 쓰려고 패키지를 세 범주로 나눠 미리 받아뒀다.

- 기본 패키지: `kernel-devel`, `kernel-headers`, `dkms`, 빌드 도구 등 (실행 중인 커널 버전과 맞아야 모듈이 빌드된다)
- 추가 패키지: 컨테이너에서 GPU를 쓰기 위한 NVIDIA Container Toolkit
- NVIDIA 패키지: 드라이버와 CUDA 런타임

open을 주력으로 두되 dkms 계열도 같이 받아 로컬 리포에 굽어뒀다. 카드나 커널이 조금 달라졌을 때 fallback으로 둘 다 손에 쥐고 있는 편이 마음 편했다. (지난 세대 카드에서 설치 순서가 꼬여 애먹은 적이 있어서, 커널 헤더/devel을 드라이버보다 먼저 깔도록 순서도 플레이북에 박아뒀다.)

## 4. 확인

가장 먼저 GPU가 잡히는지부터 봤다.

```bash
# GPU 목록과 드라이버/CUDA 버전이 뜨면 성공
nvidia-smi
```

`No devices were found` 대신 카드가 목록에 뜨고, `dmesg`에 `NvKmsKapiDevice` 에러가 더 안 올라오면 커널 모듈이 제대로 붙은 것이다. 마지막으로 컨테이너 런타임에서도 GPU가 넘어오는지 확인했다.

```bash
# 컨테이너 안에서 GPU가 보이는지 (Container Toolkit 동작 확인)
docker run --rm --gpus all ubuntu:24.04 nvidia-smi
```

여기까지 통과하면 이 워크스테이션은 클러스터 워커로 붙일 준비가 된 것이다. 신형이라 답이 없던 카드가, 표 한 장으로 재현 가능한 조합이 됐다.

## 참고

- [NVIDIA Transitions Fully Towards Open-Source GPU Kernel Modules](https://developer.nvidia.com/ko-kr/blog/nvidia-transitions-fully-towards-open-source-gpu-kernel-modules/)
- [NVIDIA Datacenter Driver Installation Guide](https://docs.nvidia.com/datacenter/tesla/driver-installation-guide/index.html)
- [NVIDIA open-gpu-kernel-modules](https://github.com/NVIDIA/open-gpu-kernel-modules)
- [NVIDIA Container Toolkit 설치](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)
- [[폐쇄망 RHEL에서 드라이버 호환 커널로 되돌리기|드라이버에 맞춰 커널을 되돌린 후속]]
- [[신형 GPU에서 MIG 활성화의 숨은 전제 vBIOS 버전과 디스플레이 모드|드라이버를 잡은 뒤 MIG를 켜며 만난 벽]]
