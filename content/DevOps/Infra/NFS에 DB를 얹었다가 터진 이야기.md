---
title: NFS에 DB를 얹었다가 터진 이야기
date: 2026-01-26
draft: false
featured: true
tags:
  - nfs
  - storage
  - kubernetes
  - linux
  - io-bottleneck
  - troubleshooting
banner: 
cssclasses: 
description: NFS 한 곳에 DB 볼륨을 몰아 넣었다가 I/O가 밀린 문제를, 계층적으로 원인을 좁혀 진단하고 스토리지를 용도별로 분리한 기록.
permalink: 
aliases: 
completed: true
type:
  - issue
---

## 🚀 요약

> [!SUMMARY]
> NFS 한 곳에 DB 파드들의 볼륨을 전부 몰아 넣었더니 I/O가 밀리기 시작했다. `df -i`부터 `lsof`, `vmstat`/`sar`, `dmesg`, `nfsstat`까지 계층적으로 좁혀 다수 DB 볼륨의 동시 쓰기가 원인임을 확인했고, 급한 불은 캐시 정리와 `dirty_ratio` 튜닝으로 껐다. 근본 대책은 DB 데이터는 로컬 SSD로, NFS는 공유 파일과 백업 전용으로 <b>스토리지를 용도별로 분리</b>하는 것이었다.

## ⚙️ 환경

- Kubernetes 클러스터 (kubeadm 기반), CNI는 Cilium
- 스토리지: NFS 노드 1대에 `nfs-subdir-external-provisioner`로 동적 프로비저닝
- NFS 서버: ext4 on LVM (`/dev/mapper/vg_nfs-lv_data` → `/data/nfs`)
- 워크로드: MariaDB, Elasticsearch, Redis, RabbitMQ 등 operator로 올린 상태풀(StatefulSet) 다수

## 💬 이슈

어느 순간부터 클러스터에 올린 DB 파드들이 느려졌다. 쿼리가 간헐적으로 늘어지고, 백업 잡이 돌 때는 다른 서비스까지 같이 버벅였다. 처음엔 특정 파드 문제인 줄 알았는데, NFS 노드에 붙어 `uptime`을 쳐보니 로드 애버리지가 20을 넘고 있었다. 코어 수를 한참 웃도는 값이라 이건 파드 하나의 문제가 아니었다.

사실 구성할 때부터 편하자고 스토리지클래스를 하나로 통일해뒀다. NAS 하나 잡아서 `nfs-subdir-external-provisioner` 물리면 파드가 뭘 요구하든 알아서 서브디렉토리 파주니 편했다. 그런데 그 "뭘 요구하든"에 DB 데이터 디렉토리까지 통째로 들어가 있었다는 게 문제였다. MariaDB의 데이터 파일도, Elasticsearch 인덱스도, 전부 네트워크 너머 NFS에 쓰고 있었다.

증상은 봤으니 원인을 찾아야 하는데, "NFS가 느리다"는 심증만으로는 손을 못 댄다. 디스크가 찬 건지, 파일 디스크립터가 샌 건지, 커널 레벨에서 뭐가 막힌 건지, 아니면 진짜 NFS 워크로드 자체가 과한 건지 — 층을 하나씩 걷어내며 확인하기로 했다.

## 🧗 해결

### 1. 계층적으로 원인 좁히기

무작정 튜닝부터 하고 싶은 유혹이 있는데(그러다 애먼 데 시간 버린 적이 많다), 위쪽 계층부터 하나씩 배제하는 게 결국 빨랐다.

먼저 <b>용량과 inode</b>부터 봤다. ext4는 inode가 고갈되면 공간이 남아도 쓰기가 실패한다.

```bash
# 블록 용량이 아니라 inode 소진 여부를 확인한다.
df -i /data/nfs
```

inode도 블록도 여유가 있었다. 용량 문제는 아니었다.

다음은 <b>파일 디스크립터</b>. 어딘가에서 fd를 안 닫고 새고 있으면 이런 증상이 난다.

