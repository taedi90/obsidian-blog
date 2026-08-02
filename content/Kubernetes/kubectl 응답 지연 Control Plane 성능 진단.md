---
title: kubectl 응답 지연으로 시작한 Control Plane 성능 진단
date: 2025-10-16
draft: false
tags:
  - kubernetes
  - etcd
  - control-plane
  - troubleshooting
  - performance
banner: 
cssclasses: 
description: kubectl이 느려졌다는 신고를 받고, 네트워크부터 배제한 뒤 etcd와 API server 쪽으로 원인을 좁혀간 진단 기록. 극적인 수정보다 근거와 재발 플랜을 남기는 쪽에 무게를 뒀다.
permalink: 
aliases: 
completed: true
type:
  - issue
---

## 요약

> [!SUMMARY]
> `kubectl` 조회가 간헐적으로 지연·hang 되길래, 흔히 "네트워크 탓"으로 몰리는 상황을 먼저 배제했다. 노드 간 `ping`·`iperf3`로 컨트롤플레인 사이 네트워크가 멀쩡함을 계량으로 입증하고, 원인 후보를 etcd DB 단편화·API server 재시작 이력·팔로워 노드 메모리 이상으로 좁혔다. 당장 극적으로 고친 건 없지만, 재발 시 쓸 etcd `defrag`·메모리 증설 대응 플랜을 근거와 함께 남겼다.

## 1. 환경

- Kubernetes: v1.30.5 (kubeadm)
- etcd: 3.5.15-0 (stacked, 마스터 3대에 함께 상주)
- 마스터 노드 3대: `master-01`~`master-03` (`10.10.10.11`~`13`)
- CNI: Cilium

## 2. 이슈

"클러스터가 좀 느린 것 같다"는 신고로 시작했다. 이런 신고가 제일 다루기 싫다. 어디가 어떻게 느린지가 없기 때문이다.

직접 만져보니 증상 자체는 재현됐다. `kubectl get nodes`나 `describe node`는 0.4~0.5초로 멀쩡한데, `kubectl get all -A`처럼 좀 무거운 조회는 3초씩 멎었다가 응답하고, 어떤 때는 아예 hang 걸린 것처럼 한참을 물고 있었다. 워크로드(파드) 쪽은 멀쩡했다. 서비스 트래픽은 정상인데 컨트롤플레인 조회만 굼떴다. 그러니 문제는 애플리케이션이 아니라 <b>컨트롤플레인</b> 어딘가였다.

`kubectl`은 결국 API server를 때리고, API server는 etcd를 읽는다. 그리고 마스터 3대는 서로 etcd peer 트래픽을 주고받는다. 이 경로 어디가 느려도 증상은 똑같이 "kubectl이 느리다"로 보인다. 후보를 늘어놓으면 대충 이렇다.

- 노드 간 네트워크(마스터끼리, 혹은 API server ↔ etcd) 지연·손실
- etcd 자체의 지연 — DB 비대화·단편화, 디스크 I/O
- API server의 불안정 — 재시작·OOM
- 특정 마스터 노드의 자원 압박(메모리)

"느리면 일단 네트워크"라는 심증이 제일 흔하고, 사실 나도 제일 먼저 의심했다. 그런데 심증으로 네트워크를 붙잡고 있으면 정작 다른 원인을 놓친다. 그래서 순서를 반대로 잡았다. <b>네트워크가 범인이 아님을 먼저 숫자로 확정</b>하고, 남는 후보를 파고들기로 했다.

## 3. 해결

### 1. 네트워크 배제 (ping·iperf3)

가장 배제하기 쉬운 후보부터 쳐냈다. 마스터끼리 지연과 손실이 있는지 `ping`으로, 대역폭이 나오는지 `iperf3`로 봤다.

먼저 지연·패킷 손실. 컨트롤플레인 노드 사이를 짧지 않게 때려서 RTT와 loss를 확인했다.

```bash
# master-01 에서 나머지 마스터로. RTT 편차와 packet loss 를 본다.
ping -c 50 -q 10.10.10.12
ping -c 50 -q 10.10.10.13
```

RTT는 같은 스위치 아래 노드답게 sub-ms에 붙어 있었고, 편차도 작고 loss는 0이었다. etcd peer나 API server ↔ etcd 통신이 지연 때문에 샐 만한 그림이 아니었다.

다음은 대역폭. 한 대를 서버로 띄우고 다른 대에서 붙어 던졌다.

