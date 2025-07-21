---
title: 쿠버네티스 클러스터를 위한 LVM 스토리지 구성
date: 2025-03-30
draft: false
tags:
  - lvm
  - storage
  - linux
  - kubernetes
  - longhorn
  - nfs
banner: 
cssclasses: 
description: 쿠버네티스 클러스터의 NFS와 Longhorn을 위한 LVM 스토리지 구성 방법과 운영 중 디스크 추가/제거 방법을 정리
permalink: 
aliases: 
completed: 
type:
  - note
---

## 1. 개요

쿠버네티스 클러스터에서 영구 스토리지를 제공하기 위해 NFS와 Longhorn을 구성하기로 결정했다. 이들이 사용할 스토리지는 여러 하드디스크를 **LVM(Logical Volume Manager)**으로 묶어서 사용하기로 했다.

> [!NOTE]
> LVM을 사용하면 여러 물리 디스크를 하나의 논리적 볼륨으로 관리할 수 있어, 스토리지 확장과 관리가 용이하다. 특히 운영 중에도 디스크를 추가하거나 제거할 수 있어 유연성이 높다.

이 글에서는 LVM을 생성하고 운영하는 과정에서 필요한 디스크 추가/제거 방법을 정리했다.

## 2. 환경

- **OS**: Rocky Linux 9
- **용도**: 쿠버네티스 클러스터 스토리지 (NFS, Longhorn)
- **파일 시스템**: ext4

## 3. 초기 LVM 구성

### 3-1. LVM 도구 설치

먼저 LVM을 관리하기 위한 도구를 설치한다.

```bash
dnf install lvm2
```

### 3-2. 물리 볼륨 생성

스토리지로 사용할 디스크들을 물리 볼륨으로 초기화한다.

```bash
pvcreate /dev/sda /dev/sdb
```

여러 디스크를 한 번에 물리 볼륨으로 생성하는 명령어다.

### 3-3. 볼륨 그룹 생성

물리 볼륨들을 하나의 볼륨 그룹으로 묶는다.

```bash
vgcreate vg_k8s_pv /dev/sda /dev/sdb
```

`vg_k8s_pv`라는 이름의 볼륨 그룹을 생성하고, 앞서 만든 물리 볼륨들을 추가한다.

### 3-4. 논리 볼륨 생성

볼륨 그룹의 전체 공간을 사용하여 논리 볼륨을 생성한다.

```bash
lvcreate --extents 100%FREE --name lv_k8s_pv vg_k8s_pv
```

`--extents 100%FREE` 옵션으로 볼륨 그룹의 모든 가용 공간을 사용한다.

### 3-5. 논리 볼륨 확인

생성된 논리 볼륨의 상태를 확인한다.

```bash
lvdisplay
```

### 3-6. 파일 시스템 생성 및 마운트

논리 볼륨에 ext4 파일 시스템을 생성하고 마운트한다.

```bash
mkfs.ext4 /dev/vg_k8s_pv/lv_k8s_pv
```

마운트 포인트를 생성하고 영구 마운트를 설정한다.

```bash
mkdir -p /data/longhorn
chown aift:aift /data/longhorn
echo '/dev/vg_k8s_pv/lv_k8s_pv /data/longhorn ext4 defaults 0 0' | sudo tee -a /etc/fstab
systemctl daemon-reload
mount /data/longhorn
```

`/etc/fstab`에 마운트 정보를 추가하여 시스템 재부팅 시에도 자동으로 마운트되도록 설정한다.

## 4. 운영 중 디스크 추가

운영 중에 스토리지 용량이 부족해지면 새로운 디스크를 추가할 수 있다. LVM의 큰 장점 중 하나는 서비스 중단 없이 스토리지를 확장할 수 있다는 것이다.

### 4-1. 새 디스크 물리 볼륨 생성

새로 추가된 디스크를 물리 볼륨으로 초기화한다.

```bash
pvcreate /dev/sdX
```

`/dev/sdX`는 새로 추가된 디스크의 장치명이다.

### 4-2. 볼륨 그룹에 추가

기존 볼륨 그룹에 새 물리 볼륨을 추가한다.

```bash
vgextend vg_k8s_pv /dev/sdX
```

### 4-3. 논리 볼륨 크기 확장

새로 추가된 공간만큼 논리 볼륨을 확장한다.

```bash
lvextend -l +100%FREE /dev/vg_k8s_pv/lv_k8s_pv
```

`-l +100%FREE` 옵션으로 새로 추가된 모든 공간을 사용한다.

### 4-4. 파일 시스템 크기 확장

