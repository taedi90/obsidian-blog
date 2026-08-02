---
title: SigNoz infra monitoring에서 메모리가 높게 뜨는 증상
date: 2025-07-16
draft: false
tags:
  - signoz
  - monitoring
  - memory
  - troubleshooting
banner: 
cssclasses: 
description: SigNoz의 인프라 모니터링이 파드/노드 메모리를 실제보다 높게 보여준 증상. page cache까지 "사용 중"으로 집계한 게 원인이라, working set 기준으로 봐야 한다.
permalink: 
aliases: 
completed: true
type:
  - issue
---

## 요약

> [!SUMMARY]
> SigNoz의 infra monitoring 대시보드가 파드·노드 메모리를 실제 체감보다 <b>훨씬 높게</b> 표시했다. 원인은 <b>page cache(재확보 가능한 캐시 메모리)까지 "사용 중"으로 집계</b>한 것이었다. 리눅스에서 캐시는 필요하면 커널이 회수하므로 진짜 압박 지표가 아니다. OOM이 실제로 보는 값은 <b>working set</b>이라, 이 기준으로 읽어야 한다. SigNoz [이슈 #7057](https://github.com/SigNoz/signoz/issues/7057)로 트래킹됐고 이후 버전에서 고쳐질 것으로 봤다.

메트릭이 "틀린" 게 아니라, <b>어느 메모리 값을 쓰느냐</b>의 문제였다.

## 1. 증상

infra monitoring에서 파드/노드 메모리 사용량이 위험해 보일 만큼 높게 떴다. 그런데 정작 OOM이 나거나 성능이 나빠지는 정황은 없었다. "숫자는 빨간데 실제로는 멀쩡한" 상태라, 알람 임계치를 잡기가 애매했다.

## 2. 원인: page cache를 "사용 중"으로 셈

리눅스 메모리는 크게 이렇게 나뉜다.

- <b>실제 작업에 쓰는 메모리</b>(working set) — 회수하면 프로세스가 죽거나 느려지는 부분.
- <b>page cache</b> — 파일 I/O를 위해 커널이 캐싱해둔 것. <b>메모리가 부족하면 커널이 알아서 회수</b>한다. "쓰는 중"이 아니라 "여유가 있어 캐싱해둔 것"에 가깝다.

cgroup의 `container_memory_usage_bytes`는 이 <b>둘을 합친 값</b>이다. SigNoz의 해당 지표가 이 합계를 그대로 "사용 중"으로 보여주면서, 캐시가 많은 워크로드일수록 메모리가 부풀어 보였다. 실제 압박은 없는데 그래프만 빨갛게 뜬 것이다.

OOM killer가 판단에 쓰는 값은 캐시를 뺀 <b>working set</b>(`container_memory_working_set_bytes`)이다. 그래서 "이 파드가 limit에 얼마나 다가갔나"를 보려면 usage가 아니라 working set을 봐야 한다.

## 3. 대응

- <b>working set 기준으로 읽기.</b> 대시보드·알람의 메모리 지표를 `container_memory_working_set_bytes`(또는 그에 대응하는 SigNoz 지표)로 잡아, 캐시를 뺀 실사용을 본다. 알람 임계치도 이 값에 건다([[알람 구성|알람]]의 메모리 기준도 limit 대비 working set으로).
- <b>버전 추적.</b> 이건 SigNoz 쪽 집계 이슈([#7057](https://github.com/SigNoz/signoz/issues/7057))로 등록돼 있어, 업스트림 수정이 반영되는 버전으로 올리면 대시보드 기본값도 정리될 것으로 봤다.

교훈은 단순하다. 컨테이너 메모리를 볼 땐 "usage"가 아니라 "working set"이다. 캐시까지 세는 지표로 알람을 걸면, 멀쩡한 워크로드에 계속 헛알람이 온다.

## 참고

- [[알람 구성|SigNoz 알람 구성]]
- [SigNoz issue #7057](https://github.com/SigNoz/signoz/issues/7057)
- [Kubernetes — Memory: working set vs usage](https://kubernetes.io/docs/tasks/configure-pod-container/assign-memory-resource/)
