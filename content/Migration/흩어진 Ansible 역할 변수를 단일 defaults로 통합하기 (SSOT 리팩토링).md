---
title: 흩어진 Ansible 역할 변수를 단일 defaults로 통합하기 (SSOT 리팩토링)
date: 2025-10-10
draft: false
tags:
  - ansible
  - iac
  - refactoring
  - offline-install
  - kubernetes
banner: 
cssclasses: 
description: 서브롤마다 흩어져 값까지 어긋나 있던 오프라인 설치 역할의 변수를, 단일 defaults/main.yml로 모으고 벤더 롤 잔재를 걷어낸 리팩토링 기록.
permalink: 
aliases: 
completed: true
type:
  - improvement
---

## 요약

> [!SUMMARY]
> 폐쇄망 설치용 Ansible 역할(`offline_preinstall`)의 변수가 서브롤마다 defaults 파일로 흩어져 있었다. 같은 변수가 여러 파일에 중복됐고, 한 변수는 파일마다 값이 어긋나 있었으며(드리프트), 같은 값을 이름만 다르게 부르는 쌍도 있었다. 이걸 최상위 역할의 `defaults/main.yml` 한 파일로 모으고, 커뮤니티 롤을 벤더링하면서 딸려 온 molecule·tests·예제·CI 짐을 걷어냈다. 변수의 출처를 한 곳(SSOT)으로 만든 게 핵심이다.

이건 [[오프라인 설치 과정|오프라인 설치기]]처럼 "어떻게 설치하나"를 다루는 글이 아니다. 그 설치를 굴리던 Ansible 역할이 시간이 지나며 변수 지옥이 됐고, 그걸 손본 이야기다. 기능은 그대로 두고 구조만 정리한 작업이라 티는 안 나지만, 다음에 값 하나 바꾸는 비용을 확 줄였다.

## 1. 왜 손대야 했나

`offline_preinstall`은 Kubespray로 클러스터를 올리기 전에 노드를 준비하는 역할이다. 오프라인 저장소를 물리고, 리눅스 패키지를 깔고, GPU 노드면 NVIDIA 스택(드라이버·CUDA·컨테이너 툴킷)을 다루는 서브롤을 태운다. 그런데 이 서브롤을 여럿 거느리고 있었다.

```text
roles/offline_preinstall/
├── repo/                      # 오프라인 저장소 설정
├── package/                   # 리눅스 패키지 설치
└── nvidia/                    # NVIDIA 스택
    ├── driver/                #   드라이버
    ├── cuda/                  #   CUDA 툴킷
    └── container-toolkit/     #   컨테이너 툴킷
```

문제는 이 서브롤마다 각자 `defaults/main.yml`을 하나씩 들고 있었다는 거다. Ansible에서 역할의 `defaults/`는 변수 기본값을 두는 자리인데, 이게 여러 군데로 쪼개져 있으니 "이 변수 기본값이 뭐지?"를 알려면 파일을 여럿 뒤져야 했다. 심지어 같은 변수가 여러 파일에 <b>중복</b>으로 선언돼 있었다.

`nvidia_driver_ubuntu_cuda_keyring_package`가 대표적이었다. `nvidia/driver/defaults/main.yml`에는 `cuda-keyring_1.0-1_all.deb`로, `nvidia/cuda/defaults/main.yml`에는 `cuda-keyring_1.1-1_all.deb`로 박혀 있었다. 같은 이름의 변수인데 파일마다 값이 달랐다. 어느 파일이 진짜 먹히는지 헷갈리는 사이에 값이 이미 어긋나 있었던 것이다. `epel_package`, `nvidia_driver_rhel_cuda_repo_baseurl`처럼 두 파일에 똑같이 복사돼 있는 변수도 곳곳에 있었다.

이름이 미묘하게 다른 쌍둥이도 있었다. EPEL GPG 키 변수를 driver 쪽은 `epel_repo_key`로, cuda 쪽은 `epel_key_url`로 부르고 있었다. 값은 같은데 이름이 달라서, 각 서브롤 태스크가 서로 다른 이름을 참조했다.

