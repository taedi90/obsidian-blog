---
title: K8s 2-Node 클러스터 고가용성(HA)·장애 복구(Failover) 구성하기
date: 2022-11-23
draft: false
tags:
  - kubernetes
  - ha
  - failover
  - longhorn
  - infrastructure
banner: 
cssclasses: 
description: 물리적 워커 2대 클러스터에서 노드 장애 시 서비스 중단을 최소화하려고 클러스터 상태 관리, 파드 스케줄링, 스토리지 설정을 최적화한 과정.
permalink: 
aliases:
completed: true
type:
  - note
---

## 1. 개요

프로젝트의 기본 요구사항 중 하나는 <b>서비스 이중화(HA)</b>였다. Kubernetes 클러스터의 노드 중 하나에 장애(Fail)가 발생하더라도 서비스는 정상 동작하거나, 다운타임이 발생하더라도 규정된 시간 안에 정상화가 가능한 시스템을 구축해야 했다.

하지만 주어진 제약사항이 명확했다. 바로 운영 환경의 <b>워커 노드가 단 2대</b>라는 점이다. 노드 하나만 다운되어도 전체 가용 자원의 50%가 사라진다. Ceph나 Mayastor처럼 기본적으로 3개 이상의 노드를 요구하는 분산 스토리지는 애초에 검토 대상에서 제외되었다.

이 제약 안에서 핵심 서비스(API, Frontend 등)의 고가용성을 어떻게 확보했는지, 장애 대응 시간을 단축하고 파드와 스토리지 설정을 최적화한 과정을 정리했다.

## 2. 클러스터 장애 감지 및 복구 시간 최적화

Kubernetes는 노드에 장애가 발생했을 때, 기본적으로 약 5~6분의 유예 시간을 둔 후 해당 노드의 파드를 제거하고 다른 노드에 재생성하기 시작한다. 이는 <b>최대 6분 이상의 서비스 다운타임</b>이 발생할 수 있음을 의미한다. 이 시간을 단축하기 위해 Kubelet, Kube-Controller-Manager, Kube-API-Server의 장애 감지 관련 파라미터를 조정했다.

