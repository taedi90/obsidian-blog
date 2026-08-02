---
title: 한 워커 노드에서만 파드가 ContainerCreating에 멈춘 이유 (좀비 multus-shim의 CNI DEL hang 추적)
date: 2025-10-15
draft: false
tags:
  - kubernetes
  - multus
  - cni
  - containerd
  - troubleshooting
banner: 
cssclasses: 
description: 워커 한 대에서만 신규 파드와 VM이 ContainerCreating에 무한 대기하던 문제를, 런타임 로그와 좀비 프로세스를 따라가 CNI DEL hang까지 좁혀 잡은 기록.
permalink: 
aliases: 
completed: true
type:
  - issue
---

## 요약

> [!SUMMARY]
> 워커 노드 한 대에서만 새로 스케줄되는 파드와 KubeVirt VM이 `ContainerCreating`에서 안 넘어갔다. containerd 로그의 `StopPodSandbox ... context deadline exceeded`와 그 노드에 쌓인 좀비 `multus-shim` 프로세스를 따라가 보니, CNI DEL 단계에서 shim이 Multus 데몬 응답을 못 받고 hang하는 게 근본 원인이었다. 문제 노드의 Multus 데몬 파드를 재생성하니 붙잡혀 있던 shim이 풀리고 밀려 있던 sandbox 작업이 흘러가면서 신규 파드가 바로 떴다.

## 1. 환경

- CNI: Cilium(primary) + Multus thick plugin(secondary)
- 컨테이너 런타임: containerd
- 워크로드: 일반 파드 + KubeVirt VM(virt-launcher 파드)

> [!NOTE]
> Multus thick plugin 구조를 먼저 짚어둔다. containerd가 CNI를 호출하면 `/opt/cni/bin/multus-shim`이라는 얇은 실행 파일이 뜨고, 이 shim은 실제 일을 직접 하지 않는다. 유닉스 소켓(`/run/multus/multus.sock`)으로 노드마다 도는 <b>Multus 데몬</b>(DaemonSet)에게 요청을 위임하고, 데몬이 delegate CNI(Cilium, bridge 등)를 호출한 결과를 돌려받아 containerd에 전달한다. 그러니까 이 경로는 `containerd → multus-shim → (소켓) → multus 데몬 → delegate CNI`로 이어진 사슬이고, 뒤가 막히면 앞이 통째로 대기한다.

## 2. 이슈

어느 순간부터 워커 한 대에 새로 뜨는 파드가 전부 `ContainerCreating`에 붙박였다. 기존에 이미 떠 있던 파드는 멀쩡히 돌고, 다른 노드는 아무 문제가 없었다. 딱 그 노드에 스케줄된 신규 파드만, 그리고 그 노드에 뜨는 KubeVirt VM(=virt-launcher 파드)만 안 넘어갔다.

`kubectl describe pod`를 봐도 이벤트가 시원하게 이유를 말해주지 않았다. sandbox를 만드는 중이라는 말만 반복될 뿐 에러다운 에러가 없었다. "에러가 안 나는 게 더 무섭다"는 게 딱 이런 경우다. 뭔가 실패한 게 아니라 <b>어딘가에서 그냥 기다리고 있는</b> 상황이라는 뜻이었다.

증상만 정리하면 이렇다.

- 신규 파드/VM이 특정 워커 한 대에서만 `ContainerCreating`에 무한 대기
- 같은 워크로드를 다른 노드에 올리면 정상 기동
- 기존에 떠 있던 파드는 영향 없음

## 3. 해결

### 1. 증상을 노드 단위로 좁히기

먼저 이게 클러스터 전체 문제인지 한 노드 문제인지부터 갈랐다. 멈춘 파드가 어느 노드에 몰려 있는지 본다.

```bash
# Running이 아닌 파드를 노드까지 붙여 나열한다. 특정 노드에 쏠려 있는지 확인용
kubectl get pods -A -o wide | grep -v Running
```

전부 같은 노드였다(여기서는 `worker-04`라 하자). 시험 삼아 문제 파드에 다른 노드로 가는 nodeSelector를 걸어 다시 띄우니 곧장 `Running`이 됐다. 워크로드 잘못이 아니라 노드 잘못이다. 그럼 그 노드 안에서 무슨 일이 벌어지는지로 좁힌다.

### 2. 로그가 가리킨 곳: CNI 호출 타임아웃

파드를 새로 띄우려면 kubelet은 sandbox(pause 컨테이너 + 네트워크 네임스페이스)를 만들고 CNI를 호출해 네트워크를 붙인다. 문제 노드의 containerd·kubelet 로그를 뒤지니 CNI 쪽에서 걸려 있었다.

```bash
# 문제 노드에서 containerd 로그를 sandbox·multus 관련 라인만 추린다
journalctl -u containerd -n 300 --no-pager | grep -iE 'sandbox|multus'
```

이런 문장이 반복해서 찍혔다.

```text
failed to destroy network for sandbox: plugin type="multus-shim" name="multus-cni-network" failed (delete): netplugin failed with no error message: signal: killed
StopPodSandbox from runtime service failed ... context deadline exceeded
```

