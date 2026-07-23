---
title: kubevirt 를 활용한 오프라인 테스트 환경 구성
date: 2025-07-14
draft: false
tags:
  - kubernetes
  - kubevirt
  - offline
  - cilium
banner: 
cssclasses: 
description: 클러스터 안에서 KubeVirt로 VM을 띄우고 CiliumNetworkPolicy로 외부망을 끊어 오프라인 테스트 환경을 만든 기록.
permalink: 
aliases:
completed: 
type:
  - note
---

## 1. 개요

쿠버네티스(Kubernetes) 오프라인 설치를 테스트하려면 외부 네트워크가 완전히 끊긴 환경이 필요했다. 별도 서버에 KVM이나 VirtualBox로 VM을 올리고 네트워크를 끊는 방법도 있지만, 구성이 번거롭기도 하고 이왕 클러스터에 익숙해진 김에 전부 클러스터 안에서 해결하고 싶었다.

찾아보니 <b>KubeVirt</b>로 노드 자원을 써서 VM을 띄울 수 있었고, 여기에 <b>CiliumNetworkPolicy</b>를 얹으면 외부망 차단까지 깔끔하게 될 것 같았다.

## 2. KubeVirt란?

KubeVirt는 쿠버네티스에서 가상 머신(VM)을 다룰 수 있게 해주는 오픈소스다. VM 기반 워크로드를 컨테이너 애플리케이션과 같은 플랫폼에서 굴리자는 게 핵심이다.

동작 방식은 사용자 정의 리소스(CRD, Custom Resource Definitions)로 쿠버네티스 API를 확장하는 것이다. 그래서 쿠버네티스가 VM 객체를 파드처럼 이해하고 관리한다. VM을 만들면 실제로는 KVM(Kernel-based Virtual Machine) 인스턴스를 품은 특수한 파드 안에서 돌아간다. 이 구조 덕분에 CiliumNetworkPolicy 같은 파드용 정책이 VM에도 그대로 먹힌다는 게 나중에 유용했다.

## 3. 사전 준비

VM을 띄우려면 먼저 하드웨어 가상화 기능을 켜야 한다. 서버의 EFI(또는 BIOS)에 들어가 가상화 옵션(Intel VT-x, AMD-V 등)을 Enable로 바꿨다. 이 옵션 이름은 CPU·메인보드 제조사마다 조금씩 다르다.

## 4. 설치 과정

KubeVirt를 클러스터에 설치하기 위해 필요한 컴포넌트는 다음과 같다.
- kubevirt-operator
- cdi-cr
- cdi-operator
- kubevirt-manager (선택사항)

컴포넌트를 다 올린 뒤, VM을 제어하려고 클라이언트 OS에 `virtctl` CLI를 따로 설치했다.

## 5. 기본 이미지 생성

VM 디스크를 만드는 방법은 여럿인데, 재사용성을 생각해서 기반 <b>DataVolume</b>을 미리 만들어두는 방식을 골랐다. 그리고 `dataVolumeTemplates`로 VM을 새로 찍을 때마다 이 기반 DataVolume을 복제해 쓰도록 했다.

아래는 NFS-CSI용 `StorageProfile`과, Rocky Linux·Ubuntu 클라우드 이미지를 받아 DataVolume을 만드는 매니페스트다.
```yaml
apiVersion: cdi.kubevirt.io/v1beta1
kind: StorageProfile
metadata:
  name: nfs-csi
spec:
  claimPropertySets:
    - accessModes:
        - ReadWriteMany
      volumeMode: Filesystem
---
apiVersion: cdi.kubevirt.io/v1beta1
kind: DataVolume
metadata:
  name: base-rocky
spec:
  source:
    http:
      url: https://dl.rockylinux.org/pub/rocky/9/images/x86_64/Rocky-9-GenericCloud-Base.latest.x86_64.qcow2
  contentType: kubevirt
  storage:
    resources:
      requests:
        storage: 30Gi
---
apiVersion: cdi.kubevirt.io/v1beta1
kind: DataVolume
metadata:
  name: base-ubuntu-2404
spec:
  source:
    http:
      url: https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img
  contentType: kubevirt
  storage:
    resources:
      requests:
        storage: 30Gi
```

