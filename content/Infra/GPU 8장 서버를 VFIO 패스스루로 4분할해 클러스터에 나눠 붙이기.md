---
title: GPU 8장 서버 한 대를 VFIO 패스스루로 4분할해 개발·검증 클러스터에 나눠 붙이기
date: 2026-01-23
draft: false
featured: true
tags:
  - vfio
  - iommu
  - gpu-passthrough
  - terraform
  - libvirt
  - ansible
  - kubernetes
banner: 
cssclasses: 
description: 놀고 있던 8-GPU 서버 한 대를 개발·검증용으로 쪼개려고, 커널에서 GPU를 떼어내고 Terraform과 Ansible로 VM 4대를 찍어 두 클러스터에 나눠 붙인 기록.
permalink: 
aliases: 
completed: true
type:
  - architecture
---

## 요약

> [!SUMMARY]
> GPU 8장이 달린 물리 서버 한 대를 개발·검증 클러스터가 나눠 쓰게 만들었다. IOMMU와 VFIO로 GPU를 호스트 커널에서 떼어내고(선점하던 드라이버와 fabricmanager는 blacklist·unbind로 정리), Terraform libvirt provider로 스토리지 풀·qcow2 백킹 볼륨·cloud-init·PCI 패스스루를 코드화해 VM 4대를 찍었다. 이후 Ansible로 드라이버·container-toolkit·containerd·쿠버네티스를 얹어 워커로 join했고, 마지막에 macvtap과 파드 CIDR 충돌까지 걷어냈다.

## 1. 환경

- 물리 호스트: GPU 8장(A100 SXM4 계열, PCI ID `10de:20b2`), Ubuntu + libvirt/KVM
- VM 게스트: Rocky Linux 9, VM당 GPU 2장씩 총 4대
- Kubernetes: v1.30.5 (kubeadm), containerd 1.6.21, NVIDIA Driver 535
- Terraform: `dmacvicar/libvirt` v0.9.2 / Ansible
- 네트워크: 호스트·VM 공용 대역 `10.0.20.0/24` (호스트 `10.0.20.10`, VM `10.0.20.21~24`)

## 2. 왜 서버 한 대를 4분할했나

GPU 8장짜리 서버가 한 대 있었다. 그런데 이 녀석이 어느 쪽 클러스터에도 온전히 속하지 못하고 애매하게 놀고 있었다. 개발 클러스터도 GPU가 아쉽고, 검증 클러스터도 아쉬운데, 서버를 통째로 한쪽에 넣자니 반대쪽이 굶는다.

그래서 <b>물리 서버 한 대를 VM 4대로 쪼개고, GPU 2장씩 물려 두 클러스터에 각각 2대씩 나눠 붙이기로</b> 했다. GPU를 VM 안에서 진짜 물건처럼 쓰려면 소프트웨어 에뮬레이션이 아니라 <b>PCI 패스스루(passthrough)</b>가 필요하다. PCI 장치 하나를 통째로 게스트에게 넘겨 게스트가 실제 하드웨어를 직접 잡게 하는 방식이다.

여기서 걸리는 건 하나다. GPU는 물리 장치라 동시에 두 곳이 쓸 수 없다. VM에게 넘기려면 <b>먼저 호스트가 그 GPU에서 손을 떼야</b> 한다. 실제로 이번 작업에서 제일 오래 붙든 게 이 부분이었다.

## 3. 전체 그림

작업은 성격이 뚜렷하게 셋으로 갈렸다. 그래서 디렉토리도 그렇게 나눴다.

- <b>호스트 준비</b>: BIOS에서 가상화·IOMMU를 켜고, 커널·모듈 단에서 GPU를 VFIO로 넘긴다. (한 번, 수동)
- <b>VM 배선(Terraform)</b>: 스토리지 풀·베이스 이미지·qcow2 디스크·cloud-init·도메인·GPU 패스스루를 코드로 선언한다. (`01-infra`, `02-vms`)
- <b>구성 관리(Ansible)</b>: 뜬 VM에 드라이버·컨테이너 런타임·쿠버네티스를 얹고 워커로 만든다. (`03-config`)

호스트 준비는 재부팅과 커널 파라미터가 얽혀 있어 코드화보다 손으로 짚어가며 하는 게 안전했다. 반면 VM은 4대를 똑같이 찍어내는 일이라 Terraform이 제격이었고, VM 내부 설정은 멱등성(idempotency)이 필요해 Ansible로 갔다. 역할별로 도구를 갈라놓으니 나중에 VM 한 대만 다시 밀 때도 깔끔했다.