```bash
# master-02 에서 서버 모드로 대기
iperf3 -s

# master-01 에서 10초간, 양방향까지 확인
iperf3 -c 10.10.10.12 -t 10
iperf3 -c 10.10.10.12 -t 10 -R   # 역방향(-R)도 같이 본다
```

throughput은 링크 정격 근처로 안정적으로 나왔고, 방향을 바꿔도 마찬가지였다. retransmit도 튀지 않았다. 결론은 분명했다. <b>노드 간 네트워크는 무결하다.</b> 이걸 숫자로 박아두니, 이후 논의에서 "그거 네트워크 아니냐"는 얘기가 다시 나올 때마다 데이터로 잘라낼 수 있었다. 배제도 하나의 결과다.

### 2. API server 재시작 이력

네트워크를 걷어냈으니 컨트롤플레인 컴포넌트 자체를 봤다. API server가 조용히 죽었다 살아났다면, 그 순간마다 `kubectl`이 물릴 수 있다. 재시작 흔적부터 확인했다.

```bash
# kube-apiserver 파드의 RESTARTS 카운트를 본다
kubectl get pods -n kube-system -l component=kube-apiserver -o wide

# 특정 마스터의 apiserver 가 왜 재시작했는지 (Last State / OOMKilled 여부)
kubectl describe pod -n kube-system kube-apiserver-master-03
```

`RESTARTS`가 0이 아닌 정도가 아니라, 마스터별로 수십 회씩 찍혀 있었다(세 대가 대략 30~50회 범위, 그중 두 대는 수십 분 전에 막 재시작한 이력이 있었다). `describe`로 파고드니 `Last State`에 비정상 종료 흔적이 남아 있었다. static pod라 kubelet이 곧바로 되살려서 겉으로는 티가 안 났던 거다. API server가 재시작하는 그 짧은 구간에 그 노드로 붙은 요청이 끊기거나 지연됐을 개연성이 생겼다. 다만 이건 원인이라기보다 <b>증상</b>일 수 있었다. API server가 왜 죽는지, 그 위(etcd)나 아래(노드 자원)를 더 봐야 했다.

### 3. etcd DB 단편화

컨트롤플레인 지연에서 etcd는 늘 1순위 용의자다. `kubectl`이 느린 건 대개 etcd 읽기가 느려서다. etcd 로그부터 봤더니 익숙한 경고가 있었다.

```text
"apply request took too long" ... expected-duration ...
"took too long to execute" ... 
```

etcd가 "이 요청 처리에 시간이 오래 걸렸다"고 스스로 불평하는 로그다. 기대 레이턴시는 100ms 미만인데 실제 쓰기가 100~200ms로 튀었고, 이 경고가 100줄에 수십 번씩 세 멤버 모두에서 나왔다. 그다음 각 멤버의 DB 상태를 표로 봤다.

```bash
# 3개 엔드포인트의 DB SIZE, 리더 여부, 상태를 한 표로
etcdctl endpoint status --cluster --write-out=table \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key
```

DB SIZE가 클러스터 규모에 비해 부풀어 있었다. 그런데 여기서 중요한 건 "디스크에 잡힌 크기(dbSize)"와 "실제 사용 중인 크기(dbSizeInUse)"가 다르다는 점이다. etcd는 MVCC로 리비전을 쌓다가 compaction으로 옛 리비전을 논리적으로 지우는데, 그렇게 비워진 공간이 <b>디스크에서 곧바로 반환되지 않고 파일 안에 빈 페이지로 남는다</b>. 이게 단편화(fragmentation)다. 그 상태를 두 메트릭으로 확인했다.

```bash
# 디스크에 물린 전체 크기 vs 실제 사용 중 크기. 둘이 벌어질수록 단편화가 심하다.
curl -s http://127.0.0.1:2381/metrics | grep -E \
  'etcd_mvcc_db_total_size_in_bytes|etcd_mvcc_db_total_size_in_use_in_bytes'
```

`total_size`(디스크 점유)가 약 210MB인데 `in_use`(실사용)는 100MB 남짓이었다. 절반 넘게가 빈 페이지, 즉 단편화율이 50%를 웃돌았다. 부푼 DB 위에서 읽기·쓰기가 도니 지연이 나는 그림과 맞아떨어졌다. 여기서 defrag의 유혹이 오지만, `defrag`는 대상 멤버를 잠깐 <b>정지</b>시키는 blocking 작업이다. 운영 중인 클러스터에 무턱대고 3대 다 돌리면 이번엔 defrag가 장애를 만든다. 그래서 이 자리에서 즉흥으로 돌리지 않고 절차로 남기기로 했다(뒤 확인 절 참고).

