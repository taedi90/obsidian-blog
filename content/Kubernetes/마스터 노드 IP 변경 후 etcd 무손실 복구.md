---
title: 마스터 노드 IP가 통째로 바뀐 뒤 etcd 되살리기
date: 2026-01-26
draft: false
featured: true
tags:
  - kubernetes
  - etcd
  - kubeadm
  - troubleshooting
  - disaster-recovery
banner: 
cssclasses: 
description: 마스터 3대의 IP가 한꺼번에 바뀌어 etcd 부트스트랩이 깨진 상황을, 데이터를 살린 채 복구한 기록.
permalink: 
aliases: 
completed: true
type:
  - issue
---

## 요약

> [!SUMMARY]
> 마스터 3대의 IP가 한꺼번에 변경되면서 etcd 부트스트랩이 실패했다. 데이터를 유지한 채 `--force-new-cluster`로 단일 노드 etcd를 시작하여 스냅샷을 생성하고, 인증서 SAN·kubeconfig·static pod 매니페스트에 설정되어 있던 기존 IP를 신규 대역으로 교체한 뒤 스냅샷에서 복원하여 멀티마스터 구성을 무손실로 회복했다.

## 1. 환경

- Kubernetes: v1.30.5 (kubeadm)
- etcd: 3.5.15-0
- 마스터 노드 3대, 구 대역 `10.10.30.11~13` → 신 대역 `10.20.30.11~13`

## 2. 이슈

네트워크 대역을 옮기면서 마스터 3대의 IP가 한꺼번에 바뀌었다. 그리고 재부팅하자 클러스터가 올라오지 않았다.

원인은 etcd였다. etcd는 각 멤버의 피어 주소를 <b>자신의 데이터에 기록</b>해 둔다. IP가 변경되면 부팅한 etcd가 기억하고 있던 기존 피어 주소(`10.10.30.x`)로 계속 join을 시도하다 실패한다. 데이터는 정상적으로 디스크에 남아 있는데, 그 데이터가 가리키는 주소가 더 이상 존재하지 않으므로 클러스터가 스스로를 구성하지 못하는 상황이었다.

스냅샷 백업이 최신 상태가 아니었기 때문에, 복원으로 처리하면 그간 축적된 데이터를 잃는 상황이었다. 그러므로 해야 할 일은 분명했다. <b>디스크에 남아 있는 이 데이터를 삭제하지 않고 새 IP로 다시 구성하는 것.</b>

## 3. 해결

`etcdctl`의 `--force-new-cluster` 플래그가 해답이었다. 이름만 보면 "새 클러스터를 강제로 만든다"라고 데이터를 삭제할 것 같지만, 실제로는 <b>기존 데이터를 그대로 둔 채 멤버십 정보만 초기화</b>하여 현재 노드 하나만으로 클러스터를 다시 시작한다. 기존 피어를 찾아 시도하지 않고 단독으로 깨끗하게 부팅하는 것이다. IP가 변경되었을 때 정확히 필요한 동작이었다.

전체 흐름은 이렇게 잡았다.

1. 데이터를 살린 단일 노드 etcd에서 스냅샷을 뜬다.
2. 인증서·kubeconfig·매니페스트에 박힌 옛 IP를 전부 신규 IP로 교체한다.
3. 깨끗한 새 etcd에 스냅샷을 복원하고, 나머지 노드를 멤버로 붙인다.

### 1. 데이터를 살린 채 스냅샷 뜨기

먼저 전체 노드의 kubelet과 containerd를 중지하여 etcd/api-server가 자동으로 시작되지 않게 차단했다. 그다음 `/var/lib/etcd`와 `/etc/kubernetes/pki` 전체를 백업해 두었다. 복구 작업이 되돌리기 어려운 작업인 만큼, 롤백 수단은 최대한 확보해 두는 것이 안전하다.

그리고 마스터 한 대에서 데이터를 유지한 채 `--force-new-cluster`로 etcd를 시작한 뒤 스냅샷을 저장했다. 이 단계에서는 TLS를 설정하지 않아도 된다.

```bash
# 데이터(/var/lib/etcd)를 유지한 채 단일 노드로 etcd를 기동한 상태에서,
# 현재 시점의 스냅샷을 파일로 저장한다.
etcdctl snapshot save /home/kube/backup/snapshot.db
```

> [!NOTE]
> `--force-new-cluster`를 사용해도 데이터가 삭제되지 않는다는 점이 이 복구 방법의 핵심이다. 이 플래그는 "데이터는 유지하고, join 시도를 중단하고, 지금 이 노드만으로 새로 시작하라"는 의미로 이해하면 된다. IP가 변경되었거나 멤버십 정보가 불일치했을 때 유용하다.

### 2. 인증서 SAN과 설정 파일의 IP 교체