## 4. 호스트 준비: GPU를 커널에서 떼어내기

### 3-1. 가상화와 IOMMU 켜기

먼저 CPU 가상화 확장과 IOMMU가 살아 있어야 한다. IOMMU(Input–Output Memory Management Unit)는 장치의 DMA를 주소 공간별로 격리해주는 하드웨어로, PCI 패스스루의 전제 조건이다. 이게 꺼져 있으면 게스트에 장치를 넘겨도 메모리 보호가 안 돼 위험하다.

```bash
# CPU 가상화 지원 여부 확인 (VT-x/AMD-V)
lscpu | grep Virtualization
```

커널 부팅 파라미터에 IOMMU를 켜고, 동시에 GPU를 어떤 드라이버도 잡지 못하게 `vfio-pci.ids`로 예약했다. Intel 기준이면 `intel_iommu=on`, `iommu=pt`(passthrough 모드, 성능 손실 최소화)를 넣는다.

```bash
# /etc/default/grub 의 GRUB_CMDLINE_LINUX_DEFAULT 수정
# vfio-pci.ids 로 해당 vendor:device 를 부팅 시점부터 vfio-pci 에 예약한다
GRUB_CMDLINE_LINUX_DEFAULT="quiet splash intel_iommu=on iommu=pt vfio-pci.ids=10de:20b2"

sudo update-grub
sudo reboot
```

> [!NOTE]
> BIOS 단계에서 가상화나 IOMMU가 꺼져 있으면 OS에서 아무리 켜도 소용없다. 원격에서 손댈 수 없는 항목이라, 이게 막히면 결국 IDC에 직접 방문해 BIOS를 만져야 한다. (원격 근무의 낭만은 여기서 끝난다.)

### 3-2. VFIO 예약과 드라이버 선점 방지

`vfio-pci`는 장치를 게스트에게 넘기기 위해 "붙잡아만 두는" 커널 드라이버다. 문제는 부팅 과정에서 <b>NVIDIA 드라이버나 nouveau가 vfio-pci보다 먼저 GPU를 낚아채는</b> 경우가 흔하다는 것이다. 한 번 잡히면 그 뒤에 vfio가 끼어들 자리가 없다.

그래서 modprobe 설정에 `softdep`으로 로드 순서를 강제했다. "nvidia나 nouveau를 올리기 전에 vfio-pci를 먼저 올려라"는 선언이다.

```bash
# /etc/modprobe.d/vfio.conf
options vfio-pci ids=10de:20b2
# 드라이버가 vfio 보다 장치를 먼저 낚아채는 경우를 방지 (선점 순서 고정)
softdep nvidia pre: vfio-pci
softdep nouveau pre: vfio-pci
```

initramfs에도 vfio 모듈을 포함시켜 아주 이른 부팅 단계부터 vfio가 준비되게 했다.

```bash
# /etc/initramfs-tools/modules 에 추가
vfio
vfio_iommu_type1
vfio_pci
vfio_virqfd

sudo update-initramfs -u -k all
sudo reboot
```

성공했다면 다음 명령에서 `Kernel driver in use: vfio-pci`가 보여야 한다.

```bash
# 해당 vendor:device 를 잡고 있는 커널 드라이버 확인
lspci -nnk -d 10de:20b2
```

### 3-3. fabricmanager와 ollama의 선점

여기까지 교과서대로 했는데 GPU가 여전히 `vfio-pci`로 안 넘어왔다. `softdep`을 걸었는데도. 원인을 찾으려 누가 GPU 장치를 붙잡고 있는지부터 봤다.

```bash
# /dev/nvidia* 를 열고 있는 프로세스를 전부 나열
sudo fuser -v /dev/nvidia*
```

범인은 둘이었다. 이미 떠 있던 <b>추론 서비스(ollama)</b>가 모든 GPU를 물고 있었고, 그 아래에서 <b>nv-fabricmanager</b>가 NVLink/NVSwitch 토폴로지를 붙잡고 있었다. 부팅 순서를 아무리 고정해도, 그 뒤에 서비스가 드라이버를 다시 올려 장치를 잡아버리면 원점이다. 서비스를 내려야 했다.

```bash
# GPU 를 붙잡고 있던 서비스 정지 (재부팅 후 재점유 방지)
sudo systemctl disable --now ollama
sudo systemctl disable --now nvidia-fabricmanager
```

그리고 확실히 하려고 NVIDIA 관련 모듈을 아예 blacklist 처리했다. 이 호스트는 GPU를 직접 쓸 일이 없고 오로지 게스트에게 넘기기만 하면 되니, 호스트에서 nvidia 드라이버가 올라올 이유 자체가 없다.

