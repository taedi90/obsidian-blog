---
title: Forti VPN 무료버전 로그인 풀림 해결
date: 2025-12-30
draft: true
tags:
banner:
cssclasses:
description:
permalink:
aliases:
completed:
---

## 요약
> [!summary]
> 

## 1. 환경
- 
## 2. 이슈

## 3. 해결

config 파일
```bash
host = {{}}
port = {{}}
username = {{}}
password = {{}}
trusted-cert = {{}}
```

sudo vim /Library/LaunchDaemons/com.openfortivpn.plist
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.openfortivpn</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/openfortivpn</string>
        <string>-c</string>
        <string>{{config 파일 경로}}</string>
    </array>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/var/log/openfortivpn.out</string>
    <key>StandardErrorPath</key>
    <string>/var/log/openfortivpn.err</string>
</dict>
</plist>
```

```bash
sudo chown root:wheel /Library/LaunchDaemons/com.openfortivpn.plist
sudo chmod 644 /Library/LaunchDaemons/com.openfortivpn.plist
sudo launchctl load /Library/LaunchDaemons/com.openfortivpn.plist
sudo launchctl list | grep openfortivpn
```

```bash
sudo launchctl unload /Library/LaunchDaemons/com.openfortivpn.plist
```

로그 확인
```
sudo tail -f /var/log/openfortivpn.out /var/log/openfortivpn.err
```

서비스 다시 로드
```
# 기존 서비스 내리기
sudo launchctl bootout system/com.openfortivpn

# 수정된 서비스 다시 올리기
sudo launchctl bootstrap system /Library/LaunchDaemons/com.openfortivpn.plist
```

재시작
```
# 맥OS 서비스 재시작 명령어 
sudo launchctl kickstart -k system/com.openfortivpn
```

## 참고
- [https://github.com/adrienverge/openfortivpn](https://github.com/adrienverge/openfortivpn)