논리 볼륨이 확장되었지만 파일 시스템은 여전히 기존 크기를 유지하므로, 파일 시스템도 확장해야 한다.

```bash
resize2fs /dev/vg_k8s_pv/lv_k8s_pv
```

이 명령어는 온라인 상태에서 실행되므로 서비스 중단 없이 확장할 수 있다.

## 5. 운영 중 디스크 제거

디스크 교체나 용량 축소가 필요할 때는 기존 디스크를 제거할 수 있다. 단, 제거하려는 디스크에 저장된 데이터를 다른 디스크로 이동해야 한다.

> [!IMPORTANT]
> 디스크 제거 작업은 데이터 손실 위험이 있으므로 반드시 백업을 수행한 후 진행해야 한다.

### 5-1. 데이터 이동

제거할 디스크의 데이터를 다른 물리 볼륨으로 이동한다.

```bash
pvmove /dev/sdX
```

이 명령어는 `/dev/sdX`에 있는 모든 데이터를 볼륨 그룹 내의 다른 물리 볼륨으로 이동한다. 데이터 양에 따라 시간이 오래 걸릴 수 있다.

### 5-2. 볼륨 그룹에서 제거

데이터 이동이 완료되면 볼륨 그룹에서 해당 물리 볼륨을 제거한다.

```bash
vgreduce vg_k8s_pv /dev/sdX
```

### 5-3. 물리 볼륨 초기화

마지막으로 물리 볼륨을 초기화하여 LVM 메타데이터를 제거한다.

```bash
pvremove /dev/sdX
```

이제 해당 디스크를 안전하게 시스템에서 제거할 수 있다.

## 6. 디스크 장애 대응

운영 중 디스크 장애가 발생하면 빠른 대응이 필요하다. LVM 환경에서는 장애 디스크를 격리하고 새 디스크로 교체할 수 있다.

### 6-1. 디스크 상태 확인

장애가 의심되는 디스크의 상태를 확인한다.

```bash
sudo lsblk
sudo pvs
sudo vgs
sudo lvs
```

시스템 로그와 디스크 상태를 확인하여 장애 여부를 판단한다.

```bash
dmesg | grep sdX
smartctl -a /dev/sdX
```

`dmesg`는 커널 메시지를 확인하여 하드웨어 오류를 찾고, `smartctl`은 디스크의 S.M.A.R.T 정보를 통해 하드웨어 상태를 확인한다.

### 6-2. 장애 디스크 데이터 복구

장애 디스크가 완전히 실패하지 않았다면 데이터를 다른 디스크로 이동한다.

```bash
pvmove /dev/sdX
```

만약 디스크가 완전히 실패하여 접근이 불가능하다면, 다음 단계로 진행한다.

### 6-3. 장애 디스크 제거

볼륨 그룹에서 장애가 발생한 물리 볼륨을 강제로 제거한다.

```bash
vgreduce --removemissing vg_k8s_pv
```

`--removemissing` 옵션은 접근할 수 없는 물리 볼륨을 강제로 제거한다.

### 6-4. 새 디스크 교체 및 복구

새 디스크를 설치하고 물리 볼륨으로 초기화한다.

```bash
sudo pvcreate /dev/sdc
```

볼륨 그룹에 새 디스크를 추가한다.

```bash
sudo vgextend vg_k8s_pv /dev/sdc
```

> [!NOTE]
> 디스크 장애로 인한 데이터 손실이 발생했다면 파일 시스템 복구나 LVM 메타데이터 복구가 필요할 수 있다.

필요시 파일 시스템을 검사하고 복구한다.

```bash
sudo fsck /dev/vg_k8s_pv/lv_k8s_pv
```

LVM 메타데이터가 손상되었다면 백업에서 복구한다.

```bash
sudo vgcfgrestore vg_k8s_pv --file /etc/lvm/backup/vg_k8s_pv
```

## 7. 마무리

LVM을 사용하여 쿠버네티스 클러스터의 스토리지를 구성하는 방법을 정리했다. 초기 설정부터 운영 중 발생할 수 있는 디스크 추가, 제거, 장애 대응까지 실제 운영 환경에서 필요한 작업들을 다뤘다.

> [!IMPORTANT]
> 스토리지 운영에서 가장 중요한 것은 정기적인 백업이다. 특히 LVM 설정 변경 전에는 반드시 데이터 백업을 수행하고, `/etc/lvm/backup/` 디렉터리의 메타데이터 백업도 확인해야 한다.

LVM의 유연성 덕분에 서비스 중단 없이 스토리지를 확장할 수 있어 쿠버네티스 클러스터의 안정적인 운영에 도움이 될 것으로 기대된다.