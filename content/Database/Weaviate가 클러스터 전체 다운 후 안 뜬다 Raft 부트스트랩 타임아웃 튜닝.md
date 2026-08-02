---
title: Weaviate가 클러스터 전체 다운 후 안 뜬다 - Raft 부트스트랩 타임아웃 튜닝
date: 2025-12-10
draft: false
tags:
  - weaviate
  - vector-database
  - raft
  - kubernetes
  - troubleshooting
banner: 
cssclasses: 
description: 클러스터를 통째로 내렸다 올렸더니 한 환경의 Weaviate만 raft 관련 로그를 뱉으며 크래시 루프에 빠졌다. 같은 구성인데 왜 하나만 안 떴는지 쫓아간 기록.
permalink: 
aliases: 
completed: true
type:
  - issue
---

## 요약

> [!SUMMARY]
> 쿠버네티스 클러스터를 통째로 내렸다 복구하니 한 환경의 Weaviate만 `raft requestVote`/`heartbeat` 실패로 크래시 루프에 빠졌다. 같은 매니페스트인데 데이터가 20배 많은 환경만 스키마 캐치업이 부트스트랩 타임아웃을 넘겨 죽고 있었고, `RAFT_BOOTSTRAP_TIMEOUT`과 `RAFT_TIMEOUTS_MULTIPLIER`, 스냅샷 임계값을 올려서 기동시켰다.

## 1. 환경

- Weaviate 1.25+ (Raft로 메타데이터를 복제하는 버전대)
- Kubernetes StatefulSet 배포, 멀티 노드 구성
- 동일 매니페스트를 쓰는 두 환경 — dev, stg
- 데이터 용량: dev 약 1GB, stg 약 20GB

## 2. 이슈

쿠버네티스 클러스터가 통째로 내려간 적이 있었다. 노드를 다시 살리고 나니 대부분은 알아서 올라오는데, Weaviate만 상태가 이상했다. 파드가 떴다 죽었다를 반복하는 크래시 루프였다.

로그를 보니 죄다 raft 이야기였다.

```text
raft failed to make requestVote RPC ...
raft failed to heartbeat to ...
raft Election timeout reached, restarting election
could not join a cluster
bootstrap: context deadline exceeded
could not open cloud meta store
```

여기서 좀 갸웃했던 건, <b>dev 클러스터는 복구 후 멀쩡히 올라왔다</b>는 점이다. stg만 이 꼴이었다. 매니페스트도, Weaviate 버전도, 노드 구성도 같은데 한쪽만 안 뜨니 처음엔 네트워크나 라벨 같은 걸 의심했다. requestVote가 실패한다길래 노드끼리 raft 포트가 막혔나 싶어 그쪽부터 뒤졌는데, 포트는 열려 있었다.

## 3. 해결

### 1. 왜 stg만 안 떴을까

Weaviate 1.25부터 Raft가 <b>스키마 같은 메타데이터를 노드 간에 복제</b>하는 데 쓰인다. 클래스 정의, 샤딩 정보 같은 클러스터 메타데이터가 raft 로그로 관리된다는 뜻이다. 노드가 재시작하면 이 raft 로그를 처음부터 재생(replay)하면서 자기 상태를 최신으로 맞추는데, Weaviate는 이 과정을 "스키마 캐치업(Schema catching up)"이라고 부른다.

문제는 이 캐치업이 부트스트랩 단계 안에서 끝나야 한다는 거다. 캐치업이 정해진 시간 안에 안 끝나면 부트스트랩이 `context deadline exceeded`로 죽고, 그 상태에서 raft가 리더를 못 잡으니 `requestVote`/`heartbeat`가 줄줄이 실패하는 것처럼 보인다. 겉으로 드러난 raft 에러는 증상이고, 진짜 원인은 캐치업이 제 시간에 못 끝난 거였다.

그러면 dev는 되고 stg만 안 되는 것도 설명이 된다. <b>두 환경의 결정적 차이는 데이터 용량</b>이었다. dev는 1GB, stg는 20GB. 데이터가 많으니 재생할 raft 로그도, 쌓인 스키마 상태도 훨씬 무겁다. dev는 기본 타임아웃 안에 캐치업이 끝나서 살아났고, stg는 그 안에 못 끝내 매번 부트스트랩 도중에 죽었던 것이다. 같은 설정이 어떤 환경에선 충분하고 어떤 환경에선 모자란, 흔한 종류의 함정이었다.

이건 Weaviate 쪽에서도 알려진 이슈로 문서화돼 있었다. 부하가 크거나 데이터가 많을 때 raft 타임아웃이 걸리는 케이스다.

### 2. 타임아웃과 스냅샷 임계값 조정

원인을 잡고 나니 손댈 곳은 명확했다. 캐치업이 끝날 때까지 부트스트랩이 안 죽게 시간을 벌어주면 된다. StatefulSet의 컨테이너 환경변수를 이렇게 올렸다.