스냅샷을 확보했으니 이제 기존 IP를 제거할 차례다. 문제는 IP가 한 곳에만 설정되어 있는 것이 아니라는 점이다. 크게 세 곳을 수정해야 했다.

<b>첫째, 인증서 SAN.</b> `/etc/kubernetes/pki` 하위 인증서 중 일부는 SAN(Subject Alternative Name)에 마스터 IP를 포함하고 있다. 기존 IP가 포함된 인증서로는 새 IP로 들어오는 요청을 검증하지 못한다. 실제로 SAN을 확인해 보면 다음과 같이 IP가 혼재되어 있었다.

```text
# apiserver.crt
  DNS: k8s-master-02
  DNS: kubernetes, kubernetes.default, kubernetes.default.svc, kubernetes.default.svc.cluster.local
  IP: 10.96.0.1          # 기본 Service ClusterIP (건드리지 않음)
  IP: 10.10.30.12        # ← 옛 노드 IP, 교체 대상

# etcd/peer.crt, etcd/server.crt
  DNS: k8s-master-02, localhost
  IP: 10.10.30.12        # ← 옛 노드 IP, 교체 대상
  IP: 127.0.0.1, ::1     # 로컬 (건드리지 않음)
```

`apiserver-etcd-client.crt`, `healthcheck-client.crt`처럼 SAN이 없는 인증서는 수정할 필요가 없다. IP가 포함된 `apiserver.crt`, etcd의 `peer.crt`/`server.crt`만 신규 IP 목록으로 다시 발급했다. (`10.96.0.1`은 클러스터 기본 Service IP이므로 그대로 둔다.)

<b>둘째, kubeconfig.</b> `admin.conf`, `controller-manager.conf`, `scheduler.conf`, `super-admin.conf`, 그리고 각 노드의 `kubelet.conf`는 `server: https://<마스터IP>:6443`을 가리킨다. 이 주소도 신규 IP로 변경해야 한다. 미리 신규 IP로 준비해 둔 conf 파일들을 rsync로 덮어 썼다.

```bash
# 준비해둔 신규 IP용 .conf 파일들만 골라 현재 경로로 덮어쓴다.
rsync -avz --include='*.conf' --exclude='*' /home/kube/backup/kubernetes/ /etc/kubernetes/
```

<b>셋째, static pod 매니페스트.</b> `/etc/kubernetes/manifests` 하위 etcd/apiserver 매니페스트에도 `--advertise-address`나 etcd 피어 URL 형태로 IP가 포함된다. 여기에 기존 IP가 남아 있으면 kubelet이 다시 시작되는 순간 잘못된 주소로 컴포넌트를 구동한다. 그래서 작업 중에는 매니페스트 폴더를 `manifests.bak`으로 옮겨 두어 kubelet이 성급하게 파드를 시작하지 못하게 차단하고, IP를 모두 수정한 뒤 원래 위치로 되돌렸다.

### 3. 스냅샷 복원과 멤버 재구성

준비가 끝나면 마스터 한 대에서 데이터 없이 etcd를 시작하고, 앞서 생성한 스냅샷으로부터 복원한다.

```bash
# 빈 데이터 디렉토리에 스냅샷을 복원한다. (신규 IP 기준으로 피어 URL을 지정)
etcdctl snapshot restore /home/kube/backup/snapshot.db
```

첫 마스터가 스냅샷 데이터로 정상 기동하면, 나머지 2대는 데이터 없이 etcd를 시작하여 순서대로 멤버로 추가했다. 이후 kubelet을 다시 시작하고 매니페스트를 원래 위치로 되돌리면 컨트롤플레인이 신규 IP 위에서 다시 구성된다.

## 4. 확인

etcd 멤버 목록이 신규 IP로 정상적으로 등록되는지부터 확인했다.

```bash
# 현재 노드에서 실행 중인 etcd 컨테이너를 찾아 멤버 목록을 조회한다.
POD_ID=$(crictl ps 2>/dev/null | grep etcd | awk '{ print $1 }') && \
crictl exec ${POD_ID} etcdctl member list \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/healthcheck-client.crt \
  --key=/etc/kubernetes/pki/etcd/healthcheck-client.key
```

멤버 3개가 모두 신규 IP로 `started` 상태이고, `kubectl get nodes`가 응답하며 노드가 `Ready` 상태로 시작되면 복구가 완료된 것이다. 데이터도 그대로 유지되었다. 백업이 최신 상태가 아니었기 때문에, `--force-new-cluster`가 아니었다면 많은 데이터를 잃을 뻔했다.

## 참고

- [etcd Disaster recovery](https://etcd.io/docs/v3.5/op-guide/recovery/)
- [[k8s api-server 인증서에 SAN 추가하기]]