![](https://i.imgur.com/aPVPxGQ.png)


-   <b>kubelet</b>: 각 노드에서 자신의 상태(Heartbeat)를 API 서버로 보고하는 역할
-   <b>Kube-Controller-Manager</b>: 노드 상태를 모니터링하다가 응답이 없으면 비정상(Unhealthy)으로 판단하고 파드 축출(Eviction)을 결정

아래는 다운타임을 약 30초 내외로 줄이기 위해 수정한 핵심 옵션들이다.

### 2-1. 옵션 명세

-   <b>kubelet</b>
    -   `--node-status-update-frequency=5s` (기본값 10s): 노드 상태 보고 주기. 짧을수록 장애를 빨리 전파할 수 있다.
-   <b>Kube-Controller-Manager</b>
    -   `--node-monitor-period=5s` (기본값 5s): 노드 상태 모니터링 주기.
    -   `--node-monitor-grace-period=20s` (기본값 40s): 노드 응답이 없을 때, Unhealthy 상태로 전환하기까지 대기하는 시간.
-   <b>Kube-API-Server</b>
    -   `--default-not-ready-toleration-seconds=5` (기본값 5m): NotReady 상태인 노드의 파드를 Toleration(용인)하는 시간.
    -   `--default-unreachable-toleration-seconds=5` (기본값 5m): Unreachable 상태인 노드의 파드를 Toleration하는 시간.

> [!IMPORTANT]
> 과거에는 `Kube-Controller-Manager`의 `--pod-eviction-timeout` 옵션을 사용했지만, 현재는 `Kube-API-Server`의 `TolerationSeconds` 관련 옵션으로 기능이 대체되었다.

### 2-2. 옵션 적용 방법

-   <b>Kube-API-Server 수정</b>
    마스터 노드의 `/etc/kubernetes/manifests/Kube-API-Server.yaml` 파일에 아래 내용을 추가한다.
    ```yaml
    # spec.containers.command 에 아래 옵션 추가
    - --enable-admission-plugins=DefaultTolerationSeconds
    - --default-not-ready-toleration-seconds=5
    - --default-unreachable-toleration-seconds=5
    ```
    이 설정은 Static Pod로 관리되므로, 파일을 저장하면 자동으로 반영된다.

-   <b>Kube-Controller-Manager 수정</b>
    마스터 노드의 `/etc/kubernetes/manifests/Kube-Controller-Manager.yaml` 파일에 아래 내용을 추가한다.
    ```yaml
    # spec.containers.command 에 아래 옵션 추가
    - --node-monitor-period=5s
    - --node-monitor-grace-period=20s
    ```

위 옵션들을 적용한 결과, 노드 다운 후 약 25~30초 내외로 파드 재생성이 시작되는 것을 확인했다.

## 3. 고가용성을 위한 파드(Pod) 설정

장애 복구 시간을 단축했더라도, 파드가 한 노드에 집중되어 있다면 해당 노드에 장애가 발생한 시점에 서비스는 중단된다. 따라서 고가용성이 필요한 파드는 반드시 2개 이상의 레플리카를 유지하고, 여러 노드에 분산 배포되도록 설정해야 한다.

### 3-1. 배포 방식

-   <b>DaemonSet 활용</b>: Ingress Controller나 CNI와 같이 모든 노드에 동일하게 배포되어야 하는 핵심 인프라 컴포넌트는 Deployment 대신 DaemonSet을 사용하여 안정성을 확보했다.
-   <b>Deployment 레플리카</b>: 일반 애플리케이션은 레플리카 수를 2개 이상으로 설정하여 하나의 파드가 중단되어도 다른 파드가 서비스를 이어갈 수 있도록 구성했다.

### 3-2. 스케줄링 최적화 (Pod Topology Spread)

레플리카를 2개로 설정해도 스케줄러가 두 파드를 모두 동일한 노드에 배치하면 고가용성 확보에 아무런 도움이 되지 않는다. 이를 방지하기 위해 <b>파드 토폴로지 분배 제약(Pod Topology Spread Constraints)</b>을 사용했다.

```yaml
# Pod Spec 에 추가
topologySpreadConstraints: 
    - maxSkew: 1
      topologyKey: "kubernetes.io/hostname"
      whenUnsatisfiable: DoNotSchedule
      labelSelector:
        matchLabels:
          app: my-app
```

위 설정은 `topologyKey`로 지정된 `kubernetes.io/hostname`(즉, 노드)을 기준으로, `labelSelector`에 해당하는 파드들이 <b>최대 1개(`maxSkew: 1`)까지만 차이 나도록</b> 분산 배포하라는 의미다. `whenUnsatisfiable` 조건을 `DoNotSchedule`로 설정하면, 조건을 만족시킬 수 없는 경우(예: 한쪽 노드 다운)에는 파드를 스케줄링하지 않고 대기시킨다. 이를 통해 장애 노드가 복구되었을 때 파드가 다시 분산 배치되도록 유도할 수 있었다.

### 3-3. StatefulSet 사용 지양

Kubernetes는 노드 장애가 발생해도 <b>StatefulSet</b>으로 생성된 파드를 자동으로 다른 노드로 옮기지 않는다. 이는 StatefulSet의 핵심 특징인 `순서성`과 `고유성`을 보장하기 위함이다. 즉, `app-1`이라는 파드는 클러스터 내에 단 하나만 존재해야 하므로, 노드 장애로 `app-1`이 응답 불가(Unknown) 상태가 되어도 컨트롤러는 이를 임의로 삭제하지 않고 다른 노드에 새로 생성하지도 않는다.

이러한 특성은 RDB와 같이 데이터의 순서와 고유성이 반드시 보장되어야 하는 극히 일부 경우를 제외하면, 일반적인 애플리케이션의 고가용성을 심각하게 저해하는 요인이 된다고 판단했다. 따라서 대부분의 Stateful 애플리케이션은 <b>Deployment와 PVC(PersistentVolumeClaim)를 조합</b>하는 방식으로 전환했다.

## 4. 스토리지(Storage) 고가용성 확보

워커 노드가 2대인 환경에서 안정적으로 동작하는 스토리지 솔루션을 찾는 것이 가장 큰 과제였다. 여러 솔루션을 검토한 끝에 아래와 같은 이유로 <b>Longhorn</b>을 채택했다.

-   2개 노드만으로도 복제본 구성 및 HA 기능 사용 가능
-   CNCF Incubating 프로젝트로 검증된 기술
-   스냅샷, 백업 등 필수 기능 및 편리한 UI 제공

### 4-1. Longhorn 설정

Longhorn 사용 시 노드 장애 상황에서 한 가지 문제가 발생했다. 장애 노드의 파드가 완전히 제거되기 전까지 해당 파드에 마운트된 볼륨이 해제(detach)되지 않아, 다른 노드에서 새로 생성된 파드가 볼륨을 즉시 사용할 수 없는 현상이 있었다. 이는 위에서 설정한 파드 축출 시간(약 30초)과 별개로, 스토리지 레벨에서 발생하는 병목이었다.

이 문제는 Longhorn의 `Node Down Pod Deletion Policy` 설정을 통해 해결했다.

```yaml
# Longhorn UI > Setting > General
# Node Down Pod Deletion Policy: delete-statefulset-pod (or delete-deployment-pod)
```

이 옵션은 노드 다운이 감지되었을 때, Longhorn 컨트롤러가 직접 Kubernetes API를 호출하여 해당 노드의 StatefulSet(또는 Deployment) 파드를 강제로 제거하도록 하는 기능이다. 이를 통해 볼륨이 즉시 detach되고, 다른 노드의 새 파드가 바로 attach하여 사용할 수 있게 되었다.

> [!important]
> 하지만 최종적으로는 클러스터 외부의 NFS 스토리지를 `local-path-provisioner`로 구성했다. 이유는 워커 노드 2대가 순차적으로 또는 동시에 장애 상태가 된 이후에 데이터가 crash 상태에 빠지거나 복구하는 데 큰 시간이 소요되어 PVC 정상화가 지연되었기 때문이다.

## 5. 결론 및 고찰

-   <b>장애 감지 시간 단축이 핵심</b>: 2-Node 클러스터에서 Kubernetes의 기본 장애 감지 시간(5~6분)은 너무 길었다. 클러스터 파라미터 조정을 통해 이를 30초 내외로 단축하는 것이 고가용성 확보의 첫걸음이었다.
-   <b>분산 배포는 필수</b>: `topologySpreadConstraints`와 같은 스케줄링 정책을 적극적으로 활용하여 파드가 특정 노드에 편중되지 않도록 강제하는 것이 중요하다.
-   <b>StatefulSet은 신중하게</b>: `StatefulSet`은 장애 복구 시 수동 개입이 필요한 경우가 많아 고가용성에 불리하다. 정말 필요한 경우가 아니라면 `Deployment`와 `PVC` 조합으로 대체하는 것이 바람직하다고 판단했다.
-   <b>스토리지의 특성 이해</b>: 분산 스토리지는 각 솔루션마다 노드 장애 시 동작 방식이 다르다. Longhorn의 `Node Down Pod Deletion Policy`처럼, 사용하는 스토리지의 HA 관련 설정을 반드시 확인하고 테스트해야 한다.

물리적으로 제한된 환경이었지만, Kubernetes가 제공하는 다양한 설정과 오픈소스 솔루션을 조합하여 요구사항에 부합하는 고가용성 환경을 구축할 수 있었다. 이 과정을 통해 Kubernetes의 내부 동작 원리를 더 깊이 이해하는 계기가 되었다.

## 6. 참고
-   [Kubernetes Docs: Pod Topology Spread Constraints](https://kubernetes.io/docs/concepts/workloads/pods/pod-topology-spread-constraints/)
-   [Kubernetes Docs: Force Delete StatefulSet Pods](https://kubernetes.io/docs/tasks/run-application/force-delete-stateful-set-pod/)
-   [Longhorn Docs: Node Failure](https://longhorn.io/docs/1.3.2/high-availability/node-failure/)
