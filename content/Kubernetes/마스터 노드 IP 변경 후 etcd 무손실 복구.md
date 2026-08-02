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
> 마스터 3대의 IP가 통째로 바뀌면서 etcd가 부트스트랩에 실패했다. 데이터를 유지한 채 `--force-new-cluster`로 단일 노드 etcd를 띄워 스냅샷을 뜨고, 인증서 SAN·kubeconfig·static pod 매니페스트에 박혀 있던 옛 IP를 신규 대역으로 교체한 뒤 스냅샷에서 복원해 멀티마스터를 무손실로 되살렸다.

## 1. 환경

- Kubernetes: v1.30.5 (kubeadm)
- etcd: 3.5.15-0
- 마스터 노드 3대, 구 대역 `10.10.30.11~13` → 신 대역 `10.20.30.11~13`

## 2. 이슈

네트워크 대역을 옮기면서 마스터 3대의 IP가 한꺼번에 바뀌었다. 그리고 재부팅하자 클러스터가 올라오지 않았다.

원인은 etcd였다. etcd는 각 멤버의 피어 주소를 <b>자기 데이터에 기억</b>하고 있다. IP가 바뀌면 부팅한 etcd가 기억하고 있던 옛 피어 주소(`10.10.30.x`)로 계속 join을 시도하다 실패한다. 데이터는 멀쩡히 디스크에 남아 있는데, 그 데이터가 가리키는 주소가 이 세상에 더는 없으니 클러스터가 스스로를 조립하지 못하는 상황이었다.

스냅샷 백업이 최신이 아니라, 복원으로 때우면 그간 쌓인 데이터를 잃는 상황이었다. 그러니 할 일은 분명했다. <b>디스크에 살아있는 이 데이터를 지우지 않고 새 IP로 다시 세우는 것.</b>

## 3. 해결

`etcdctl`의 `--force-new-cluster` 플래그였다. 이름만 보면 "새 클러스터를 강제로 만든다"라 데이터를 밀어버릴 것 같지만, 실제로는 <b>기존 데이터는 그대로 둔 채 멤버십 정보만 리셋</b>해서 현재 노드 하나만으로 클러스터를 다시 시작한다. 옛 피어를 찾아 헤매지 않고 혼자 깨끗하게 부팅하는 것이다. IP가 바뀌었을 때 딱 필요한 동작이었다.

전체 흐름은 이렇게 잡았다.

1. 데이터를 살린 단일 노드 etcd에서 스냅샷을 뜬다.
2. 인증서·kubeconfig·매니페스트에 박힌 옛 IP를 전부 신규 IP로 교체한다.
3. 깨끗한 새 etcd에 스냅샷을 복원하고, 나머지 노드를 멤버로 붙인다.

### 1. 데이터를 살린 채 스냅샷 뜨기

먼저 전체 노드의 kubelet과 containerd를 내려 etcd/api-server가 자동으로 뜨지 않게 막았다. 그다음 `/var/lib/etcd`와 `/etc/kubernetes/pki`를 통째로 백업해뒀다. 어차피 되돌릴 수 없는 작업이라, 되돌릴 구석은 최대한 만들어두는 게 마음이 편하다.

그리고 마스터 한 대에서 데이터를 유지한 채 `--force-new-cluster`로 etcd를 띄운 뒤 스냅샷을 저장했다. 이 단계에서는 TLS를 설정하지 않아도 된다.

```bash
# 데이터(/var/lib/etcd)를 유지한 채 단일 노드로 etcd를 기동한 상태에서,
# 현재 시점의 스냅샷을 파일로 저장한다.
etcdctl snapshot save /home/kube/backup/snapshot.db
```

> [!NOTE]
> `--force-new-cluster`를 써도 데이터가 지워지지 않는다는 게 이 복구의 전부다. 이 플래그는 "데이터는 두고, join 시도를 멈추고, 지금 이 노드만으로 새로 시작하라"는 뜻으로 이해하면 된다. IP가 바뀌었거나 멤버십이 꼬였을 때 유용하다.

