---
title: 파드 90여 개가 뜬 노드에서 신규 파드 네트워크 설정 실패 (Multus 데몬 메모리 제한 OOMKilled)
date: 2025-10-20
draft: false
tags:
  - kubernetes
  - multus
  - cni
  - oomkilled
  - troubleshooting
banner: 
cssclasses: 
description: 고밀도 노드에서 신규 파드가 'failed to setup network for sandbox'로 멈추던 문제를, Multus 데몬이 기본 50Mi 메모리 제한에 걸려 OOMKilled되는 것으로 좁혀 잡은 기록.
permalink: 
aliases: 
completed: true
type:
  - issue
---

## 🚀 요약

> [!SUMMARY]
> 파드가 90여 개 뜬 고밀도 워커 노드에서 신규 파드가 `failed to setup network for sandbox`로 멈췄다. 원인은 그 노드의 Multus 데몬(thick plugin DaemonSet)이 기본 메모리 제한 `50Mi`에 걸려 반복적으로 OOMKilled되는 것이었다. 파드 밀도가 낮은 노드의 실사용량과 비교해 제한이 지나치게 빡빡함을 확인하고, 메모리 request/limit을 노드 밀도에 맞게 상향해 네트워크 설정을 안정화했다.

## ⚙️ 환경

- CNI: Cilium(primary) + Multus thick plugin(secondary)
- 컨테이너 런타임: containerd
- 워크로드: 일반 파드 + KubeVirt VM(virt-launcher 파드)
- 문제 노드: 파드 약 90개가 스케줄된 고밀도 워커 (여기서는 `worker-07`이라 하자)

> [!NOTE]
> Multus thick plugin은 노드마다 <b>Multus 데몬</b>(DaemonSet) 하나가 돌고, containerd가 CNI를 부를 때 뜨는 `multus-shim`이 유닉스 소켓(`/run/multus/multus.sock`)으로 이 데몬에 일을 위임하는 구조다. 즉 그 노드에서 일어나는 모든 파드의 CNI ADD/DEL이 데몬 한 프로세스를 거친다. 데몬이 죽으면 그 노드의 신규 파드 네트워크가 통째로 막힌다. 같은 thick plugin 구조에서 데몬이 죽는 대신 <b>hang</b>했을 때의 증상은 [[한 노드에서만 파드가 ContainerCreating에 멈추는 문제와 좀비 multus-shim|다른 글]]에 따로 정리해뒀다. 이번은 hang이 아니라 프로세스가 실제로 죽는 경우다.

## 💬 이슈

특정 워커 한 대에 새로 스케줄되는 파드가 `ContainerCreating`을 못 벗어났다. 그런데 이번엔 이벤트가 조용하지 않고 에러를 뱉었다.

```text
# kubectl describe pod <pod> 의 Events
Warning  FailedCreatePodSandBox  10+ times  failed to setup network for sandbox "<sandbox-id>":
  plugin type="multus-shim" name="multus-cni-network" failed (add):
  CmdAdd (shim): failed to send CNI request: Post "http://dummy/cni": EOF
```

`EOF`가 핵심이었다. multus-shim은 CNI 요청을 유닉스 소켓 위 HTTP로 데몬에 넘기는데, `EOF`는 연결은 됐는데 응답을 받기도 전에 상대가 끊었다는 뜻이다. 요청을 받아 처리하던 데몬이 도중에 사라졌다는 얘기다. 앞서 겪은 hang(소켓은 열려 있는데 응답이 없어 무기한 대기하다 timeout) 케이스와는 성격이 달랐다. 그때는 프로세스가 <b>붙잡혀 있었고</b>, 이번엔 <b>아예 죽어 있었다.</b>

증상을 정리하면 이렇다.

- 신규 파드가 특정 워커 한 대에서만 `failed to setup network for sandbox`로 실패
- 실패가 간헐적이었다. 어떤 파드는 몇 번 재시도 끝에 뜨고, 어떤 파드는 계속 실패
- 다른 노드에 올리면 정상. 그 노드는 파드가 90여 개 뜬, 클러스터에서 가장 빽빽한 노드였다

