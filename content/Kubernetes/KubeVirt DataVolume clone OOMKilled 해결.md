---
title: KubeVirt DataVolume clone이 OOMKilled로 0%에서 멈출 때
date: 2025-07-14
draft: false
tags:
  - kubernetes
  - kubevirt
  - cdi
  - datavolume
  - troubleshooting
banner: 
cssclasses: 
description: VM 디스크 clone이 반복해서 OOMKilled로 0%를 벗어나지 못하던 문제를, CDI clone 파드 메모리와 과대한 베이스 PVC 두 축에서 풀어낸 기록.
permalink: 
aliases: 
completed: true
type:
  - issue
---

## 🚀 요약

> [!SUMMARY]
> KubeVirt에서 VM을 찍을 때마다 베이스 DataVolume을 clone하는데, 이 clone이 진행률 0%에서 계속 OOMKilled로 죽었다. 원인은 두 개였다. CSI 볼륨 clone을 못 받쳐주는 스토리지라 host-assisted clone으로 떨어지는데, CDI가 띄우는 clone 파드의 메모리 limit이 옮길 데이터에 비해 낮아서 그 한도를 넘겨 죽었고, 베이스 PVC가 실사용 대비 수십 배로 부풀려 있어 clone이 처리할 데이터 자체가 컸다. CDI 파드 메모리 limit을 2Gi로 올리고 베이스 PVC를 30Gi에서 10Gi로 줄여 clone을 통과시켰다.

## ⚙️ 환경

- Kubernetes 클러스터에 KubeVirt + CDI(cdi-operator, cdi-cr) 설치
- 스토리지: CSI 볼륨 clone/스냅샷을 지원하지 않는 스토리지(그래서 뒤에 나오는 host-assisted clone으로 떨어진다)
- 베이스 이미지: Rocky Linux 9 GenericCloud 이미지로 만든 베이스 `DataVolume`
- VM은 `dataVolumeTemplates`로 이 베이스 PVC를 clone해서 root 디스크를 만드는 구조

## 💬 이슈

VM을 재사용성 있게 찍으려고 베이스 `DataVolume`을 미리 만들어두고, `VirtualMachine`의 `dataVolumeTemplates`에서 그걸 clone해 root 디스크로 쓰는 구조를 잡았다. 구성은 [[kubevirt-setting|KubeVirt 오프라인 테스트 환경 글]]에 정리해둔 그대로다.

문제는 VM을 켜는 순간이었다. clone용 파드가 뜨긴 뜨는데, `kubectl get dv`로 보면 진행률이 계속 `0.00%`에 멈춰 있었다.

```bash
# clone 대상 DataVolume의 상태와 진행률을 본다.
kubectl get datavolume
# NAME             PHASE           PROGRESS   AGE
# master1-disk     CloneScheduled  0.00%      3m
```

파드를 들여다보니 clone을 실행하는 파드가 `OOMKilled`로 재시작을 반복하고 있었다. `Progress`가 0인 게 아니라, 애초에 데이터를 옮기기도 전에 죽으니 0에서 못 벗어나는 거였다.

```bash
# clone 관련 파드의 종료 사유를 확인한다.
kubectl get pod <clone-pod> -o jsonpath='{.status.containerStatuses[0].lastState.terminated.reason}'
# OOMKilled
```

처음엔 노드 메모리가 부족한가 싶어 스케줄된 노드만 쳐다봤는데, 노드는 여유가 있었다. 문제는 clone 파드에 걸린 메모리 limit이었다. 이 limit이 clone이 실제로 쓰는 양보다 낮으니, 파드가 그 한도를 넘기는 순간 cgroup OOM으로 죽는 거였다. (원인 두 개가 얽혀 있었는데, 처음엔 그걸 몰라서 노드만 애꿎게 의심했다.)

## 🧗 해결

### 1. clone이 어떻게 도는가

먼저 이 clone이 실제로 어떻게 동작하는지부터 확인해야 했다. CDI는 가능하면 가장 효율적인 clone 전략을 고르는데, CSI 스냅샷이나 볼륨 clone을 지원하는 스토리지면 그 기능을 그대로 위임한다(<b>smart clone</b>). 이러면 실데이터를 파드로 퍼 나르지 않으니 메모리 이슈랄 게 거의 없다.

내 환경 스토리지는 스냅샷/clone을 안 받쳐줬다. 그래서 CDI가 <b>host-assisted clone</b>으로 떨어졌다. 이 방식은 소스 파드와 타깃(upload) 파드를 띄워서, 소스에 있는 이미지를 tar로 스트리밍해 타깃 PVC에 써넣는다. 즉 clone 데이터가 파드를 실제로 통과한다. 문제가 여기서 나온 거였다.

이 clone 파드에는 CDI가 정한 메모리 limit이 걸린다. 그런데 그 limit이 30Gi짜리 볼륨을 tar로 퍼 나르는 데는 낮아서, clone이 데이터를 밀어넣기 시작하자마자 한도를 넘겨 OOMKilled로 떨어졌다. 그래서 진행률이 0%를 못 벗어난 거였다.

