---
title: Ubuntu 22.04 에 microk8s 설치
date: 2022-11-28
draft: false
tags:
  - microk8s
banner: 
cssclasses: 
description: Ubuntu 22.04 에 microk8s 설치하기
permalink: 
aliases: 
completed:
---
microk8s 설치 중 calico-kube-controller 가 CrashLoopBackOff 상태에 머무르는 증상이 발생하여 네트워크 설정을 포함한 세팅 과정을 기록하였다.

  

### 시스템 날짜 세팅

  

```bash
$ sudo apt update
$ sudo timedatectl set-timezone 'Asia/Seoul'

# 변경 확인
$ date
```

  

### cgroup enable

  

```bash
$ sudo vim /etc/default/grub
```

  

`GRUB_CMDLINE_LINUX` 에 다음 옵션을 추가한다.

> cgroup_enable=memory cgroup_memory=1 systemd.unified_cgroup_hierarchy=0

- 작성 완료 예시
    
    ```bash
    $ sudo cat /etc/default/grub
    # If you change this file, run 'update-grub' afterwards to update
    # /boot/grub/grub.cfg.
    # For full documentation of the options in this file, see:
    #   info -f grub -n 'Simple configuration'
    
    GRUB_DEFAULT=0
    GRUB_TIMEOUT_STYLE=hidden
    GRUB_TIMEOUT=0
    GRUB_DISTRIBUTOR=`lsb_release -i -s 2> /dev/null || echo Debian`
    GRUB_CMDLINE_LINUX_DEFAULT="quiet splash"
    GRUB_CMDLINE_LINUX="cgroup_enable=memory cgroup_memory=1 systemd.unified_cgroup_hierarchy=0"
    
    # Uncomment to enable BadRAM filtering, modify to suit your needs
    # This works with Linux (no patch required) and with any kernel that obtains
    # the memory map information from GRUB (GNU Mach, kernel of FreeBSD ...)
    \#GRUB_BADRAM="0x01234567,0xfefefefe,0x89abcdef,0xefefefef"
    
    # Uncomment to disable graphical terminal (grub-pc only)
    \#GRUB_TERMINAL=console
    
    # The resolution used on graphical terminal
    # note that you can use only modes which your graphic card supports via VBE
    # you can see them in real GRUB with the command `vbeinfo'
    \#GRUB_GFXMODE=640x480
    
    # Uncomment if you don't want GRUB to pass "root=UUID=xxx" parameter to Linux
    \#GRUB_DISABLE_LINUX_UUID=true
    
    # Uncomment to disable generation of recovery mode menu entries
    \#GRUB_DISABLE_RECOVERY="true"
    
    # Uncomment to get a beep at grub start
    \#GRUB_INIT_TUNE="480 440 1"
    ```
    

  

```bash
$ sudo update-initramfs -u
$ sudo update-grub
```

  

### 네트워크 세팅

  

```bash
$ cat << EOF | sudo tee /etc/sysctl.d/k8s.conf
net.bridge.bridge-nf-call-ip6tables = 1
net.bridge.bridge-nf-call-iptables = 1
net.ipv4.ip_forward = 1
EOF

$ sudo systemctl enable --now iptables
$ sudo iptables -P INPUT ACCEPT
$ sudo iptables -P FORWARD ACCEPT
$ sudo iptables -P OUTPUT ACCEPT
$ sudo iptables -F
$ sudo iptables --flush
$ sudo iptables -tnat --flush
```

  

### microk8s 설치

  

```bash
# microk8s 설치
$ sudo snap install microk8s --classic

# 그룹추가, config 파일 권한 설정
$ sudo usermod -a -G microk8s $USER
$ sudo chown -f -R $USER ~/.kube
$ su – $USER

# core-dns, local-path-storage kube-dashboard 설치
# microk8s status 에서 enable 할 수 있는 목록을 확인할 수 있음
$ microk8s enable dns storage dashboard

$ microk8s stop
$ microk8s start
```

  

### 기타. bash alias & completion 설정

  

```bash
$ sudo apt install bash-completion

# k 는 'microk8s kubectl' mc 는 'microk8s' 로 세팅했다.
$ cat << EOF | sudo tee -a /etc/bash.bashrc
# microk8s
alias mc='microk8s'
alias k='microk8s kubectl'
alias kubectl='microk8s kubectl'
source <(microk8s kubectl completion bash)
complete -o default -F __start_kubectl k
source <(microk8s helm3 completion bash)
alias helm='microk8s helm3'
EOF
```

  

### 참고

- [https://microk8s.io/](https://microk8s.io/)
- [https://analytiqltd.co.ke/2022/11/28/microk8s-setup-on-ubuntu-22-04/](https://analytiqltd.co.ke/2022/11/28/microk8s-setup-on-ubuntu-22-04/)