### 4. 팔로워 노드 메모리

마지막으로 노드 자원. API server가 왜 재시작했는지의 답이 여기 있을 수 있었다. 마스터 3대의 메모리를 나란히 봤다.

```bash
# 세 마스터의 메모리 여유를 나란히 확인
for h in 10.10.10.11 10.10.10.12 10.10.10.13; do echo "== $h =="; ssh $h free -h; done
```

리더 노드는 램이 15GB라 절반 넘게 여유가 있었는데, 팔로워 두 대는 램이 절반 수준(7.5GB)이라 여유가 유독 빠듯했다. 눈에 걸린 건 etcd 메모리였다. 팔로워 etcd가 각각 1GB 안팎을 쓰는데 리더 etcd는 570MB 정도였다. 팔로워가 리더보다 etcd 메모리를 두 배 가까이 쓰는 건 정상적인 그림이 아니다. etcd와 API server가 함께 상주하는 stacked 구성이라, 그 노드에서 메모리가 조이면 etcd 성능이 흔들리고 API server가 OOM 압박을 받는다. 2번에서 본 재시작이 이 팔로워들에 몰려 있었다는 점과도 얼추 겹쳤다. 세 후보(단편화·재시작·메모리)가 서로 남남이 아니라 자원이 빠듯한 팔로워 위에서 얽혀 있었던 셈이다.

## 4. 확인

이번 진단으로 <b>확정</b>한 건 네거티브 결과였다. 노드 간 네트워크는 `ping`·`iperf3` 숫자로 무결함을 입증했고, 지연의 무게중심은 etcd/노드 자원 쪽이라고 근거를 붙여 좁혔다. "느리면 네트워크"라는 기본 심증을 데이터로 배제한 것, 그게 이 작업의 실질 산출물이다.

다음 날 다시 봤을 때 증상은 이미 완화돼 있었다. 응답도 정상 범위로 돌아왔다. 그래서 당장 운영 클러스터를 세워가며 defrag를 돌리는 대신 <b>관망·모니터링</b>으로 결정했다. 대신 재발 시 바로 집어들 대응 플랜을 문서로 남겼다. 급하게 손대다 defrag가 2차 장애를 만드는 걸 막으려는 목적이 컸다.

- <b>etcd defrag</b>는 한 번에 한 멤버씩, 트래픽이 낮은 시간에. 팔로워부터 돌리고 리더는 마지막에. 각 멤버 사이엔 클러스터가 안정됐는지 `endpoint status`로 확인하고 넘어간다.

```bash
# 반드시 단일 엔드포인트로 지정해 한 멤버씩만 정지시킨다. --cluster 로 한꺼번에 돌리지 말 것.
etcdctl defrag --endpoints=https://10.10.10.11:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key
```

- <b>auto-compaction</b> 설정을 걸어 리비전이 무한정 쌓이지 않게 한다. 단편화의 재료 자체를 줄이는 쪽이다.
- 메모리가 빠듯하던 팔로워 노드는 <b>메모리 증설</b> 대상으로 올렸다. stacked etcd에선 컨트롤플레인 노드 자원이 곧 etcd 성능이다.
- etcd DB 크기와 `apply` 지연, 노드 메모리에 알림을 걸어, 다음엔 "느린 것 같다"는 신고가 아니라 알림으로 먼저 알게 만든다.

극적으로 뭔가를 뒤집는 트러블슈팅은 아니었다. 다만 모호한 신고 하나를 "네트워크는 결백, 무게중심은 etcd·메모리"까지 근거로 좁히고, 성급한 조치가 만들 다음 장애까지 막는 절차를 남겼으니 이 정도면 됐다 싶다.

## 참고

- [etcd Maintenance (defrag·compaction)](https://etcd.io/docs/v3.5/op-guide/maintenance/)
- [etcd Metrics](https://etcd.io/docs/v3.5/metrics/)
- [Operating etcd clusters for Kubernetes](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/)
- [iperf3](https://github.com/esnet/iperf)
- [[마스터 노드 IP 변경 후 etcd 무손실 복구|같은 클러스터의 etcd를 다뤄본 다른 기록]]
