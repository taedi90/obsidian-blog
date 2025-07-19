---
title: 노드 Failover 이후 complete 파드 처리
date: 2025-07-17
draft: true
tags: 
banner: 
cssclasses: 
description: 
permalink: 
aliases: 
completed: 
type:
  - issue
---
노드 Fail 후 노드에 있던 파드들은 다른 노드로 옮겨갔지만 기존 파드들이 삭제되지 않고 Error 이나 Completed 상태로 남아있어 거슬린다.

그리고 노드 Fail 직후 deployment 같은 경우에는 다른 노드로 파드가 이동하지만 Statefulset 의 경우에는 상태가 유지되어버린다. 이건 그대로 놔둬도 괜찮을까?


> **정리**:  
> 노드 Fail 후 파드의 Error/Completed 상태가 완전히 사라지지 않는 것은 Kubernetes의 동작상 "단기적으로 있을 수 있는 현상"이나, 자동 정리 옵션(TTL, 컨트롤러 등) 및 주기적 점검/정리로 운영 복잡성을 미연에 방지하는 것이 최선입니다.