## 2. 서브롤마다 흩어진 defaults

`nvidia/driver/defaults/main.yml`과 `nvidia/cuda/defaults/main.yml`을 나란히 놓으면 중복이 한눈에 보인다. 아래는 두 파일에 <b>똑같이</b> 들어 있던 변수들이다.

```yaml
# nvidia/driver/defaults/main.yml 과 nvidia/cuda/defaults/main.yml 양쪽에 중복
epel_package: "https://dl.fedoraproject.org/pub/epel/epel-release-latest-{{ ansible_distribution_major_version }}.noarch.rpm"
nvidia_driver_rhel_cuda_repo_baseurl: "https://developer.download.nvidia.com/compute/cuda/repos/{{ _rhel_repo_dir }}/"
nvidia_driver_rhel_cuda_repo_gpgkey:  "https://developer.download.nvidia.com/compute/cuda/repos/{{ _rhel_repo_dir }}/D42D0685.pub"
nvidia_driver_ubuntu_cuda_repo_baseurl: "https://developer.download.nvidia.com/compute/cuda/repos/{{ _ubuntu_repo_dir }}"
old_nvidia_driver_ubuntu_cuda_repo_gpgkey_id: "7fa2af80"
# 이 변수만 값이 어긋나 있었다 (driver: 1.0-1, cuda: 1.1-1)
nvidia_driver_ubuntu_cuda_keyring_package: "cuda-keyring_1.0-1_all.deb"
```

여기에 쓰지도 않는 잔재가 얹혀 있었다. `nvidia_docker_wrapper_url`(옛 nvidia-docker 래퍼 스크립트 주소), 이름에 `old_`가 붙은 `old_nvidia_driver_ubuntu_cuda_repo_gpgkey_id` 같은 것들이다. 이름부터가 언젠가 지웠어야 할 물건이었다.

지저분함은 값이 가리키는 곳에서도 드러났다. 오프라인 전용 역할인데 인터넷에 직접 붙는 URL이 defaults에 그대로 남아 있었다.

```yaml
# 폐쇄망 노드가 닿을 수 없는 온라인 원본 주소들
nvidia_docker_repo_base_url: "https://nvidia.github.io/libnvidia-container"
nvidia_docker_wrapper_url:   "https://raw.githubusercontent.com/NVIDIA/nvidia-docker/master/nvidia-docker"
# 이름만 다른 변수를 하위 호환용으로 다시 참조하는 우회
nvidia_docker_skip_docker_restart: "{{ nvidia_docker_skip_docker_reload }}"
```

`reload` 변수를 `restart` 변수로 갈아타면서 하위 호환용으로 남긴 우회 참조인데, 주석에 "backward compatibility"라 적힌 채 방치돼 있었다. 이런 게 리팩토링의 신호다.

이 서브롤들이 이렇게 지저분해진 이유는 대충 짐작이 갔다. NVIDIA 서브롤은 커뮤니티 롤을 통째로 벤더링해서 들여온 흔적이 뚜렷했다. `driver/` 밑에 `LICENSE`, `.github/workflows/molecule.yml`, `meta/.galaxy_install_info`, `molecule/`, `tests/`가 다 딸려 있었다. 우리 리포엔 필요 없는 원본 롤의 CI·테스트 짐이 그대로 들어와 방치된 것이다.

## 3. 단일 defaults/main.yml로 통합

방향은 단순했다. 흩어진 서브롤 defaults를 전부 없애고, 최상위 역할의 `defaults/main.yml` 한 곳으로 모은다. 서브롤은 `include_role`로 부르니, 부모 역할의 defaults에 값을 두면 서브롤들이 그 값을 공유한다. 변수의 <b>단일 진실 공급원(SSOT, Single Source of Truth)</b>을 하나 만드는 것이다.

