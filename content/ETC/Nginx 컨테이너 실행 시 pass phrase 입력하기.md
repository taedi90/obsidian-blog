---
title: Nginx 컨테이너 실행 시 pass phrase 입력하기
date: 2024-09-30
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
> port listen 이 없는 nginx.conf 로 컨테이너 실행
> nginx.conf 치환 후 service nginx restart

## 1. 환경
- Nginx : 1.22
## 2. 이슈
pass phrase 가 적용된 인증서를 사용하려 할 때 nginx 를 컨테이너로 실행하면 어째서인지 인터랙티브 모드를 허용해도 `Enter PEM pass phrase:` 메시지가 표시되지 않습니다. 컨테이너는 일반적으로 인터랙티브 모드를 지양하기 때문에 '굳이 그걸 왜 써? ssl_password_file 을 적용해'와 같은 내용들이 주류를 이루고 있었지만, 고객사 보안 담당자가 무슨 일이 있어도 본인이 직접 입력하겠다고 하니 방법을 찾을 수밖에 없었습니다.

## 3. 해결
- `nginx -s reload` 명령어를 사용하면 프로세스를 종료하지 않고 설정을 로드할 수 있다고 합니다. 다만 실패했습니다.
	- 명령어 실행 이후에도 변경이 이루어지지 않았습니다. (config 가 올바르게 리로드되는지 의문이 생깁니다.)
- `service nginx reload` 도 동작하지 않았습니다.
	- Reloading nginx: nginx failed!
- `service nginx restart` 는 동작했습니다.

```bash
#!/bin/bash

cat /etc/nginx/templates/default.conf.template.original > /etc/nginx/conf.d/default.conf

service nginx restart
```

초기에 nginx 프로세스가 port 를 점유하고 있으면 bind 실패 오류가 발생합니다.

```
Restarting nginx: nginxEnter PEM pass phrase:
Enter PEM pass phrase:
2024/09/30 11:59:36 [emerg] 59#59: bind() to 0.0.0.0:443 failed (98: Address already in use)
nginx: [emerg] bind() to 0.0.0.0:443 failed (98: Address already in use)
2024/09/30 11:59:36 [emerg] 59#59: bind() to 0.0.0.0:80 failed (98: Address already in use)
nginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)
2024/09/30 11:59:36 [notice] 59#59: try again to bind() after 500ms
2024/09/30 11:59:36 [emerg] 59#59: bind() to 0.0.0.0:443 failed (98: Address already in use)
nginx: [emerg] bind() to 0.0.0.0:443 failed (98: Address already in use)
2024/09/30 11:59:36 [emerg] 59#59: bind() to 0.0.0.0:80 failed (98: Address already in use)
nginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)
2024/09/30 11:59:36 [notice] 59#59: try again to bind() after 500ms
2024/09/30 11:59:36 [emerg] 59#59: bind() to 0.0.0.0:443 failed (98: Address already in use)
nginx: [emerg] bind() to 0.0.0.0:443 failed (98: Address already in use)
2024/09/30 11:59:36 [emerg] 59#59: bind() to 0.0.0.0:80 failed (98: Address already in use)
nginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)
2024/09/30 11:59:36 [notice] 59#59: try again to bind() after 500ms
2024/09/30 11:59:36 [emerg] 59#59: bind() to 0.0.0.0:443 failed (98: Address already in use)
nginx: [emerg] bind() to 0.0.0.0:443 failed (98: Address already in use)
2024/09/30 11:59:36 [emerg] 59#59: bind() to 0.0.0.0:80 failed (98: Address already in use)
nginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)
2024/09/30 11:59:36 [notice] 59#59: try again to bind() after 500ms
2024/09/30 11:59:36 [emerg] 59#59: bind() to 0.0.0.0:443 failed (98: Address already in use)
nginx: [emerg] bind() to 0.0.0.0:443 failed (98: Address already in use)
2024/09/30 11:59:36 [emerg] 59#59: bind() to 0.0.0.0:80 failed (98: Address already in use)
nginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)
2024/09/30 11:59:36 [notice] 59#59: try again to bind() after 500ms
2024/09/30 11:59:36 [emerg] 59#59: still could not bind()
nginx: [emerg] still could not bind()
 failed!
```

## 참고
- 노가다
