---
title: gitlab container registry API 인증 없이 사용하기
date: 2023-01-09
draft: false
tags:
  - gitlab
banner: 
cssclasses: 
description: gitllab registry init 단계에서 인증문제로 api 호출이 불가능한 상황에 대한 임시대응 방법을 알아본다.
permalink: 
aliases: 
completed:
---
## 요약

> [!important]  
> gitlab-registry configmap 의 아래 내용을 주석처리한다.# auth:# token:# realm: https://hostname/jwt/auth# service: container_registry# issuer: \"gitlab-issuer\"# # This is provided from the initContainer execution, at a known path.# rootcertbundle: /etc/docker/registry/certificate.crt# autoredirect: false  

## 이슈

gitlab container registry 를 이용해 private registry 를 구성하는 중, “UNAUTHORIZED” 에러를 마주하게 되었다.

```bash
$ curl --insecure https://<registry-host>/v2/_catalog
{"errors":[{"code":"UNAUTHORIZED","message":"authentication required","detail":[{"Type":"registry","Class":"","Name":"catalog","Action":"*"}]}]}
```

## 해결

정상적인 방법으론 Bearer Token 을 발급 받아서 활용하는 방법이 있다.

```bash
$ curl --user <user>:<private-token> "https://<gitlab-host>/jwt/auth?service=container_registry&scope=repository:group/project:push,pull" | jq '.token'
```

  

하지만 내부에서만 사용할 레지스트리라 gitlab-registry configmap 내부의 auth 부분을 주석처리해서 인증 자체를 disable 해버렸다.

```bash
####################################################
# gitlab-registry configmap 의 아래 내용을 주석처리한다.
####################################################

# auth:
#   token:
#     realm: https://<registry-host>/jwt/auth
#     service: container_registry
#     issuer: \"gitlab-issuer\"
#     # This is provided from the initContainer execution, at a known path.
#     rootcertbundle: /etc/docker/registry/certificate.crt
#     autoredirect: false
```

## 참고

- [https://docs.gitlab.com/ee/administration/packages/container_registry.html#enable-the-container-registry](https://docs.gitlab.com/ee/administration/packages/container_registry.html#enable-the-container-registry)
- [https://github.com/ipernet/gitlab-docs/blob/master/gitlab-registry.md](https://github.com/ipernet/gitlab-docs/blob/master/gitlab-registry.md)