"간헐적으로 실패한다"가 단서였다. 데몬이 완전히 죽어 안 올라오는 거라면 100% 실패해야 하는데, 됐다 안 됐다 한다는 건 데몬이 <b>떴다 죽었다를 반복</b>하고 있다는 얘기다. 살아 있는 사이에 들어온 CNI 요청은 성공하고, 처리 도중 데몬이 죽으면 그 요청이 `EOF`로 실패하는 것이다.

## 🧗 해결

### 1. Multus 데몬의 재시작 횟수

간헐적 실패의 정체부터 확인했다. 그 노드의 Multus 데몬 파드 상태를 봤다.

```bash
# 문제 노드에 뜬 Multus 데몬 파드의 재시작 횟수를 본다
kubectl -n kube-system get pod -o wide | grep multus | grep worker-07
```

`RESTARTS`가 다른 노드의 데몬과 비교가 안 되게 높았고, 그 옆에 최근 재시작 시각이 붙어 있었다. 계속 죽고 다시 뜨는 중이라는 뜻이다. 왜 죽는지는 파드 상세의 마지막 종료 상태에 찍혀 있었다.

```bash
# 컨테이너의 직전 종료 사유(lastState)를 확인한다
kubectl -n kube-system get pod <multus-데몬-파드명> \
  -o jsonpath='{.status.containerStatuses[0].lastState.terminated}' | jq
```

```text
{
  "reason": "OOMKilled",
  "exitCode": 137,
  ...
}
```

`OOMKilled`에 `exitCode: 137`(128 + SIGKILL 9). 메모리 제한을 넘겨서 커널이 프로세스를 죽인 것이다. 데몬이 살해당하면 그 순간 소켓 뒤가 비고, 처리 중이던 요청은 응답 없이 끊긴다. 그게 shim이 본 `EOF`였다. 간헐적 실패가 이걸로 설명됐다.

### 2. 기본 메모리 제한 50Mi

그럼 얼마짜리 제한에 걸린 건지 봤다.

```bash
# Multus 데몬 DaemonSet의 컨테이너 리소스 설정을 본다
kubectl -n kube-system get daemonset kube-multus-ds \
  -o jsonpath='{.spec.template.spec.containers[0].resources}' | jq
```

```json
{
  "requests": { "cpu": "100m", "memory": "50Mi" },
  "limits":   { "cpu": "100m", "memory": "50Mi" }
}
```

Multus thick plugin의 <a href="https://github.com/k8snetworkplumbingwg/multus-cni/blob/master/deployments/multus-daemonset-thick.yml">공식 DaemonSet 매니페스트</a> 기본값이 그대로였다. request와 limit이 둘 다 `50Mi`로 같다. 이러면 QoS는 `Guaranteed`가 되지만, 동시에 `50Mi`가 <b>넘으면 즉시 죽는 하드 상한</b>이 된다. 여유가 0이다.

문제는 이 `50Mi`가 노드 밀도와 무관하게 모든 노드에 똑같이 박힌다는 점이다. Multus 데몬은 그 노드에서 일어나는 모든 파드의 CNI 요청을 처리하고, 파드/NetworkAttachmentDefinition 정보를 apiserver에서 받아 캐시하며, 동시에 들어오는 요청을 함께 다룬다. 그러니 데몬의 실사용 메모리는 <b>그 노드에 뜬 파드 수에 따라 커진다.</b> 파드가 30개 남짓 도는 노드에서도 이미 `50Mi`에 가까웠고, 90여 개가 뜬 노드에서는 그 상한을 넘긴 것이다.

### 3. 밀도별 실사용량 비교

제한을 무작정 올리기 전에, 얼마나 올려야 하는지 근거를 만들었다. 밀도가 낮아 OOM이 안 나는 노드의 데몬이 실제로 메모리를 얼마나 쓰는지 봤다.

