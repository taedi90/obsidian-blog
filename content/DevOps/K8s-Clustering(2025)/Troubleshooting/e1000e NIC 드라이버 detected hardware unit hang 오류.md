---
title: e1000e NIC 드라이버 detected hardware unit hang 오류 해결 과정
date: 2025-07-10
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
description: Intel e1000e NIC 드라이버에서 발생하는 'detected hardware unit hang' 오류의 원인 분석과 커널 파라미터 조정, 네트워크 오프로딩 비활성화 등 다양한 해결 방법을 실제 경험을 바탕으로 서술한다.
permalink: 
aliases: 
completed: true
type:
  - issue
---

## 🚀 요약

> [!SUMMARY]
> Intel e1000e NIC 드라이버의 `detected hardware unit hang` 오류는 불안정한 전력 관리 및 네트워크 오프로딩 기능이 원인이었다. 커널 파라미터 수정과 오프로딩 기능 비활성화를 통해 문제를 해결했다.

## ⚙️ 환경

- <b>OS</b>: Rocky Linux 9
- <b>Platform</b>: Kubernetes
- <b>Hardware</b>: Intel e1000e 네트워크 인터페이스 카드(NIC)

## 💬 이슈

<b>Kubernetes</b> 노드 중 특정 노드가 네트워크 통신이 완전히 마비되어 Kubernetes 클러스터에서 노드가 `NotReady` 상태로 바뀌었고, SSH 접속을 포함한 모든 원격 접근이 불가능해지는 상황이 발생했다. 원인을 파악해보니 해당 노드의 `dmesg`에서 `e1000e: detected hardware unit hang` 오류 메시지가 지속적으로 출력되는 현상을 목격했고 Intel <b>e1000e</b> NIC 드라이버가 특정 상황에서 하드웨어 정지(hang)를 유발하는 고질적인 이슈가 있는 것을 알게 되었다.

- <b>주요 증상</b>
    - 서버의 네트워크 인터페이스가 응답하지 않음
    - Kubernetes 클러스터에서 해당 노드가 <b>`NotReady`</b> 상태로 전환
    - <b>SSH</b>를 포함한 모든 네트워크 연결이 불가능해져 물리 콘솔로만 접근 가능

- <b>특이사항</b>
    - 동일한 하드웨어와 커널 버전을 사용하는 다른 노드에서는 문제가 발생하지 않고 특정 노드에서만 문제가 나타남

## 🧗 해결

이 문제를 해결하기 위해 여러 조치를 시도했다. 각 단계는 독립적으로 적용하거나 여러 단계를 함께 적용할 수 있으며, 나의 경우 <b>2번과 3번 방법을 함께 적용</b>하여 최종적으로 문제를 해결할 수 있었다.

### 1. 네트워크 트래픽 분산 (임시 조치)

가장 먼저 시도한 것은 문제의 원인이 과도한 트래픽일 가능성을 줄여보는 것이었다. 이를 위해 로드 밸런서(FortiGate Virtual Server)의 분배 방식을 조정했다.

- <b>방법</b>: 기존의 균등 분배(Round Robin) 방식 대신, 문제가 발생한 노드의 가중치(weight)를 낮추고 안정적인 다른 노드의 가중치를 높여 트래픽 최소화
- <b>결과</b>: 이 방법은 일시적으로 증상을 완화할 수는 있었지만, 근본적인 해결책은 아니라고 판단

### 2. 커널 파라미터 조정 (전력 관리 기능 비활성화)

조사 결과, e1000e 드라이버의 절전 기능이 하드웨어 정지(hang)의 주요 원인으로 지목하는 경우가 많았다. 따라서 관련 전력 관리 기능을 비활성화하여 안정성을 확보하고자 했다.

> [!IMPORTANT]
> <b>e1000e hang 이슈의 가장 유력한 원인</b>은 드라이버의 전력 관리 기능과 관련이 있는 것으로 알려졌다. 대부분의 경우 이 기능을 비활성화하는 것만으로도 문제가 해결될 수 있다.

<b>방법</b>
`/etc/default/grub` 파일을 열어 `GRUB_CMDLINE_LINUX` 항목에 아래 파라미터를 추가하여 관련 기능을 비활성화한다.

```bash
# PCIe 활성 상태 전원 관리(ASPM), 스마트 전원 끄기(SmartPowerDown), 에너지 효율 이더넷(EEE) 기능을 비활성화한다.
pcie_aspm=off e1000e.SmartPowerDownEnable=0 e1000e.EEE=0
```

<b>파라미터 상세 설명</b>