```bash
# NFS 경로에 열린 파일 수와 시스템 전체 fd 사용량을 본다.
lsof | grep "/data/nfs" | wc -l
cat /proc/sys/fs/file-nr
```

fd도 정상 범위였다. 여기까지 오면 "리소스가 새는" 종류의 문제는 아니라는 게 정리된다.

그럼 실제로 뭐가 시스템을 붙잡고 있는지 볼 차례다. `vmstat`과 `sar`로 CPU가 어디서 시간을 쓰는지 봤다.

```bash
# CPU가 I/O 대기에 얼마나 묶여 있는지, 블록된 프로세스가 있는지 본다.
sar -u 1 3
vmstat 1 3
```

여기서 그림이 나왔다. CPU wait(`wa`)가 11~13%로 붙어 있고, `vmstat`의 `b`(uninterruptible sleep, 대개 I/O 대기) 컬럼에 프로세스가 잡혔다. CPU가 놀고 싶어서 노는 게 아니라 디스크 응답을 기다리며 묶여 있다는 뜻이다. 로드 애버리지가 높았던 것도 이 대기 프로세스들이 큐에 쌓여서였다.

마지막으로 커널이 직접 남긴 흔적을 봤다.

```bash
# 커널 링버퍼에서 ext4/스토리지 관련 경고를 훑는다.
dmesg -T | grep -i "ext4\|disk\|storage" | tail
```

커널 로그에 `ext4_buffered_write_iter`가 블로킹되는 흔적이 반복해서 찍혀 있었다. 버퍼링된 쓰기가 하위 디스크 I/O를 기다리다 계속 막히고 있다는 신호다. 파일시스템이 손상된 건 아닌지 `tune2fs -l`로 상태도 봤는데 `clean`이었다. 디스크가 고장난 게 아니라, 그냥 <b>감당할 수 있는 것보다 많은 쓰기가 몰리고 있었다</b>.

마지막 조각은 `nfsstat`이었다.

```bash
# NFS 서버가 받은 호출 통계와 현재 연결 수를 본다.
nfsstat -s | grep -A1 "calls"
ss -an | grep :2049 | wc -l
```

여러 개의 DB 볼륨이 동시에 NFS로 쓰기를 때리고 있었다. 여기서 원인이 분명해졌다. DB는 랜덤 I/O에 잦은 fsync를 요구하는 대표적인 쓰기 집약 워크로드인데, NFS는 태생이 네트워크 파일 공유다. 대용량 파일을 순차로 읽고 쓰거나 여러 클라이언트가 문서를 공유하는 데는 훌륭하지만, DB 데이터 디렉토리를 얹을 물건은 아니었다. 그걸 여러 개 얹었으니 네트워크 스토리지가 못 버틴 것이다.

> [!NOTE]
> 계층적으로 좁힌다는 게 거창한 방법론은 아니다. "용량 → fd → CPU/IO 대기 → 커널 로그 → 워크로드"처럼 위에서부터 하나씩 배제하면, 마지막에 남는 게 원인이다. NFS가 느린 게 아니라 NFS에 얹으면 안 되는 걸 얹었을 뿐이라는 걸, 추측이 아니라 배제로 확인했다.

### 2. 응급조치

원인은 알았지만 스토리지 아키텍처를 당장 갈아엎을 수는 없다. 우선 서비스가 죽지 않게 급한 불부터 껐다.

```bash
# 페이지 캐시/덴트리/inode 캐시를 비워 메모리 압박을 즉시 완화한다. (일시적 조치)
echo 3 | sudo tee /proc/sys/vm/drop_caches

# 더티 페이지가 쌓여 한 번에 몰려 나가지 않도록 임계치를 낮춘다.
sudo sysctl -w vm.dirty_ratio=5
sudo sysctl -w vm.dirty_background_ratio=2
```

