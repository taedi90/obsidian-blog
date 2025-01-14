---
title: Linux 서버에 열려있는 포트 확인하기
date: 2023-07-19
draft: false
tags:
  - linux
  - network
banner: 
cssclasses: 
description: 특정 호스트의 모든 port 를 scan 하는 방법을 알아보았습니다.
permalink: 
aliases: 
completed:
---
## 요약

> nmap 192.168.0.100

## 이슈

방치되어있던 시놀로지 나스의 포트번호가 기억나지 않아 전체 포트를 스캔해야하는 상황이 발생했고 `tcping [example.com] [port]` 명령어로는 65535 번 반복해서 조회를 해야했기 때문에 다른 명령어를 찾아보게 되었다.

## 해결

### nmap 설치

```bash
# MacOS
brew install nmap

# ubuntu
sudo apt-get install nmap

# centOS
sudo yum install nmap

# windows 는 https://nmap.org/download.html 여기서 다운로드
```

  

### 사용법

- 전체 tcp 포트 스캔
    
    ```bash
    $ nmap 10.10.98.42
    Starting Nmap 7.94 ( https://nmap.org ) at 2023-07-19 08:55 KST
    Nmap scan report for 10.10.98.42
    Host is up (0.00019s latency).
    Not shown: 988 closed tcp ports (conn-refused)
    PORT      STATE SERVICE
    80/tcp    open  http
    443/tcp   open  https
    548/tcp   open  afp
    873/tcp   open  rsync
    3000/tcp  open  ppp
    3001/tcp  open  nessus
    3261/tcp  open  winshadow
    5566/tcp  open  westec-connect
    50001/tcp open  unknown
    50002/tcp open  iiimsf
    ```
    
- 전체 udp 포트 스캔  
    udp 포트 스캔을 위해서는 sudo 권한이 필요하다.  
    
    ```bash
    $ sudo nmap -sU 10.10.98.42
    Password:
    Starting Nmap 7.94 ( https://nmap.org ) at 2023-07-19 09:11 KST
    Nmap scan report for 10.10.98.42
    Host is up (0.00057s latency).
    Not shown: 994 closed udp ports (port-unreach)
    PORT     STATE         SERVICE
    68/udp   open|filtered dhcpc
    123/udp  open          ntp
    137/udp  open          netbios-ns
    138/udp  open|filtered netbios-dgm
    1900/udp open          upnp
    5353/udp open          zeroconf
    MAC Address: 00:00:00:00:00:00 (Synology Incorporated)
    
    Nmap done: 1 IP address (1 host up) scanned in 1086.98 seconds
    ```
    
- 특정 포트만 스캔
    
    ```bash
    $ nmap 10.10.98.42 -p80
    Starting Nmap 7.94 ( https://nmap.org ) at 2023-07-19 09:16 KST
    Nmap scan report for 10.10.98.42
    Host is up (0.0044s latency).
    
    PORT   STATE SERVICE
    80/tcp open  http
    
    Nmap done: 1 IP address (1 host up) scanned in 0.13 seconds
    ```
    

## 참고

- [https://linuxhint.com/port_scan_linux/](https://linuxhint.com/port_scan_linux/)
- `man nmap`