```bash
# 각 노드 Multus 데몬의 실사용 메모리를 파드 밀도와 함께 본다
kubectl -n kube-system top pod -l app=multus --sort-by=memory
kubectl get pods -A -o wide --field-selector spec.nodeName=worker-07 | wc -l
```

파드가 30개 남짓인 노드조차 이미 `42Mi`를 써서 `50Mi`의 84%를 채우고 있었고, 파드가 많은 노드일수록 사용량이 더 높았다. 파드 수에 데몬 메모리가 붙어 움직이는 게 숫자로 보였다. 기본값 `50Mi`는 한산한 노드에도 빠듯했고, 고밀도 노드는 그대로 상한을 넘겨 OOM 루프를 돌고 있었다.

### 4. 메모리 제한 상향

request와 limit을 같은 값으로 두면 QoS는 `Guaranteed`로 유지된다. 그 성격은 그대로 두고 상한만 키우기로 했다. 여기서는 `50Mi`에서 `500Mi`로 올렸다. 롤아웃 뒤 가장 많이 쓰는 노드가 `108Mi` 정도였으니 실사용의 몇 배 여유를 둔 셈이다. 값은 클러스터의 최대 파드 밀도에 맞춰 정하면 된다.

```bash
# Multus 데몬 DaemonSet의 메모리 request/limit을 함께 상향한다 (Guaranteed 유지)
kubectl -n kube-system patch daemonset kube-multus-ds --type=json -p='[
  {"op":"replace","path":"/spec/template/spec/containers/0/resources/requests/memory","value":"500Mi"},
  {"op":"replace","path":"/spec/template/spec/containers/0/resources/limits/memory","value":"500Mi"}
]'
```

DaemonSet이라 patch 즉시 각 노드의 데몬 파드가 새 리소스로 롤링 재생성됐다. (매니페스트를 GitOps로 관리한다면 upstream 기본값을 그대로 쓰지 말고 이 오버라이드를 리포에 박아두는 게 맞다. 노드가 빽빽해질수록 또 터질 자리다.)

## ✅ 확인

먼저 데몬이 더는 안 죽는지 봤다.

```bash
# 재시작 횟수가 멈췄는지, OOMKilled가 사라졌는지
kubectl -n kube-system get pod -o wide | grep multus | grep worker-07
kubectl -n kube-system top pod -l app=multus --sort-by=memory
```

`RESTARTS`가 더 늘지 않고, 실사용 메모리가 새 limit 아래에서 안정적으로 유지됐다. 그다음 실제로 파드가 뜨는지 확인했다.

```bash
# 그 노드에 신규 파드를 올려 네트워크 설정을 통과하는지
kubectl get pods -A -o wide --field-selector spec.nodeName=worker-07 | grep -v Running
```

새로 스케줄한 파드가 `failed to setup network for sandbox` 없이 `Running`으로 올라왔고, `EOF`도 더는 안 찍혔다.

에러 메시지 자체(`failed to setup network`, `EOF`)는 CNI를 가리켰지만, 그게 왜 실패하는지는 소켓 뒤 데몬의 종료 사유(`OOMKilled`)까지 내려가야 보였다. 그리고 그 종료가 특정 노드에서만 난 건 기본 메모리 제한이 노드 밀도를 고려하지 않은 고정값이었기 때문이다.

## 🔗 참고

- [Multus CNI](https://github.com/k8snetworkplumbingwg/multus-cni)
- [Multus thick plugin DaemonSet 매니페스트](https://github.com/k8snetworkplumbingwg/multus-cni/blob/master/deployments/multus-daemonset-thick.yml)
- [Managing Resources for Containers (requests/limits, QoS)](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)
- [[한 노드에서만 파드가 ContainerCreating에 멈추는 문제와 좀비 multus-shim]]
- [[흩어진 KubeVirt·Multus 매니페스트를 기능별 단일 트리로 통합|이 Multus·KubeVirt 매니페스트를 한 트리로 정리한 이야기]]