중복은 하나로 합치고, 이름이 어긋난 쌍(`epel_repo_key`/`epel_key_url`)은 `epel_repo_key`로 통일하고, 값이 어긋났던 키링 패키지는 실제로 쓰는 `1.1-1`로 확정했다. 인터넷에 직접 붙는 URL은 지우는 대신 별도 구획에 모아, 오프라인에선 안 쓰지만 호환을 위해 남겨둔 값이라는 걸 주석으로 못 박았다.

```yaml
##############################################################################
# Offline Preinstall Role - Default Variables
##############################################################################
# 이 역할과 서브롤(repo, package, nvidia)의 기본값을 한 파일로 통합

# --- Repository ---
yum_repo: http://localhost/rpms      # RedHat 계열 로컬 저장소
ubuntu_repo: http://localhost/debs   # Ubuntu 로컬 저장소

# --- Online Mode URLs (오프라인에선 안 쓰지만 호환 위해 남김) ---
epel_repo_key: "https://dl.fedoraproject.org/pub/epel/RPM-GPG-KEY-EPEL-{{ ansible_distribution_major_version }}"
nvidia_driver_ubuntu_cuda_keyring_package: "cuda-keyring_1.1-1_all.deb"   # 드리프트 값 확정
```

> [!NOTE]
> Ansible에서 역할 defaults는 변수 우선순위가 가장 낮은 층이다. 값을 실제로 바꾸고 싶으면 인벤토리 `group_vars`나 플레이북 vars로 덮는다. defaults가 여러 파일로 흩어져 있으면 "어디를 고쳐야 먹히나"가 불투명해지는데, 한 파일로 모으면 기본값의 출처가 명확해진다. 환경별로 다른 값은 인벤토리에서 덮으면 되고, defaults는 안전한 기본값만 담는 자리로 역할이 또렷해진다.

## 4. 벤더 롤 잔재 정리

변수만 합친 게 아니라 벤더 롤 짐도 버렸다. NVIDIA 서브롤은 커뮤니티 롤을 통째로 벤더링해 들여온 거라, 우리 파이프라인에서 돌리지도 않는 `molecule/`, `tests/`, `examples/`, `.github/workflows/`, `LICENSE`, `meta/.galaxy_install_info`가 그대로 딸려 있었다. 남겨둘 이유가 없어 미사용 파일과 빈 껍데기가 된 디렉토리를 지웠다.

플레이북 헤더도 다시 썼다. 예전엔 한 줄짜리 설명뿐이었는데, 목적과 수행 작업을 주석 블록으로 박아 첫머리만 읽어도 이게 뭘 하는 플레이북인지 알게 했다.

```yaml
##############################################################################
# 오프라인 클러스터 설치 사전 준비 플레이북
##############################################################################
# 목적: Kubespray 실행 전 노드 환경 구성
#
# 수행 작업:
# 1. 방화벽 비활성화
# 2. 필요 리눅스 패키지 설치
##############################################################################
```

## 5. 결과

서브롤마다 흩어졌던 defaults를 최상위 역할의 `defaults/main.yml` 한 곳으로 모았다. 중복을 합치고, 이름이 어긋난 쌍과 값이 드리프트된 변수를 하나로 확정하고, 벤더 롤에서 딸려 온 molecule·tests·예제·CI 짐을 걷어냈다. 통합 후 `ansible-playbook --syntax-check`로 구문은 확인했다.

체감으로 남은 건 따로 있다. 키링 패키지 버전 하나 바꾸려고 어느 파일이 진짜인지 뒤지던 일이 사라졌다. 이제 `defaults/main.yml` 한 곳만 열면 된다. 값이 어긋날 여지도 구조적으로 없어졌다. 기능은 그대로인데 다음 사람(대개 미래의 나)이 손댈 때의 비용만 낮춘, 조용한 리팩토링이다.

## 참고

- [Ansible — Using Variables (변수 우선순위)](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_variables.html)
- [Ansible — Roles (defaults와 include_role)](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_reuse_roles.html)
- [[오프라인 설치 과정|폐쇄망 오프라인 설치기]]
