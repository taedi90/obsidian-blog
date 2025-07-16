---
title: nfs-subdir-provisioner pvc 삭제 불가 이슈
date: 2025-07-16
draft: true
tags:
  - nfs
  - pvc
  - provisioner
  - troubleshooting
banner: 
cssclasses: 
description: 
permalink: 
aliases: 
completed: 
type:
  - issue
---

삭제할때 pathpattern 있으면 삭제안됨

https://github.com/kubernetes-sigs/nfs-subdir-external-provisioner/issues/347

https://github.com/kubernetes-sigs/nfs-subdir-external-provisioner/issues/272

  
  

해결방법

4.0.18 버전으로 이미지를 직접 빌드해서 갈아치운다