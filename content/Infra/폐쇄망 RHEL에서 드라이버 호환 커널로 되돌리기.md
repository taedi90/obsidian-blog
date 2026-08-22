---
title: 폐쇄망 RHEL에서 드라이버 호환 커널로 정확히 되돌리기
date: 2025-11-17
draft: false
tags:
  - rhel
  - rocky-linux
  - nvidia
  - dkms
  - kernel
  - air-gapped
  - troubleshooting
banner: 
cssclasses: 
description: 고객 운영계에 고정된 특정 커널에 NVIDIA 드라이버를 맞춰야 하는 폐쇄망에서, Rocky vault 저장소로 정확한 커널 버전을 되돌려 설치한 기록.
permalink: 
aliases: 
completed: true
type:
  - issue
---

## 요약

> [!SUMMARY]
> 고객 운영계에 고정된 특정 커널(`el8_8` 계열)에 NVIDIA 드라이버를 맞춰야 했는데, 기본 저장소에는 그 커널의 `kernel-devel`/`kernel-headers`가 없어 dkms가 모듈을 빌드하지 못했다. Rocky Linux vault 저장소를 dnf에 추가해 아카이브된 정확한 커널 버전을 지정 설치하고, nvidia rpm은 인터넷이 되는 호스트에서 의존성까지 받아 패키징해 폐쇄망으로 반입했다. 커널-드라이버 버전 정합성을 맞춘 뒤에야 dkms 빌드가 통과했다.

## 1. 환경

- 고객 운영계: RHEL 8.8 계열, 커널 `4.18.0-477.15.1.el8_8`로 고정 (버전은 대표값으로 표기)
- GPU 서버, NVIDIA open kernel module(dkms) 방식 설치
- 완전 폐쇄망: 외부 저장소·인터넷 직접 접근 불가

## 2. 이슈

고객 운영계 GPU 서버에 드라이버를 설치해야 했다. 문제는 이 서버의 커널이 특정 버전에 <b>고정</b>되어 있다는 점이었다. 운영계는 검증된 커널에서만 운영하는 것이 원칙이라 임의로 최신 버전으로 올릴 수 없다. 커널은 그대로 두고, 그 커널에 맞는 드라이버를 설치해야 하는 상황이었다.

NVIDIA 드라이버를 open kernel module(dkms) 방식으로 설치하면, dkms가 <b>현재 실행 중인 커널의 소스로 커널 모듈을 그 자리에서 빌드</b>한다. 그래서 빌드에는 실행 커널과 정확히 같은 버전의 `kernel-devel`, `kernel-headers`가 필요하다. 여기서 버전이 조금이라도 어긋나면 모듈이 커널에 맞지 않아 `nvidia-smi`가 장치를 찾지 못한다.

그런데 폐쇄망에 물려 있는(정확히는 사내 미러를 바라보는) 이 서버에서 `kernel-devel`을 설치하려 하면, 실행 커널이 아니라 저장소에 올라온 최신 커널(`el8_10` 계열, `4.18.0-553.x`)용 패키지가 잡혔다.

```bash
# 실행 커널은 el8_8인데, 기본 저장소가 내주는 kernel-devel은 el8_10 최신이다.
uname -r
# 4.18.0-477.15.1.el8_8.x86_64

sudo dnf install kernel-devel
# → kernel-devel-4.18.0-553.8.1.el8_10  ← 실행 커널과 버전이 다르다
```

이유는 단순하다. RHEL/Rocky의 기본 저장소는 <b>해당 마이너 버전의 최신 포인트 릴리스만</b> 서비스한다. 이전 포인트 릴리스 패키지는 시간이 지나면 vault(아카이브)로 이동하여 기본 저장소에서 사라진다. 운영계 커널은 이미 몇 단계 이전의 릴리스이므로, 그에 맞는 `kernel-devel`/`kernel-headers`가 기본 저장소에는 남아 있지 않았다. 결국 "실행 커널에 맞는 개발 패키지를 어디서 구하느냐"가 핵심 과제였다.

## 3. 해결

### 1. Rocky vault 저장소에서 정확한 커널 패키지 확보

사라진 옛 패키지는 vault 저장소에 그대로 남아 있다. Rocky Linux는 `dl.rockylinux.org/vault` 경로에 마이너 버전별 아카이브를 공개해두는데, 여기에는 8.8 시점의 `BaseOS`/`AppStream` 패키지가 통째로 보존되어 있다. 운영계가 RHEL이더라도 Rocky는 바이너리 호환 관계이므로, `el8_8` 패키지를 그대로 가져다 쓸 수 있다.

인터넷이 되는 별도 호스트(운영계와 같은 8.8로 맞춘 스테이징)에 vault 저장소를 dnf에 추가했다.

```bash
# Rocky 8.8 vault를 dnf 저장소로 추가한다. 8.8 시점 패키지가 아카이브돼 있다.
sudo dnf config-manager --add-repo=https://dl.rockylinux.org/vault/rocky/8.8/BaseOS/x86_64/os/
```

여러 저장소를 한 번에 구성하기 위해 `.repo` 파일을 직접 작성하는 편이 깔끔했다. `$releasever`는 vault 경로와 어긋날 수 있으므로 버전(`8.8`)을 URL에 고정해두었다.