```bash
# /etc/modprobe.d/blacklist-nvidia.conf
blacklist nvidia
blacklist nvidia_drm
blacklist nvidia_modeset
blacklist nvidia_uvm
blacklist nouveau
alias nvidia off
```

그래도 이미 살아있는 세션에서 즉시 떼어내야 할 땐, 커널 sysfs로 직접 unbind하고 vfio-pci에 bind했다. 재부팅 없이 손으로 장치 소유권을 옮기는 방법이다.

```bash
# 실행 중인 nvidia 드라이버에서 각 GPU 를 떼어(unbind) vfio-pci 로 다시 붙인다(bind)
GPUS=("0000:41:00.0" "0000:42:00.0" "0000:81:00.0" "0000:82:00.0")
for GPU in "${GPUS[@]}"; do
  echo "$GPU" > /sys/bus/pci/drivers/nvidia/unbind
  echo "$GPU" > /sys/bus/pci/drivers/vfio-pci/bind
done
```

> [!IMPORTANT]
> 패스스루가 안 될 때 modprobe 설정만 붙들고 씨름하기 쉬운데, 실제로는 <b>런타임에 장치를 점유하는 서비스</b>가 원인인 경우가 많다. "누가 `/dev/nvidia*`를 열고 있나"부터 확인하는 게 훨씬 빠르다. `softdep`은 부팅 순서를 고정할 뿐, 부팅 이후 다시 뜬 서비스까지 막아주진 않는다.

## 5. Terraform으로 VM 뼈대를 코드화

호스트가 GPU에서 손을 뗐으니, 이제 VM을 찍을 차례다. 4대를 손으로 만들면 스펙이 미묘하게 어긋나기 마련이라 Terraform으로 선언했다. 상태를 두 단계로 나눴다. 자주 안 바뀌는 <b>스토리지·베이스 이미지</b>(`01-infra`)와 자주 갈아엎는 <b>VM 본체</b>(`02-vms`)다.

### 4-1. 스토리지 풀과 베이스 이미지 (01-infra)

libvirt 스토리지 풀을 디렉토리 타입으로 만들고, 그 안에 OS 클라우드 이미지를 qcow2로 받아둔다. 이 베이스 이미지는 뒤에서 각 VM 디스크의 <b>백킹 스토어(backing store)</b>로 재사용한다.

```hcl
# 원격 호스트의 디렉토리를 libvirt 스토리지 풀로 등록
resource "libvirt_pool" "gpu_pool" {
  name = var.pool_name   # 예: gpu-vm-pool
  type = "dir"
  target = { path = var.pool_path }  # 예: /data/vms
}

# 부팅용 베이스 OS 이미지를 풀에 내려받아 둔다 (VM 디스크의 원본)
resource "libvirt_volume" "os_base" {
  for_each = var.base_images
  name     = each.value.name          # rocky-9-base.qcow2 등
  pool     = libvirt_pool.gpu_pool.name
  target   = { format = { type = "qcow2" } }
  create   = { content = { url = each.value.url } }
}
```

provider 연결은 로컬이 아니라 원격 호스트다. `qemu+ssh`로 붙되, SSH 키 경로만 참조하고 키 자체는 저장소에 넣지 않았다.

```hcl
# 원격 libvirt 데몬에 qemu+ssh 로 접속 (키는 파일 경로로만 참조)
uri = "qemu+ssh://<user>@10.0.20.10/system?keyfile=../ssh/id_ed25519"
```

### 4-2. VM 디스크·cloud-init·도메인 (02-vms)

VM 디스크는 앞의 베이스 이미지를 백킹 스토어로 삼는 qcow2로 만들었다. 이러면 VM마다 OS 전체를 복사하지 않고 <b>변경분만 얇게 쌓여</b> 디스크와 프로비저닝 시간을 아낀다.

```hcl
# 베이스 이미지를 backing store 로 하는 얇은 VM 디스크 (변경분만 저장)
resource "libvirt_volume" "vm_disk" {
  for_each      = var.vms
  name          = "${each.key}-disk.qcow2"
  capacity      = coalesce(each.value.disk_size, var.vm_defaults.disk_size)
  backing_store = {
    path   = data.terraform_remote_state.infra.outputs.base_images[each.value.os]
    format = { type = "qcow2" }
  }
}
```

cloud-init으로 계정·SSH 키·네트워크를 첫 부팅에 자동 주입했다. 게스트가 Rocky 9라 `restorecon`으로 SELinux 컨텍스트를 복구하고 시리얼 콘솔을 붙이는 등 OS별 후처리도 함께 넣었다. 비밀번호는 코드에 평문으로 두지 않고 변수(`var.cloud_init_user.password`)로만 참조한다.