| 파라미터                       | 설명                                                                      | 비활성화 이유                                                 |
| ------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `pcie_aspm=off`                | <b>PCIe 활성 상태 전원 관리(Active-State Power Management, ASPM)</b> 비활성화 | NIC가 절전 모드에서 복귀할 때 발생하는 충돌을 방지한다.       |
| `e1000e.SmartPowerDownEnable=0`  | <b>스마트 전원 끄기(Smart Power Down)</b> 기능 비활성화                      | NIC가 저전력 모드에서 복귀할 때 발생하는 hang을 방지한다.     |
| `e1000e.EEE=0`                 | <b>에너지 효율 이더넷(Energy-Efficient Ethernet, EEE)</b> 비활성화           | 유휴 상태와 활성 상태 간 전환 시 발생하는 지연 및 오류를 방지한다. |

<b>적용</b>
아래 명령어를 실행해 GRUB 설정을 시스템에 반영하고 재부팅하여 변경된 커널 파라미터를 적용한다.

```bash
# GRUB 설정을 업데이트한다.
sudo grub2-mkconfig -o /boot/grub2/grub.cfg

# 시스템을 재부팅하여 변경사항을 적용한다.
sudo reboot
```

### 3. 네트워크 오프로딩(Offloading) 기능 비활성화

<b>TCP 분할 오프로드(TCP Segmentation Offload, TSO)</b>, <b>일반 분할 오프로드(Generic Segmentation Offload, GSO)</b> 등과 같은 네트워크 오프로딩 기능이 드라이버와 충돌을 일으킬 수 있다고 보았다. 이 기능들은 CPU의 부하를 줄여주지만, 특정 드라이버와 호환성 문제를 일으키기도 한다.

<b>방법</b>
`systemd` 서비스를 생성하여 부팅 시 자동으로 오프로딩 기능을 비활성화하도록 설정했다.

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

<b>적용</b>
아래 명령어를 통해 생성한 `systemd` 서비스를 시스템에 등록하고 활성화한다.

```bash
# systemd 데몬을 리로드하여 새 서비스 파일을 인식시킨다.
sudo systemctl daemon-reload

# 서비스를 활성화하고 즉시 시작한다.
sudo systemctl enable --now disable-nic-offload.service
```

### 4. 드라이버 모듈 옵션 설정

`modprobe` 설정을 통해 e1000e 드라이버의 동작 방식을 직접 제어하는 방법도 있다.

<b>방법</b>
`/etc/modprobe.d/e1000e.conf` 파일을 생성하고 다음 내용을 추가하여 인터럽트 발생 빈도와 전력 관리 옵션을 조정한다.

```bash
# /etc/modprobe.d/e1000e.conf
# Intel e1000e 드라이버 안정화 설정

# 인터럽트 발생 빈도를 낮춰 시스템 부하를 줄임 (숫자가 클수록 빈도 낮아짐)
options e1000e InterruptThrottleRate=3000

# 전력 절약 기능 비활성화
options e1000e SmartPowerDownEnable=0
```

<b>적용</b>
변경된 모듈 옵션을 `initramfs`에 반영하고 재부팅해야 적용된다.

```bash
# 변경된 모듈 설정을 initramfs에 반영한다.
sudo dracut -f

# 시스템을 재부팅한다.
sudo reboot
```

## ✅ 확인

설정이 올바르게 반영되었는지 확인하는 방법은 다음과 같다.

<b>오프로딩 기능 확인</b>
아래 `ethtool` 명령어를 실행하여, `tso`, `gso` 등 주요 오프로딩 기능이 `off` 상태인지 확인한다.

```bash
ethtool -k <인터페이스명> | grep -E "segmentation-offload|checksum-offload"
# tcp-segmentation-offload: off (성공)
# generic-segmentation-offload: off (성공)
# rx-checksumming: off (성공)
# tx-checksumming: off (성공)
```

<b>커널 파라미터 확인</b>
부팅 시 적용된 커널 파라미터 목록을 확인하여 `pcie_aspm=off` 등이 포함되었는지 검사한다.

```bash
cat /proc/cmdline
```

<b>드라이버 모듈 옵션 확인</b>
`modinfo` 명령어로 e1000e 드라이버에 설정 가능한 파라미터와 현재 설정된 값을 확인할 수 있다.

```bash
modinfo -p e1000e
```

<b>시스템 로그 확인</b>
마지막으로, 시스템 로그에서 더 이상 `e1000e` 관련 hang 오류가 발생하는지 지속적으로 모니터링한다.

```bash
dmesg | grep e1000e
```

## 🔗 참고

- [Proxmox Forum: Intel NIC e1000e hardware unit hang](https://forum.proxmox.com/threads/intel-nic-e1000e-hardware-unit-hang.106001/)