`dirty_ratio`를 낮춘 건, 기본값(보통 20% 안팎)에서는 더티 페이지가 크게 쌓였다가 한꺼번에 디스크로 쏟아지면서 그 순간 I/O가 폭발하기 때문이다. 임계치를 낮추면 조금씩 자주 흘려보내는 대신 순간 폭주를 줄인다. 근본 해결은 아니고 파도를 잘게 쪼개는 정도의 완화책이다.

효과는 있었다. 로드가 20대에서 한 자릿수로 내려왔다. 다만 이건 시간을 버는 조치지 답이 아니라는 걸 알고 있었다. DB 쓰기가 네트워크 너머로 나가는 구조 자체는 그대로였으니까.

### 3. 스토리지 용도 분리

결국 손봐야 할 건 스토리지클래스를 하나로 통일해둔 설계였다. 편하려고 만든 단일 창구가 병목의 원인이었다. 그래서 용도에 따라 스토리지를 나눴다.

- <b>DB 데이터</b>: 랜덤 I/O와 fsync가 잦으니 네트워크를 태우면 안 된다. 노드 로컬 디스크(SSD)를 쓰는 스토리지클래스로 옮긴다. 로컬 경로를 그대로 붙이는 `local-path-provisioner`, 또는 복제·스냅샷이 필요하면 Longhorn 같은 분산 블록 스토리지를 쓴다.
- <b>NFS</b>: 원래 잘하는 일만 맡긴다. 여러 파드가 함께 읽는 공유 파일, 모델·정적 콘텐츠, 백업 아카이브.

```text
# 변경 전 — 편하지만 병목
모든 볼륨  →  NFS

# 변경 후 — 용도별 분리
DB 데이터   →  로컬 SSD (local-path / Longhorn)
공유 파일   →  NFS
백업        →  NFS
```

DB StatefulSet의 볼륨클레임 스토리지클래스를 로컬 기반으로 바꾸고 데이터를 옮기는 것이 근본 대책이다. 로컬 디스크에 노드가 묶이는 스케줄링 제약이 생기지만, DB처럼 상태를 가진 워크로드는 어차피 아무 노드로나 떠도는 게 좋은 물건이 아니라 큰 제약은 아니다.

우선 NFS 노드에는 taint를 걸어 DB나 다른 파드가 다시 끼어들지 못하게 막고, 공유·백업 용도로만 남겼다. 네트워크 버퍼와 NFS 스레드 수를 연결량에 맞춰 조정해두긴 했는데, 근본은 어디까지나 "DB를 NFS에서 빼는 것"이다. 튜닝으로 될 문제였으면 애초에 여기까지 오지도 않았다.

## ✅ 확인

NFS 노드에서 DB 워크로드를 걷어내고 노드를 정리한 뒤 다시 상태를 봤다.

```bash
# 로드와 NFS 연결 수를 다시 확인한다.
uptime
ss -an | grep :2049 | wc -l
```

응급조치로 20대까지 치솟던 로드가 6점대로 내려왔고, NFS 노드를 정리하고 나서는 2점대까지 안정됐다. NFS 연결 수도 함께 줄었다.

편하자고 스토리지를 하나로 통일해둔 게 화근이었다. 워크로드마다 맞는 스토리지가 따로 있다는 걸, DB한테 NFS를 쥐여주고 나서야 확인했다.

## 🔗 참고

- [nfs(5) — NFS 마운트 옵션 man page](https://man7.org/linux/man-pages/man5/nfs.5.html)
- [Linux VM sysctl (dirty_ratio 등) 커널 문서](https://docs.kernel.org/admin-guide/sysctl/vm.html)
- [Longhorn 문서](https://longhorn.io/docs/)
- [Configuring Linux for MariaDB](https://mariadb.com/kb/en/configuring-linux-for-mariadb/)
- [[NFS 쓰기 병목 잡기 - sync→async 전환과 nfsd·마운트 옵션 튜닝|NFS를 그대로 두고 쓰기 병목을 튜닝한 후속]]
- [[Disk Pressure 대응과 NFS 경로 이전 자동화]]