읽어보면 이렇다. containerd가 CNI 쪽에 "이 sandbox 네트워크 걷어내라(DEL)"를 요청했는데 정해진 시간까지 응답이 없어서, 붙잡고 있던 CNI 플러그인(multus-shim)을 죽이고(`signal: killed`) 타임아웃(`context deadline exceeded`)을 냈다. DEL만 이런 게 아니다. 새 파드가 뜨려면 CNI ADD도 같은 경로를 타는데, 그 경로가 통째로 응답을 못 하니 신규 파드가 `ContainerCreating`에서 안 넘어간 것이다. 그럼 CNI 호출이 왜 응답을 안 하는지로 내려갔다.

### 3. 좀비 multus-shim과 Multus 데몬

CNI를 실제로 호출하는 프로세스를 노드에서 직접 봤다.

```bash
# CNI를 호출하는 multus-shim 프로세스의 상태(STAT)를 본다
ps -eo pid,ppid,stat,etime,cmd | grep multus-shim | grep -v grep
```

`multus-shim` 프로세스가 여러 개 떠 있는데 상당수가 `STAT`이 `Z`(defunct, 좀비)였다. 좀비는 <b>이미 죽었는데 부모(containerd)가 종료 상태를 거둬가지(reap) 못한</b> 프로세스다. 앞 로그의 `signal: killed`와 맞물린다. shim이 DEL을 붙잡고 있다가 타임아웃으로 죽었고, containerd 자신이 밀린 CNI 호출에 묶여 있으니 자식들의 뒤처리(reap)까지 밀린 것이다.

thick plugin 구조상 shim은 혼자 일하지 않고 소켓 너머 노드의 Multus 데몬에 위임한다. shim이 응답을 못 받고 죽어 나간다는 건 그 뒤의 데몬이 제대로 답을 못 준다는 뜻이었다. 그 노드의 Multus 데몬 파드를 봤다.

```bash
# 이 노드의 Multus 데몬 파드 상태
kubectl -n kube-system get pod -o wide -l app=multus | grep worker-04
```

파드 자체는 `Running`이었다. 프로세스는 살아 있는데 CNI 요청은 처리 못 하는, 로그만 봐선 잘 안 잡히는 상태였다. 한 노드에서만 터진 것도 이걸로 설명된다. Multus 데몬은 노드마다 하나씩 도는 DaemonSet이라, 한 노드의 데몬이 맛이 가면 그 노드의 CNI 사슬만 막힌다. (기존 파드가 멀쩡했던 건 이미 네트워크가 붙은 뒤라 CNI를 다시 부를 일이 없었기 때문이다.)

### 4. 복구

막힌 지점이 데몬이니 데몬부터 새로 띄웠다. 문제 노드의 Multus 데몬 파드를 지우면 DaemonSet이 곧바로 다시 만든다.

```bash
# 문제 노드의 Multus 데몬 파드만 재생성한다
kubectl -n kube-system delete pod <kube-multus-ds-파드명>
```

이게 끝이었다. 새 데몬이 소켓을 다시 잡으면서 응답을 기다리던 CNI 호출들이 풀렸고, 붙잡혀 있던 containerd도 밀린 sandbox 작업을 흘려보냈다. 좀비 shim들도 containerd가 뒤처리를 재개하면서 정리됐다. containerd나 노드를 따로 건드릴 것도 없이, 데몬 파드 재생성만으로 신규 파드가 다시 떴다.

## 4. 확인

좀비 shim이 걷혔는지부터 봤다.

```bash
# multus-shim이 남아 있지 않거나, 남아도 Z(defunct)가 아닌지 확인
ps -eo pid,ppid,stat,cmd | grep multus-shim | grep -v grep
```

그다음 그 노드에 새 파드를 올려봤다.

```bash
# 문제 노드에 테스트 파드를 올려 ContainerCreating을 벗어나는지 본다
kubectl run test-after-fix --image=nginx \
  --overrides='{"spec":{"nodeSelector":{"kubernetes.io/hostname":"worker-04"}}}'
kubectl get pod test-after-fix -o wide -w
```

일반 파드는 몇 초 만에 `Running`으로 올라왔고, 문제였던 KubeVirt VM도 그 노드에서 정상 기동하며 secondary 네트워크(eth1)까지 붙었다. containerd 로그의 `context deadline exceeded`도 더는 안 찍혔다.

에러 메시지가 뚜렷했다면 오히려 빨랐을 텐데, "실패"가 아니라 "대기"라 `kubectl` 쪽이 조용했던 게 이 문제의 성격이었다. `ContainerCreating`이라는 한 단어 뒤에 kubelet → containerd → multus-shim → 데몬으로 이어진 사슬이 있고, 그중 어디가 답을 안 하고 붙잡고 있는지를 프로세스 상태까지 내려가 봐야 보였다.

## 참고

- [Multus CNI](https://github.com/k8snetworkplumbingwg/multus-cni)
- [Multus thick plugin (shim + daemon)](https://github.com/k8snetworkplumbingwg/multus-cni/blob/master/docs/thick-plugin.md)
- [CNI SPEC — DEL 동작](https://github.com/containernetworking/cni/blob/main/SPEC.md)
- [Troubleshooting CNI plugin-related errors](https://kubernetes.io/docs/tasks/administer-cluster/migrating-from-dockershim/troubleshooting-cni-plugin-related-errors/)
- [[고밀도 노드에서 신규 파드 네트워크 설정 실패 Multus 데몬 OOMKilled|같은 Multus 데몬이 고밀도 노드에서 OOM으로 죽던 이야기]]
