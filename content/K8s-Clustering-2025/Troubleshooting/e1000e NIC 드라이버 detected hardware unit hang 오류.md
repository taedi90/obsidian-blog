---
title: e1000e NIC 드라이버 detected hardware unit hang 오류 해결 과정
date: 2025-04-08
draft: false
tags:
  - Kubernetes
  - Troubleshooting
  - e1000e
  - NIC
  - Driver
  - Hang
  - Network
  - Kernel
description: Intel e1000e NIC의 detected hardware unit hang 오류. 전력 관리 기능과 네트워크 오프로딩을 꺼서 잡은 과정.
permalink: 
aliases:
completed: true
type:
  - issue
---

## 요약

> [!SUMMARY]
> Intel e1000e NIC 드라이버의 `detected hardware unit hang` 오류는 불안정한 전력 관리와 네트워크 오프로딩 기능이 원인이었다. 커널 파라미터를 수정하고 오프로딩을 꺼서 해결했다.

## 1. 환경

- OS: Rocky Linux 9
- Platform: Kubernetes
- Hardware: Intel <b>e1000e</b> 네트워크 인터페이스 카드(NIC)

## 2. 이슈

특정 노드 하나가 네트워크 통신이 완전히 마비됐다. Kubernetes 클러스터에서는 `NotReady`로 빠졌고, SSH를 포함한 모든 원격 접근이 끊겨 물리 콘솔로만 들어갈 수 있었다. 해당 노드 `dmesg`를 보니 `e1000e: detected hardware unit hang`이 계속 찍히고 있었다. 찾아보니 Intel e1000e NIC 드라이버가 특정 상황에서 하드웨어 정지(hang)를 일으키는, 꽤 알려진 고질병이었다.

주요 증상은 다음과 같았다.

- 네트워크 인터페이스가 아예 응답하지 않음
- 클러스터에서 해당 노드가 `NotReady`로 전환
- SSH를 포함한 모든 네트워크 연결 불가, 물리 콘솔로만 접근 가능

특이한 점은, 같은 하드웨어와 커널 버전을 쓰는 다른 노드는 멀쩡했고 유독 이 노드에서만 터졌다는 것이다.

## 3. 해결

여러 조치를 시도했다. 각 단계는 따로 적용해도 되고 몇 개를 겹쳐 적용해도 된다. 내 경우엔 2번과 3번을 함께 적용해서 최종적으로 문제를 잡았다.

### 1. 네트워크 트래픽 분산 (임시 조치)

먼저 원인이 과도한 트래픽일 가능성부터 줄여보려 했다. 로드 밸런서(FortiGate Virtual Server)의 분배 방식을 손봤다. 기존 균등 분배(Round Robin) 대신 문제 노드의 가중치(weight)를 낮추고 안정적인 노드의 가중치를 높여 트래픽을 최소화했다. 증상이 잠깐 완화되긴 했지만, 예상대로 근본 해결은 아니었다.

### 2. 커널 파라미터 조정 (전력 관리 기능 비활성화)

찾아보니 e1000e 드라이버의 절전 기능이 hang의 주요 원인으로 지목되는 경우가 많았다. 그래서 관련 전력 관리 기능을 꺼서 안정성을 확보하기로 했다.

> [!IMPORTANT]
> e1000e hang 이슈의 가장 유력한 원인은 드라이버의 전력 관리 기능으로 알려져 있다. 이것만 꺼도 해결되는 경우가 많다.

`/etc/default/grub`을 열어 `GRUB_CMDLINE_LINUX`에 아래 파라미터를 추가한다.

```bash
# PCIe 활성 상태 전원 관리(ASPM), 스마트 전원 끄기(SmartPowerDown), 에너지 효율 이더넷(EEE) 기능을 비활성화한다.
pcie_aspm=off e1000e.SmartPowerDownEnable=0 e1000e.EEE=0
```

각 파라미터의 의미는 다음과 같다.

| 파라미터                       | 설명                                                                      | 비활성화 이유                                                 |
| ------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `pcie_aspm=off`                | PCIe 활성 상태 전원 관리(Active-State Power Management, ASPM) 비활성화 | NIC가 절전 모드에서 복귀할 때 발생하는 충돌을 방지한다.       |
| `e1000e.SmartPowerDownEnable=0`  | 스마트 전원 끄기(Smart Power Down) 기능 비활성화                      | NIC가 저전력 모드에서 복귀할 때 발생하는 hang을 방지한다.     |
| `e1000e.EEE=0`                 | 에너지 효율 이더넷(Energy-Efficient Ethernet, EEE) 비활성화           | 유휴 상태와 활성 상태 간 전환 시 발생하는 지연 및 오류를 방지한다. |

