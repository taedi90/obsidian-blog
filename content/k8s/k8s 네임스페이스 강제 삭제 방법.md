---
title: k8s 네임스페이스 강제 삭제
date: 2023-01-30
draft: false
tags: 
banner: 
cssclasses: 
description: 쿠버네티스 네임스페이스가 Terminating 상태에서 삭제되지 않는 현상을 해결한다.
permalink: 
aliases: 
completed:
---
## 요약

```bash
namespace=<Hang 걸린 네임스페이스>; kubectl get namespace $namespace -o json | jq '.spec.finalizers= []' | kubectl replace --raw "/api/v1/namespaces/$namespace/finalize" -f -
```

## 이슈

네임스페이스를 삭제하다 보면 `Terminating` 상태에서 처리가 되지않고 hang 상태로 빠지는 경우가 있다.

네임스페이스 내부의 리소스가 남아있다던가 비정상적으로 삭제를 시도하려는 경우 발생한다고 한다.

  

## 해결

네임스페이스 내부의 문제를 찾아서 해결하고 모든 리소스를 삭제한 후 네임스페이스를 삭제하는 것이 정석이지만,

아래 명령어를 통해 강제로 처리하는 방법도 있다.

  

```bash
namespace=longhorn; kubectl get namespace $namespace -o json | jq '.spec.finalizers= []' | kubectl replace --raw "/api/v1/namespaces/$namespace/finalize" -f -
```

  

## 참고

- [https://stackoverflow.com/questions/52369247/namespace-stuck-as-terminating-how-i-removed-it](https://stackoverflow.com/questions/52369247/namespace-stuck-as-terminating-how-i-removed-it)