### 2. CDI clone·upload 파드 메모리 상향

CDI가 띄우는 importer/upload/clone 파드의 리소스는 CDI CR의 `spec.config.podResourceRequirements`로 한 번에 지정할 수 있다. 여기에 request와 limit을 명시하면 CDI가 만드는 보조 파드 전부에 그 값이 적용된다.

```yaml
# CDI CR의 spec.config에 clone/import/upload 파드가 공통으로 쓸
# 리소스 request/limit을 지정한다.
apiVersion: cdi.kubevirt.io/v1beta1
kind: CDI
metadata:
  name: cdi
spec:
  config:
    podResourceRequirements:
      requests:
        memory: "200Mi"
      limits:
        memory: "2Gi"      # 기본 limit이 낮아 여기까지 올렸다
```

메모리 limit에 딱 떨어지는 정답값이 있는 건 아니다. 너무 낮으면 그대로 OOM, 너무 높게 잡으면 노드 자원을 통째로 예약해버려 다른 파드가 스케줄을 못 받는다. 나는 2Gi로 올려서 clone을 통과시켰다. CDI 파드 메모리 사용량은 이미지 크기와 변환 여부에 좌우되니, 이 값은 각자 이미지에 맞춰 다시 잡는 게 맞다.

> [!NOTE]
> `podResourceRequirements`는 CDI가 띄우는 모든 보조 파드에 공통 적용된다. clone뿐 아니라 베이스 이미지를 받아오는 importer 파드도 같은 설정을 쓴다. 그래서 이 값 하나를 잡아두면 import 단계의 안정성도 같이 올라간다.

### 3. 베이스 이미지와 PVC 슬림화

메모리만 올려도 clone은 통과했다. 그런데 여기서 멈추면 절반만 고친 거였다. clone이 무거웠던 진짜 이유 하나가 더 있었기 때문이다.

베이스 `DataVolume`의 `storage` 요청을 30Gi로 잡아뒀는데, 정작 Rocky Linux GenericCloud 이미지의 실제 데이터는 1.1GB 남짓이었다. 실사용 대비 수십 배로 부풀린 PVC였던 셈이다. host-assisted clone은 소스 볼륨을 타깃으로 옮기는 작업이라, 볼륨이 클수록 파드가 다뤄야 하는 양도 커진다. clone을 편하게 만들려면 옮길 짐부터 줄이는 게 맞았다.

그래서 베이스 `DataVolume`의 `storage`를 30Gi에서 10Gi로 내렸다. 어차피 root 디스크는 VM `dataVolumeTemplates`에서 원하는 크기로 다시 요청하니까, 베이스는 이미지가 들어갈 만큼만 있으면 된다. 다만 무작정 줄이면 안 됐다. 처음에 5Gi로 잡았더니 `DataVolume too small to contain image`로 실패했다. qcow2 클라우드 이미지는 압축 해제하면 다운로드 크기보다 커져서, 실제 데이터가 1.1GB라도 그보다 여유가 필요했다. 10Gi로 잡으니 들어갔다.

이렇게 베이스를 슬림하게 만들고 나니, 앞서 올린 메모리와 맞물려 clone이 안정적으로 끝까지 돌았다.

## ✅ 확인

VM을 다시 켜고 clone `DataVolume`의 진행률이 실제로 올라가는지 봤다.

```bash
# clone 진행률이 0%를 벗어나 Succeeded까지 가는지 확인한다.
kubectl get datavolume -w
# NAME             PHASE            PROGRESS   AGE
# master1-disk     CloneInProgress  42.15%     1m
# master1-disk     Succeeded        100.00%    3m
```

진행률이 0을 벗어나 100%까지 올라가고 `Succeeded`로 끝났다. clone 파드도 `OOMKilled` 없이 정상 종료됐고, 그 볼륨을 root 디스크로 문 VM이 정상 부팅했다. 반복해서 죽던 게 한 번에 넘어가니 허무할 정도였는데, 원인이 메모리 하나가 아니라 파드 메모리와 볼륨 크기 두 개였다는 걸 늦게 안 게 이 삽질의 대부분이었다.

## 🔗 참고

- [KubeVirt user-guide — Clone API](https://kubevirt.io/user-guide/storage/clone_api/)
- [CDI — clone-datavolume](https://github.com/kubevirt/containerized-data-importer/blob/main/doc/clone-datavolume.md)
- [CDI — smart-clone](https://github.com/kubevirt/containerized-data-importer/blob/main/doc/smart-clone.md)
- [Configuring CDI for namespace resource quota (OKD)](https://docs.okd.io/latest/virt/storage/virt-configuring-cdi-for-namespace-resourcequota.html)
- [[kubevirt-setting|KubeVirt로 오프라인 테스트 환경 구성하기]]
- [[흩어진 KubeVirt·Multus 매니페스트를 기능별 단일 트리로 통합]]