```yaml
#cloud-config
users:
  - name: <user>
    sudo: ALL=(ALL) NOPASSWD:ALL
    ssh_authorized_keys:
      - <SSH_PUBLIC_KEY>   # 파일에서 주입, 저장소에는 미포함
# 비밀번호는 secret 변수로만 참조하고 평문으로 커밋하지 않는다
```

도메인 정의에서 GPU를 붙이는 부분이다. VM별 GPU 목록을 받아 `hostdev`로 PCI 주소를 통째로 넘긴다. `managed = true`면 libvirt가 도메인 기동/종료 시 <b>호스트 드라이버 detach와 vfio 인계를 알아서</b> 처리한다.

```hcl
# vm 정의에 적힌 PCI 주소들을 게스트에 그대로 패스스루
hostdevs = var.vm_defaults.gpu_passthrough ? [
  for gpu in each.value.gpus : {
    subsys_pci = {
      managed = true   # 도메인 라이프사이클에 맞춰 detach/attach 자동화
      source  = { address = {
        domain   = gpu.domain
        bus      = gpu.bus
        slot     = gpu.slot
        function = gpu.function
      }}
    }
  }
] : []
```

VM별로 어떤 GPU를 물릴지는 `vms` 변수에 PCI 주소(domain/bus/slot/function)로 못박아뒀다. VM 한 대에 2장씩, 네 대가 서로 다른 물리 GPU를 나눠 갖는다. (아래 버스 번호는 예시로 일반화한 값이다.)

```hcl
vms = {
  "gpu-vm-01" = { ip = "10.0.20.21", os = "rocky9",
    gpus = [ {domain=0,bus=0x41,slot=0,function=0}, {domain=0,bus=0x42,slot=0,function=0} ] }
  "gpu-vm-02" = { ip = "10.0.20.22", os = "rocky9",
    gpus = [ {domain=0,bus=0x81,slot=0,function=0}, {domain=0,bus=0x82,slot=0,function=0} ] }
  # gpu-vm-03, gpu-vm-04 동일 패턴
}
```

한 가지 삽질 흔적을 남겨두면, `terraform destroy`로 VM을 지울 때 NVRAM이 남아 다음 생성이 꼬이는 일이 있었다. 그래서 destroy 시점에 원격 호스트로 `virsh undefine --nvram`을 날리는 정리 리소스를 따로 뒀다. 만드는 것보다 <b>깨끗하게 지우는 것</b>이 반복 작업에선 더 중요하더라.

## 6. Ansible로 드라이버·런타임·쿠버네티스 얹기

VM이 뜨면 그 안은 맨 OS다. 여기에 GPU 드라이버, 컨테이너 런타임, 쿠버네티스를 얹어 워커로 만드는 건 Ansible로 했다. 인벤토리에 VM 4대를 넣고 세 개의 플레이북을 순서대로 돌린다.

```bash
# 드라이버·container-toolkit → 워커 기본 설정 → sysctl 순으로 적용
ansible-playbook -i inventory/hpc/inventory.yml playbooks/install_nvidia.yml
ansible-playbook -i inventory/hpc/inventory.yml playbooks/k8s_worker_setup.yml
ansible-playbook -i inventory/hpc/inventory.yml playbooks/sysctl_config.yml
```

- <b>NVIDIA 드라이버 + container-toolkit</b>: 게스트 안에서는 이제 GPU를 진짜로 써야 하니 `535-open` 드라이버를 올리고, `nvidia-smi`로 GPU가 보이는지 확인한 뒤 container-toolkit을 설치한다. (호스트에서는 blacklist했던 드라이버를, 게스트에서는 정식으로 올린다는 게 포인트다.)
- <b>워커 기본 설정</b>: firewalld·swap·SELinux 정리, 커널 모듈 로드, containerd 1.6.21과 쿠버네티스 v1.30.5 바이너리 설치, kubelet 활성화까지 한 번에.
- Rocky 9 클라우드 이미지의 인터페이스 이름(`eth0`)이 기존 노드 규칙과 안 맞아, udev 규칙으로 이름을 맞춰주는 처리도 넣었다.

런타임 스택 버전(containerd·k8s·driver)을 붙일 클러스터와 맞추는 게 중요하다. 그래서 작업 전에 붙일 클러스터의 버전부터 확인해 인벤토리에 박아뒀다. 마지막으로 마스터에서 join 명령을 뽑아 워커를 붙였다.