```yaml
# Weaviate 파드 컨테이너 env. 캐치업이 끝날 때까지 부트스트랩/선거가
# 성급하게 실패하지 않도록 타임아웃과 스냅샷 임계값을 여유 있게 잡았다.
env:
  - name: RAFT_BOOTSTRAP_TIMEOUT   # 부트스트랩(캐치업 포함) 허용 시간, 초
    value: "1200"
  - name: RAFT_TIMEOUTS_MULTIPLIER # heartbeat/election 등 raft 타임아웃 전반을 배수로 확장
    value: "15"
  - name: RAFT_SNAPSHOT_INTERVAL   # 스냅샷 생성 주기, 초
    value: "600"
  - name: RAFT_SNAPSHOT_THRESHOLD  # 스냅샷을 뜨기 전까지 허용하는 raft 로그 엔트리 수
    value: "24576"
```

각 값이 하는 일을 나눠 보면 이렇다.

- <b>RAFT_BOOTSTRAP_TIMEOUT</b>: 캐치업이 이 시간 안에 안 끝나면 죽는 그 타임아웃이다. 20GB를 재생할 여유를 주려고 1200초(20분)로 크게 잡았다. 이 값을 늘리면 파드 기동이 그만큼 오래 걸릴 수 있으니, 쿠버네티스 `startupProbe`의 `failureThreshold`도 같이 넉넉히 잡아 캐치업이 끝나기 전에 kubelet이 파드를 죽여버리지 않게 해야 한다. (문서 권장값은 90 수준.)
- <b>RAFT_TIMEOUTS_MULTIPLIER</b>: heartbeat·election 같은 raft 타임아웃 전반에 곱해지는 배수다. 부하가 큰 상황에서 리더 선거가 조급하게 재시작되는 걸 눌러준다. 문서에서는 5~15 범위를 권한다.
- <b>RAFT_SNAPSHOT_INTERVAL / RAFT_SNAPSHOT_THRESHOLD</b>: 초기 기동 중 로그가 과도하게 쌓여 스냅샷 임계값을 건드리며 꼬이는 걸 피하려고 같이 올렸다. 급한 불을 끄기 위한 임시 상향에 가깝다.

값을 올리고 파드를 재기동하니 stg도 캐치업을 끝까지 돌리고 정상 기동했다. 근본적으로 데이터를 줄인 게 아니라 "끝날 때까지 기다려준" 것에 가깝지만, 크래시 루프에서 빠져나오는 게 먼저였다.

### 3. Prometheus가 raft 포트를 긁는 문제

여기서 하나 더. Weaviate의 raft 포트(8300)와 memberlist 포트(7000, 7100-7103)를 Prometheus가 스크랩 대상으로 긁으면 `failed to decode incoming command` 같은 오류가 뜬다. HTTP 메트릭 요청을 raft가 알 수 없는 명령으로 받아서 나는 잡음이다. 서비스 디스커버리에서 이 포트들이 스크랩 대상에 안 들어가게 막아두는 편이 깔끔하다.

> [!NOTE]
> 클러스터 간에 IP를 재사용하는 환경(같은 대역을 여러 클러스터가 돌려 쓰는 경우)이라면 `RAFT_ENABLE_FQDN_RESOLVER=true`와 `RAFT_FQDN_RESOLVER_TLD`를 설정해 IP 대신 FQDN 기반으로 노드를 찾게 하는 옵션도 있다. 우리 상황은 여기까진 아니어서 적용하진 않았지만, 노드 디스커버리가 IP 때문에 꼬인다면 볼 만하다.

## 4. 확인

값을 올린 뒤 stg 파드 로그를 다시 봤다. `bootstrap: context deadline exceeded`로 끊기던 자리에서 이번엔 캐치업 진행 로그가 끝까지 올라왔다.

```text
Schema catching up: applying log entry: [X/Y]
```

`[X/Y]`의 X가 Y에 도달하고 나면 raft가 리더를 잡고, 그 뒤로 requestVote/heartbeat 에러가 더는 안 뜬다. 파드가 `Running`으로 안정되고 재시작 카운트가 더 안 오르는지, `kubectl get pod`로 몇 분 지켜본 뒤 마무리했다. dev와 달리 stg는 애초에 데이터가 무거웠던 거라, 앞으로 데이터가 더 늘면 이 타임아웃도 다시 손봐야 할 수 있다.

## 참고

- [Weaviate Known Issues — RAFT timeouts under heavy load](https://docs.weaviate.io/weaviate/release-notes/known-issues#raft-timeouts-under-heavy-load)
- [Weaviate cluster setup failing (forum)](https://forum.weaviate.io/t/weaviate-cluster-setup-with-docker-on-different-servers-failing/3318)
- [Error transferring leadership on single node cluster (forum)](https://forum.weaviate.io/t/weaviate-error-transferring-leadership-on-single-node-cluster/9207)
- [[Weaviate 클러스터 간 증분 동기화 스크립트로 컷오버 다운타임 줄이기|Weaviate 데이터를 클러스터 간 옮긴 이야기]]
