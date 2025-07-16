---
title: lvm 설정
date: 2025-07-16
draft: true
tags:
  - lvm
  - storage
  - linux
banner: 
cssclasses: 
description: 
permalink: 
aliases: 
completed: 
type:
  - note
---

LVM 도구 설치

`dnf install lvm2`

물리 볼륨 생성

`pvcreate /dev/sda /dev/sdb ...`

볼륨 그룹 생성

`vgcreate vg_k8s_pv /dev/sda /dev/sdb ...`

논리 볼륨 생성

`lvcreate --extents 100%FREE --name lv_k8s_pv vg_k8s_pv`

논리 볼륨 생성 확인

`lvdisplay`

파일 시스템 생성

`mkfs.ext4 /dev/vg_k8s_pv/lv_k8s_pv`

마운트

`mkdir -p /data/longhorn chown aift:aift /data/longhorn echo '/dev/vg_k8s_pv/lv_k8s_pv /data/longhorn ext4 defaults 0 0' | sudo tee -a /etc/fstab systemctl daemon-reload mount /data/longhorn`

## 드라이브 추가

pv 생성

`pvcreate /dev/sdX`

볼륨 그룹에 추가

`vgextend vg_k8s_pv /dev/sdX`

논리 볼륨 크기 확장

`lvextend -l +100%FREE /dev/vg_k8s_pv/lv_k8s_pv`

파일 시스템 크기 확장

`resize2fs /dev/vg_k8s_pv/lv_k8s_pv`

## 드라이브 제거

제거할 드라이브의 데이터 이동

`pvmove /dev/sdX`

볼륨 그룹에서 물리 볼륨 제거

`vgreduce vg_k8s_pv /dev/sdX`

물리 볼륨 초기화

`pvremove /dev/sdX`

## 드라이브 장애시

디스크 상태 확인

`sudo lsblk sudo pvs sudo vgs sudo lvs`

`dmesg | grep sdX smartctl -a /dev/sdX`

제거할 드라이브의 데이터 이동

`pvmove /dev/sdX`

볼륨 그룹에서 문제의 물리 볼륨 제거

`vgreduce --removemissing vg_k8s_pv`

### **디스크 교체 및 복구**

새 디스크를 설치하고 초기화

`bash sudo pvcreate /dev/sdc`

VG에 새 디스크 추가

`bash sudo vgextend myvg /dev/sdc`

파일 시스템 복구 (필요 시)

1. 파일 시스템 검사 및 복구:
    
    `bash sudo fsck /dev/myvg/mylv`
    
2. LVM 메타데이터 복구:
    
    `bash sudo vgcfgrestore myvg --file /etc/lvm/backup/myvg`