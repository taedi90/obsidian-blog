---
title: Terraform으로 GPU VM 찍어내기
date: 2026-03-15
draft: false
tags:
  - terraform
  - libvirt
  - kvm
  - gpu
  - iac
banner: 
cssclasses: 
description: GPU 서버 위에 KVM/libvirt로 여러 대의 VM을 손으로 만들던 걸, Terraform으로 옮겨 GPU PCI 패스스루·cloud-init까지 코드로 찍어낸 기록. 스토리지/베이스와 VM을 두 단계로 나누고 remote_state로 이었다.
permalink: 
aliases: 
completed: true
type:
  - note
---

## 요약

> [!SUMMARY]
> 여러 장의 GPU가 장착된 서버에 KVM/libvirt로 VM을 여러 대 올릴 일이 생겼는데, `virt-install` 명령으로 한 대씩 만드는 방식은 "같은 스펙의 여러 대 + GPU 패스스루 + OS별 초기 설정"이 겹치니 수작업으로는 재현이 어려웠다. 그래서 [Terraform + libvirt 프로바이더](https://github.com/dmacvicar/terraform-provider-libvirt)로 옮겼다. 스토리지·베이스와 VM을 두 단계로 나누어 remote_state로 연결하고, VM 정의를 맵 하나에 작성하면 `for_each`가 GPU PCI 패스스루와 cloud-init 설정까지 포함해서 그대로 생성한다.

수작업으로 만들 때 힘든 부분은 "한 번 만들기"가 아니라 "동일하게 다시 만들기"였다.

## 1. IaC 도입

libvirt를 수작업으로 다룰 때 걸림돌이 되던 것들은 다음과 같다.

- VM마다 vCPU·메모리·디스크·네트워크 값을 인자로 지정하는데, 여러 대를 같은 스펙으로 맞추려면 그 인자들을 매번 정확히 복사해서 붙여 넣어야 한다.
- GPU 패스스루는 특히 까다롭다. 어느 GPU(PCI 주소)를 어느 VM에 연결할지를 도메인 XML에 직접 기록해야 하고, 서버마다 PCI 토폴로지가 달라 재현이 어렵다.
- 초기 설정(사용자·SSH 키·패키지)은 VM이 구동된 뒤에 또 수작업으로 진행한다. OS(Ubuntu/Rocky)마다 방식이 달라 실수가 잦다.

Terraform으로 옮기면 이 모든 항목이 선언으로 바뀐다. "이런 VM들이 존재해야 한다"고 적어 두면 `apply`가 현재 상태와 비교해서 맞춰 준다. 한 대가 사라져도 다시 `apply`를 실행하면 동일한 구성이 다시 생성된다.

## 2. 두 단계로 쪼갠 구조

libvirt 리소스를 한 파일에 모두 넣으니 관심사가 섞였다. 그래서 두 단계로 분리했다.

```text
01-infra/   # 호스트 공용 인프라 — 자주 안 바뀜
  · libvirt storage pool (VM 디스크가 놓일 디렉토리 풀)
  · base OS 이미지 볼륨 (cloud 이미지)
  → outputs: pool_name, base_images, libvirt_uri ...

02-vms/     # VM 본체 — 자주 바뀜 (대수·스펙·GPU 매핑)
  · terraform_remote_state 로 01-infra 의 출력을 읽어옴
  · vms 맵을 돌며 디스크·cloudinit·도메인 생성
```

나눈 이유는 변경 주기가 다르기 때문이다. 스토리지 풀과 베이스 이미지는 거의 변경되지 않지만, VM은 대수를 늘리거나 스펙을 조정하면서 자주 수정한다. 자주 바뀌는 부분을 따로 두면 `apply` 대상 범위가 좁아져서 안전하다. 두 단계는 `terraform_remote_state`로 연결된다. `02-vms`가 `01-infra`의 출력(풀 이름·베이스 이미지·libvirt URI)을 읽어 사용한다.

```hcl
# 02-vms: 앞 단계의 출력을 읽어온다
data "terraform_remote_state" "infra" {
  backend = "local"
  config  = { path = "../01-infra/terraform.tfstate" }
}
```

## 3. VM 목록을 맵 하나로

`vms` 변수가 중심 역할을 한다. VM 한 대가 맵의 항목 하나에 해당하고, `for_each`로 이 맵을 순회하면서 리소스를 생성한다.

```hcl
variable "vms" {
  type = map(object({
    ip   = string
    os   = string                    # ubuntu22 / ubuntu24 / rocky9
    gpus = list(object({             # 이 VM에 붙일 GPU들의 PCI 주소
      domain = number
      bus    = number
      slot   = number
      function = number
    }))
    memory    = optional(number)     # 없으면 vm_defaults 사용
    vcpu      = optional(number)
    disk_size = optional(number)
  }))
}
```

값은 대략 이런 모양이다(호스트명·IP·PCI는 예시).

```hcl
vms = {
  "gpu-node-01" = {
    ip   = "10.0.0.11"
    os   = "rocky9"
    gpus = [
      { domain = 0, bus = 0x27, slot = 0, function = 0 },
      { domain = 0, bus = 0x2a, slot = 0, function = 0 },
    ]
  }
  "gpu-node-02" = { ip = "10.0.0.12", os = "rocky9", gpus = [ ... ] }
}
```

VM을 늘리려면 맵에 항목 하나를 추가하면 된다. `for_each = var.vms`가 그 항목에 대해 디스크·cloud-init·도메인 리소스를 알아서 생성한다. 개별 스펙은 `optional`로 두고, `coalesce(each.value.memory, var.vm_defaults.memory)`처럼 개별 값이 없으면 기본값을 사용한다. 대부분의 VM이 같고 몇 대만 다른 경우에 딱 맞는 방식이다.

## 4. GPU 패스스루를 코드로

가장 크게 편해진 부분이다. 도메인 리소스의 `hostdevs`에 PCI 주소를 지정하면 그 물리 GPU가 VM 내부로 그대로 연결된다. VM별 `gpus` 목록을 순회하면서 hostdev를 생성한다.

```hcl
resource "libvirt_domain" "gpu_vm" {
  for_each = var.vms
  memory   = coalesce(each.value.memory, var.vm_defaults.memory)
  vcpu     = coalesce(each.value.vcpu, var.vm_defaults.vcpu)

  # gpu_passthrough 스위치가 켜져 있을 때만 GPU를 붙인다
  hostdevs = var.vm_defaults.gpu_passthrough ? [
    for gpu in each.value.gpus : {
      subsys_pci = { addr = {
        domain = gpu.domain, bus = gpu.bus, slot = gpu.slot, function = gpu.function
      }}
    }
  ] : []
  # ... disk / cloudinit / network / graphics ...
}
```

수작업이라면 VM XML을 열어 `<hostdev>` 블록을 GPU 개수만큼 삽입해야 하지만, 이제는 맵에 PCI 주소만 적으면 된다. 서버가 바뀌어 PCI 토폴로지가 달라져도 수정할 위치가 맵 한 곳뿐이다. (물론 host 쪽 IOMMU와 vfio 바인딩은 Terraform 외부에서 선행되어야 한다. 그것은 별도 절차다.)

## 5. OS별 초기 설정은 cloud-init + locals로

VM이 구동되자마자 사용자·SSH 키·패키지가 준비되어 있어야 한다. 이 작업은 cloud-init으로 처리한다. libvirt에서는 cloud-init ISO를 만들어 VM에 연결한다(`libvirt_cloudinit_disk`).

문제는 OS마다 세부 사항이 다르다는 것이다. 관리자 그룹명(`sudo` vs `wheel`)과 SSH 서비스명(`ssh` vs `sshd`), 패키지 관리 도구(apt vs dnf)가 다르고, Rocky는 SELinux 컨텍스트 복구(`restorecon`)가 추가로 필요하다. 이 차이를 `locals`에 OS별 표로 정리해서 cloud-init 템플릿에 주입한다.

```hcl
locals {
  os_config = {
    "ubuntu24" = { admin_groups = "sudo",  ssh_service = "ssh",  packages = [...] }
    "rocky9"   = { admin_groups = "wheel", ssh_service = "sshd", packages = [...],
                   cmd_prepend  = ["restorecon -Rv ...", "grubby --update-kernel ..."] }
  }
}
```

VM의 `os` 값으로 이 표에서 선택해서 사용하므로, Ubuntu든 Rocky든 같은 맵에 함께 작성해도 각자에게 맞는 초기화 설정이 적용된다.

사소한 뒤처리 작업도 코드에 담았다. UEFI 부팅 VM은 삭제 후에도 nvram 파일이 남는 문제가 있어서, `null_resource`로 VM 삭제 시점에 nvram을 정리하도록 했다. 수작업으로 처리할 때는 매번 잊곤 했는데, 코드에 한 번 넣어 두니 더는 신경 쓰지 않아도 된다.

옮긴 뒤에 가장 좋았던 점은 "동일하게 다시 만들기"가 공짜가 되었다는 것이다. VM 추가는 맵에 줄 하나 추가로 끝나고, GPU 재배치는 PCI 주소 수정으로 처리되며, OS 추가는 locals에 표 한 칸 추가로 해결된다. 클라우드가 아닌 온프레미스 GPU 서버에서도 Terraform의 선언적 모델이 그대로 통했다. (클라우드 리소스로 Terraform을 처음 익힐 때는 [[LocalStack으로 Terraform 연습하기|LocalStack]]으로 연습했다.)

## 참고

- [[LocalStack으로 Terraform 연습하기]]
- [terraform-provider-libvirt](https://github.com/dmacvicar/terraform-provider-libvirt)
- [Terraform — for_each](https://developer.hashicorp.com/terraform/language/meta-arguments/for_each)
- [cloud-init](https://cloudinit.readthedocs.io/)