### 2. 인증서 SAN과 설정 파일의 IP 교체

스냅샷을 확보했으니 이제 옛 IP를 걷어낼 차례다. 문제는 IP가 한 군데만 박혀 있는 게 아니라는 점이다. 크게 세 곳을 손봐야 했다.

<b>첫째, 인증서 SAN.</b> `/etc/kubernetes/pki` 하위 인증서 중 몇 개는 SAN(Subject Alternative Name)에 마스터 IP를 담고 있다. 옛 IP가 박힌 인증서로는 새 IP로 들어오는 요청을 검증하지 못한다. 실제로 SAN을 확인해보면 이렇게 IP가 섞여 있었다.

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

`apiserver-etcd-client.crt`, `healthcheck-client.crt`처럼 SAN이 없는 인증서는 손댈 필요가 없다. IP가 박힌 `apiserver.crt`, etcd의 `peer.crt`/`server.crt`만 신규 IP 목록으로 다시 발급했다. (`10.96.0.1`은 클러스터 기본 Service IP라 그대로 둔다.)

<b>둘째, kubeconfig.</b> `admin.conf`, `controller-manager.conf`, `scheduler.conf`, `super-admin.conf`, 그리고 각 노드의 `kubelet.conf`는 `server: https://<마스터IP>:6443`을 가리킨다. 이 주소도 신규 IP로 바꿔야 한다. 미리 신규 IP로 만들어둔 conf들을 rsync로 덮었다.

```bash
# 준비해둔 신규 IP용 .conf 파일들만 골라 현재 경로로 덮어쓴다.
rsync -avz --include='*.conf' --exclude='*' /home/kube/backup/kubernetes/ /etc/kubernetes/
```

<b>셋째, static pod 매니페스트.</b> `/etc/kubernetes/manifests` 하위 etcd/apiserver 매니페스트에도 `--advertise-address`나 etcd 피어 URL 형태로 IP가 들어간다. 여기가 옛 IP면 kubelet이 다시 깨어나는 순간 잘못된 주소로 컴포넌트를 띄운다. 그래서 작업 중에는 매니페스트 폴더를 아예 `manifests.bak`으로 빼두어 kubelet이 성급하게 파드를 띄우지 못하게 막고, IP를 다 고친 뒤 원위치시켰다.

### 3. 스냅샷 복원과 멤버 재구성

준비가 끝나면 마스터 한 대에서 데이터 없이 etcd를 띄우고, 아까 뜬 스냅샷으로부터 복원한다.

```bash
# 빈 데이터 디렉토리에 스냅샷을 복원한다. (신규 IP 기준으로 피어 URL을 지정)
etcdctl snapshot restore /home/kube/backup/snapshot.db
```

첫 마스터가 스냅샷 데이터로 정상 기동하면, 나머지 2대는 데이터 없이 etcd를 띄워 순서대로 멤버로 추가했다. 이후 kubelet을 다시 올리고 매니페스트를 원복하면 컨트롤플레인이 신규 IP 위에서 다시 조립된다.

## 4. 확인

etcd 멤버 목록이 신규 IP로 정상적으로 잡히는지부터 봤다.

```bash
# 현재 노드에서 실행 중인 etcd 컨테이너를 찾아 멤버 목록을 조회한다.
POD_ID=$(crictl ps 2>/dev/null | grep etcd | awk '{ print $1 }') && \
crictl exec ${POD_ID} etcdctl member list \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/healthcheck-client.crt \
  --key=/etc/kubernetes/pki/etcd/healthcheck-client.key
```

멤버 3개가 모두 신규 IP로 `started` 상태이고, `kubectl get nodes`가 응답하며 노드가 `Ready`로 올라오면 복구가 끝난 것이다. 데이터도 그대로였다. 백업이 최신이 아니었으니, `--force-new-cluster`가 아니었다면 꽤 많은 걸 잃을 뻔했다.

## 참고

- [etcd Disaster recovery](https://etcd.io/docs/v3.5/op-guide/recovery/)
- [[k8s api-server 인증서에 SAN 추가하기]]