> [!NOTE]
> `e1000e.EEE=0`는 커널·드라이버 버전에 따라 모듈 파라미터로 존재하지 않을 수 있다. 이 경우 부팅 시 조용히 무시되니, 적용 후 `modinfo -p e1000e`로 `EEE`가 실제 옵션 목록에 있는지 확인하는 게 좋다. 없다면 `ethtool --set-eee <인터페이스명> eee off`로 대신 끄면 된다.

설정을 시스템에 반영하고 재부팅해 적용한다.

```bash
# GRUB 설정을 업데이트한다.
sudo grub2-mkconfig -o /boot/grub2/grub.cfg

# 시스템을 재부팅하여 변경사항을 적용한다.
sudo reboot
```

### 3. 네트워크 오프로딩(Offloading) 기능 비활성화

TCP 분할 오프로드(TCP Segmentation Offload, TSO), 일반 분할 오프로드(Generic Segmentation Offload, GSO) 같은 오프로딩 기능이 드라이버와 충돌할 수 있다고 봤다. 이 기능들은 CPU 부하를 줄여주지만, 특정 드라이버와는 호환성 문제를 일으키기도 한다.

부팅 시 자동으로 오프로딩을 끄도록 `systemd` 서비스를 만들었다.

```bash
# /etc/systemd/system/disable-nic-offload.service 파일을 생성하고 서비스 내용을 작성한다.
# ExecStart의 [인터페이스명]은 실제 환경에 맞게 수정해야 한다.
sudo tee /etc/systemd/system/disable-nic-offload.service > /dev/null <<EOF
[Unit]
Description=Disable NIC offloading features
After=network.target

[Service]
Type=oneshot
ExecStart=/usr/sbin/ethtool -K [인터페이스명] tso off gso off gro off rx off tx off
RemainAfterExit=true

[Install]
WantedBy=multi-user.target
EOF
```

서비스를 시스템에 등록하고 활성화한다.

```bash
# systemd 데몬을 리로드하여 새 서비스 파일을 인식시킨다.
sudo systemctl daemon-reload

# 서비스를 활성화하고 즉시 시작한다.
sudo systemctl enable --now disable-nic-offload.service
```

### 4. 드라이버 모듈 옵션 설정

`modprobe` 설정으로 e1000e 드라이버 동작을 직접 제어하는 방법도 있다. `/etc/modprobe.d/e1000e.conf`를 만들어 인터럽트 발생 빈도와 전력 관리 옵션을 조정한다.

```bash
# /etc/modprobe.d/e1000e.conf
# Intel e1000e 드라이버 안정화 설정

# 인터럽트 발생 빈도를 낮춰 시스템 부하를 줄임 (숫자가 클수록 빈도 낮아짐)
options e1000e InterruptThrottleRate=3000

# 전력 절약 기능 비활성화
options e1000e SmartPowerDownEnable=0
```

변경한 모듈 옵션은 `initramfs`에 반영하고 재부팅해야 적용된다.

```bash
# 변경된 모듈 설정을 initramfs에 반영한다.
sudo dracut -f

# 시스템을 재부팅한다.
sudo reboot
```

## 4. 확인

설정이 제대로 반영됐는지 확인하는 방법은 다음과 같다.

오프로딩 기능 확인. `ethtool`로 `tso`, `gso` 등 주요 오프로딩이 `off`인지 본다.

```bash
ethtool -k <인터페이스명> | grep -E "segmentation-offload|checksum-offload"
# tcp-segmentation-offload: off (성공)
# generic-segmentation-offload: off (성공)
# rx-checksumming: off (성공)
# tx-checksumming: off (성공)
```

커널 파라미터 확인. 부팅 시 적용된 파라미터에 `pcie_aspm=off` 등이 들어갔는지 본다.

```bash
cat /proc/cmdline
```

드라이버 모듈 옵션 확인. `modinfo`로 e1000e에 설정 가능한 파라미터를 확인할 수 있다.

```bash
modinfo -p e1000e
```

시스템 로그 확인. 마지막으로 로그에 더 이상 `e1000e` hang 오류가 찍히지 않는지 계속 지켜본다.

```bash
dmesg | grep e1000e
```

## 참고

- [Proxmox Forum: Intel NIC e1000e hardware unit hang](https://forum.proxmox.com/threads/intel-nic-e1000e-hardware-unit-hang.106001/)