```bash
# 마스터에서 join 커맨드 생성 → 각 VM 에서 실행하면 워커로 합류
kubeadm token create --print-join-command
```

## 7. 네트워크: macvtap과 파드 CIDR 충돌

배선에서 두 번 걸렸다. 둘 다 "붙긴 붙는데 통신이 안 되는" 종류라 더 성가셨다.

<b>첫째, macvtap.</b> VM 네트워크를 처음엔 macvtap(direct) 방식으로, 호스트와 같은 대역(`10.0.20.21~24`)을 쓰게 잡았다. 외부·다른 노드와는 잘 통신하는데, <b>정작 호스트 자신과 VM 사이가 안 됐다.</b> macvtap의 알려진 특성으로, 같은 물리 인터페이스에 붙은 호스트와 게스트는 서로를 못 본다. 호스트를 경유하는 통신이 필요하면 macvtap 대신 호스트에 브릿지를 만들어야 한다. 이번엔 워커가 호스트를 거칠 일이 없어 macvtap을 유지했지만, 코드에는 브릿지 모드로 갈아탈 자리를 주석으로 남겨뒀다.

```hcl
# macvtap(direct) — 호스트↔게스트 직접 통신은 불가
source = { direct = { dev = var.network.host_dev, mode = "bridge" } }
# 호스트 경유가 필요하면 브릿지로: source = { bridge = { bridge = "br0" } }
```

<b>둘째, 파드 CIDR 충돌.</b> 개발 클러스터 join은 순조로웠는데, 검증 클러스터에서 막혔다. 검증 클러스터의 파드 CIDR이 `10.0.0.0/16`이었는데, 이게 VM 노드가 쓰는 대역 `10.0.20.0/24`를 통째로 삼키고 있었다. 노드 IP와 파드 IP 대역이 겹치니 라우팅이 꼬여 통신이 안 되는 게 당연했다.

결국 검증 클러스터의 파드 CIDR을 노드 대역과 안 겹치는 `10.244.0.0/16`으로 옮겼다. 이미 돌아가는 클러스터의 CIDR을 바꾸는 건 간단하지 않아서, 순서대로 손봤다.

- Calico IPPool을 신규 대역으로 추가하고 기존 IPPool은 비활성화
- `kube-controller-manager` 매니페스트, `kube-proxy`·`kubeadm-config` 컨피그맵의 `podSubnet` 교체
- 파드 재생성 후 새 IP를 받는지 확인
- 노드를 delete했다가 다시 join (kubelet 재기동으로 합류) — 이래야 컨트롤러 매니저가 새 대역을 제대로 반영한다

> [!NOTE]
> 노드를 delete하고 재join하면 <b>노드에 붙어 있던 라벨이 사라진다.</b> GPU 노드에 스케줄링 라벨을 걸어뒀다면 재join 후 다시 달아줘야 한다. 안 그러면 파드가 `NodeAffinity` 조건에 걸려 조용히 스케줄링에서 밀린다. (한참 헤맸다.)

## 8. 확인

호스트에서는 IOMMU와 장치 할당이 준비됐는지부터 봤다.

```bash
# device assignment IOMMU support / IOMMU enabled 항목이 PASS 여야 한다
virt-host-validate
```

`lspci -nnk -d 10de:20b2`에서 대상 GPU가 모두 `vfio-pci`로 잡히고, VM 안에서 `nvidia-smi`가 물려준 GPU 2장을 보여주면 패스스루는 성공이다. 마지막으로 두 클러스터에서 각각 워커가 붙었는지 확인했다.

```bash
# 각 클러스터에서 VM 워커가 Ready 로 올라왔는지 확인
kubectl get nodes -o wide
```

개발·검증 클러스터에 각각 VM 2대씩, GPU 2장씩 `Ready`로 올라오면 끝이다. 놀던 서버 한 대가 이제 양쪽 클러스터에서 동시에 일하게 됐다.

## 참고

- [Terraform libvirt provider (dmacvicar/libvirt)](https://registry.terraform.io/providers/dmacvicar/libvirt/latest/docs)
- [Arch Wiki — PCI passthrough via OVMF](https://wiki.archlinux.org/title/PCI_passthrough_via_OVMF)
- [Linux Kernel — VFIO](https://docs.kernel.org/driver-api/vfio.html)
- [libvirt — Direct attachment to physical interface (macvtap)](https://libvirt.org/formatdomain.html#direct-attachment-to-physical-interface)
- [[특정 노드의 특정 GPU만 쿠버네티스에서 숨기기|물리 분할 대신 특정 GPU만 스케줄에서 가리는 방법]]