## 6. VM 생성

기본 이미지가 준비됐으면 `VirtualMachine` 리소스를 정의해 VM을 만든다. `dataVolumeTemplates`로 앞서 만든 `base-rocky`를 복제해 `master1-rootdisk`라는 새 볼륨을 만들도록 했다.

> [!NOTE]
> VM에 `netpolicy: internal-egress-only` 라벨을 추가했다. 이 라벨은 이후 네트워크 정책을 통해 외부 통신을 차단하는 데 사용된다.

아래는 VM 생성 매니페스트 예시다.
```yaml
apiVersion: kubevirt.io/v1
kind: VirtualMachine
metadata:
  name: master1
spec:
  runStrategy: Manual
  dataVolumeTemplates:
    - metadata:
        name: master1-rootdisk
      spec:
        source:
          pvc:
            name: base-rocky
            namespace: default
        storage:
          resources:
            requests:
              storage: 100Gi
  template:
    metadata:
      labels:
        kubevirt.io/domain: master1
        # 외부 네트워크를 단절시키기 위한 라벨
        netpolicy: internal-egress-only
    spec:
      domain:
        devices:
          disks:
            - name: rootdisk
              disk:
                bus: virtio
            - name: cloudinitdisk
              disk:
                bus: virtio
        interfaces:
          - name: default
            bridge: {}
        resources:
          requests:
            cpu: 2
            memory: 4Gi
          limits:
            cpu: 2
            memory: 4Gi
      networks:
        - name: default
          pod: {}
      volumes:
        - name: rootdisk
          dataVolume:
            name: master1-rootdisk
        - name: cloudinitdisk
          cloudInitNoCloud:
            userData: |
              #cloud-config
              users:
                - name: user
                  groups: wheel
                  shell: /bin/bash
                  sudo: ALL=(ALL) NOPASSWD:ALL
                  chpasswd: { expire: False }
                  # openssl passwd -6 test
                  passwd: $6$vwoaX/.Bf7ZCxtzm$4Jkrpv3dEaDT8WoRmQ3tNi4.u7NfvU8TaEzMZsKVyNGotDTTnQloWQ72Qxu8qrJF1MqKd67g2baV9tQUpeIfV0
                  lock_passwd: false
                  ssh_pwauth: True
```
매니페스트를 적용한 뒤 `virtctl start master1`로 VM을 켠다.

## 7. 네트워크 격리

이제 <b>CiliumNetworkPolicy</b>로 VM의 외부 통신을 끊어 오프라인 환경을 만들었다. `endpointSelector`로 `netpolicy: internal-egress-only` 라벨이 붙은 파드(VM)를 타겟으로 잡았다.

`egress`로는 클러스터 내부 대역(`10.0.0.0/8`)과 `kube-apiserver`·`cluster` 엔티티로 나가는 것만 허용하고, `egressDeny`로 그 외 모든 외부 통신(`0.0.0.0/0`)을 막았다.

```yaml
apiVersion: "cilium.io/v2"
kind: CiliumNetworkPolicy
metadata:
  name: internal-egress-only
  namespace: default
spec:
  endpointSelector:
    matchLabels:
      netpolicy: internal-egress-only
  egress:
    - toCIDR:
        - 10.0.0.0/8 # 클러스터 내부 IP 대역
    - toEntities:
        - kube-apiserver
        - cluster
  egressDeny:
    - toCIDR:
        - 0.0.0.0/0
```

## 8. 회고

이번 클러스터 구축에서 KubeVirt가 핵심은 아니었던 탓에, 더 파보지 못하고 남긴 게 몇 개 있다. 여유가 되면 다시 붙어볼 생각이다.

- <b>GPU 할당 실패</b>: 노드 그래픽카드를 VM에 붙여보고 싶었는데, 지식도 부족하고 시간도 없어 결국 못 했다.
- <b>고정 IP 할당</b>: VM IP를 고정하려고 인터페이스를 손봤지만 실패했다. <b>Multus CNI</b>를 쓰면 된다는데, 설정이 생각보다 복잡해서 이번엔 접었다.

## 참고
- [kubevirt 공식문서](https://kubevirt.io/user-guide/)
- [kubevirt-ma](https://kubevirt-manager.io/get_started.html)