```ini
# /etc/yum.repos.d/rocky-vault.repo
[rocky-vault-baseos]
name=Rocky Linux 8.8 - BaseOS - Vault
baseurl=https://dl.rockylinux.org/vault/rocky/8.8/BaseOS/x86_64/os/
enabled=1
gpgcheck=1
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-rockyofficial

[rocky-vault-appstream]
name=Rocky Linux 8.8 - AppStream - Vault
baseurl=https://dl.rockylinux.org/vault/rocky/8.8/AppStream/x86_64/os/
enabled=1
gpgcheck=1
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-rockyofficial

[rocky-vault-powertools]
name=Rocky Linux 8.8 - PowerTools - Vault
baseurl=https://dl.rockylinux.org/vault/rocky/8.8/PowerTools/x86_64/os/
enabled=1
gpgcheck=1
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-rockyofficial

[rocky-vault-extras]
name=Rocky Linux 8.8 - Extras - Vault
baseurl=https://dl.rockylinux.org/vault/rocky/8.8/extras/x86_64/os/
enabled=1
gpgcheck=1
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-rockyofficial
```

메타데이터를 새로 만들고, `--showduplicates` 옵션으로 해당 버전이 실제로 vault에 존재하는지부터 확인했다.

```bash
sudo dnf clean all
sudo dnf makecache

# vault를 붙였으니 옛 커널 릴리스가 후보로 뜬다.
sudo dnf list --showduplicates kernel
```

목록에서 드라이버를 설치할 el8_8 버전을 확인한 뒤, 그 버전을 정확히 지정하여 설치했다. 커널과 함께 `kernel-devel`, `kernel-headers`도 같은 버전으로 맞춘다. 여기가 이 작업의 핵심이다. dkms가 참조할 커널 소스를 <b>커널과 완전히 동일한 버전</b>으로 설치해두는 것이다.

```bash
# 최신으로 올리지 않고, vault가 보존한 el8_8 버전을 명시해 설치한다(대표값 4.18.0-477.15.1.el8_8).
sudo dnf install \
  kernel-4.18.0-477.15.1.el8_8 \
  kernel-devel-4.18.0-477.15.1.el8_8 \
  kernel-headers-4.18.0-477.15.1.el8_8
```

> [!NOTE]
> dkms가 참조하는 대상은 실행 커널의 소스이므로, 커널과 그 `kernel-devel`/`kernel-headers`가 모두 같은 버전으로 맞물려 있어야 한다. 최신 버전으로 올려버리면 다시 devel이 없는 상황이 되므로, vault가 아직 제공하는 el8_8 버전에 맞추는 것이 핵심이다.

### 2. nvidia rpm은 호스트에서 받아 패키징

폐쇄망 서버는 vault든 NVIDIA CUDA 저장소든 직접 접근할 수 없다. 그래서 저장소를 서버에 연결하는 대신, 인터넷이 되는 호스트에서 필요한 rpm을 <b>의존성까지 통째로</b> 받아 묶은 뒤 반입했다.

연결된 호스트에 NVIDIA CUDA 저장소를 추가하고, 설치가 아니라 다운로드만 수행했다. `--resolve`로 의존성까지 같이 받는 것이 폐쇄망 반입의 관건이다. 하나라도 빠지면 격리된 서버에서 설치가 멈춘다.

```bash
# 연결된 호스트에 CUDA 저장소 추가
sudo dnf config-manager --add-repo=https://developer.download.nvidia.com/compute/cuda/repos/rhel8/x86_64/cuda-rhel8.repo

# 설치하지 않고, 의존성까지 한 폴더에 내려받는다.
sudo dnf install --downloadonly --downloaddir=./nvidia-rpms --resolve \
  nvidia-driver:open-dkms

# 반입용으로 묶는다.
tar czf nvidia-rpms.tar.gz ./nvidia-rpms
```

이 묶음과 앞서 받은 커널 패키지를 폐쇄망 서버로 옮긴 뒤, 로컬 파일만으로 설치했다. 저장소를 거치지 않고 내려받은 rpm 디렉토리에서 바로 설치하면 된다.

```bash
# 반입한 rpm 디렉토리에서 로컬 설치. dkms가 el8_8 커널 소스로 모듈을 빌드한다.
sudo dnf install ./nvidia-rpms/*.rpm
```

## 4. 확인

먼저 실행 커널과 설치된 `kernel-devel` 버전이 같은지 확인했다. 이것이 어긋나 있으면 나머지는 볼 필요도 없다.

```bash
uname -r
# 4.18.0-477.15.1.el8_8.x86_64
rpm -q kernel-devel
# kernel-devel-4.18.0-477.15.1.el8_8.x86_64  ← 실행 커널과 일치
```

그다음 dkms가 모듈을 실제로 빌드하여 등록했는지 확인한다. 상태가 `installed`로 실행 커널에 표시되어 있으면 정상이다.

```bash
# 실행 커널(kernel: 4.18.0-477.15.1.el8_8)에 nvidia 모듈이 installed로 붙어야 한다.
dkms status
```

마지막으로 `nvidia-smi`가 GPU를 정상적으로 인식하면 끝이다. 커널-드라이버 버전이 맞지 않던 동안에는 여기서 계속 장치를 찾지 못했다.

```bash
nvidia-smi
```

버전 정합성만 맞추면 나머지는 평범하게 진행되었다. 폐쇄망이라 저장소를 연결할 수 없다는 점이 처음엔 막막했지만, 결국 실행 커널에 맞는 패키지를 어디서 구하고 어떻게 반입하느냐의 문제였다.

## 참고

- [Rocky Linux Vault](https://dl.rockylinux.org/vault/rocky/)
- [NVIDIA Driver Installation Guide](https://docs.nvidia.com/datacenter/tesla/driver-installation-guide/index.html)
- [NVIDIA CUDA repo (rhel8)](https://developer.download.nvidia.com/compute/cuda/repos/rhel8/x86_64/cuda-rhel8.repo)
- [[신형 Blackwell GPU 드라이버가 안 잡힐 때 OS·드라이버 조합 매트릭스로 뚫기|OS·드라이버 조합을 맞춰 드라이버를 잡은 이야기]]
