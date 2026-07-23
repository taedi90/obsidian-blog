---
title: CSI 구현체 선정
date: 2025-04-03
draft: false
aliases:
tags:
  - Kubernetes
  - CSI
  - Storage
  - Longhorn
  - NFS
  - Ceph
  - Comparison
description: Longhorn을 주력으로, nfs-subdir-provisioner를 보조로. Rook-Ceph는 왜 접었나.
type:
  - comparison
---

## 🚀 요약
> [!SUMMARY]
> 클러스터의 CSI로 <b>Longhorn</b>을 주력, <b>nfs-subdir-provisioner</b>를 보조로 채택했다. 관리 용이성과 안정적인 성능이 기준이었다. Rook-Ceph는 기능은 가장 강력했지만 운영 복잡성과 성능 튜닝 부담 때문에 접었다.

## 💡 개요
쿠버네티스에서 데이터를 지키려면 <b>영구 볼륨(Persistent Volume)</b>을 대 줄 스토리지가 있어야 한다. 후보로 놓은 <b>CSI(Container Storage Interface)</b> 구현체들을 비교하고, 우리 클러스터에 뭐가 맞는지 골라낸 과정을 정리했다.

## 📋 선정 배경
스토리지는 한 번 잘못 고르면 두고두고 발목을 잡는 영역이라, 기준을 좀 깐깐하게 잡았다.

- <b>고가용성(HA)·장애 복구</b>: 스토리지 하나 죽었다고 전체 서비스가 멈추면 안 된다. HA 구성이 되는가?
- <b>관리 용이성</b>: 설정과 유지보수가 간결한가? (여기가 사실 제일 중요했다)
- <b>성능</b>: 읽기/쓰기 성능이 애플리케이션 요구를 감당하는가?
- <b>백업·복구</b>: 백업/복구를 자체 제공하거나 쉽게 붙일 수 있는가?
- <b>트러블슈팅</b>: 장애 시 PV 내부 파일에 접근해 문제를 풀 수 있는가?
- <b>커뮤니티</b>: 막혔을 때 참고할 문서·사례가 있는가?

## 📊 비교
최종 비교군은 `Longhorn`, `nfs-subdir-provisioner`, `Rook-Ceph` 셋이다. 사실 조사 초반엔 OpenEBS, GlusterFS, Mayastor까지 손을 댔다. Mayastor는 NVMe에 최적화된 물건이라 HDD 기반인 우리 클러스터와 애초에 궁합이 안 맞았고, 나머지도 초기 설정에서 기대만큼의 경험을 못 줘 비교군에서 빠졌다.

> [!NOTE]
> `nfs-subdir-provisioner`는 엄밀히는 CSI 드라이버가 아니다. 그래도 동적 프로비저닝이 되고 경량 환경의 파일 스토리지로 널리 쓰여서 비교군에 넣었다.

| 구분 | <b>Longhorn</b> | nfs-subdir-provisioner | Rook-Ceph |
| :--- | :--- | :--- | :--- |
| 스토리지 타입 | 블록(Block), 파일 (ReadWriteOnce) | 파일(File) (ReadWriteMany) | 블록, 파일, 오브젝트 |
| 장점 | GUI 대시보드, 직관적 백업/스냅샷, 경량, 설치 용이 | 설정이 매우 간단, 기존 NFS 서버 활용 가능 | 기능이 풍부(HA·스냅샷·복제), 대규모에 적합, 높은 확장성 |
| 단점 | 일부 기능 아직 불안정하다는 평, ReadWriteMany 제한적 | NFS 서버가 <b>단일 장애점(SPOF)</b>, 성능이 NFS 서버에 종속 | 아키텍처가 복잡·무거움, 운영 난이도 높음, 쓰기 성능이 낮음(테스트 기준) |

### 벤치마크: 복제본 수에 따른 쓰기 속도
말로만 "성능이 어떻다" 하기엔 근거가 약해서, 간단히 쓰기 속도를 재 봤다.

- <b>환경</b>: 1Gbps 네트워크, 7200rpm HDD
- <b>명령어</b>: `dd if=/dev/zero of=1GB_test_file bs=1M count=1024 oflag=direct`
- <b>조건</b>: 스토리지와 Pod가 서로 다른 노드에 위치

| 구분 | Local | NFS (async) | Rook-Ceph | Longhorn |
| :--- | :--- | :--- | :--- | :--- |
| 복제본 1개 | 200MB/s | 99MB/s | 23MB/s | 57.4MB/s |
| 복제본 2개 | - | - | 15MB/s | 40MB/s |
| 복제본 3개 | - | - | 12MB/s | 30MB/s |

숫자가 꽤 정직하게 나왔다. Rook-Ceph는 복제본을 늘릴수록 안정성은 올라가지만 쓰기 속도가 Longhorn보다 눈에 띄게 낮았다. Ceph 성능을 끌어올리는 튜닝이 불가능한 건 아니지만, 그걸 제대로 하려면 시간과 전문 지식이 상당히 든다는 게 문제였다.

## ✅ 선정 사유
비교와 벤치마크를 종합해 이렇게 정리했다.

- <b>Longhorn (주력)</b>: 관리 용이성과 경량 아키텍처라는 핵심 기준을 잘 맞췄다. GUI 대시보드로 백업·스냅샷·복제본 관리를 직관적으로 할 수 있었고, 테스트에서 Rook-Ceph보다 쓰기 성능도 나았다. 그래서 블록 스토리지가 필요한 `Stateful` 애플리케이션의 기본 솔루션으로 앉혔다.
- <b>nfs-subdir-provisioner (보조)</b>: `ReadWriteMany`가 필요하고 성능은 크게 안 따지는 경우에 맞았다. 설정이 워낙 간단해 빠르게 붙일 수 있다. NFS 서버 가용성은 따로 챙겨야 하는 숙제가 남지만, 보조 파일 스토리지로는 값어치가 충분했다.

Rook-Ceph는 기능만 보면 셋 중 가장 풍부했다. 하지만 지금 클러스터 규모와 운영 인력을 놓고 보면, 도입과 유지보수 비용이 감당할 선을 넘었다. 특히 성능을 살리려면 전문 지식과 시간이 추가로 든다는 점이 결정적인 부담이었다. 좋은 도구인 건 알지만, 지금 우리한테 맞는 도구는 아니었다.

## 🔗 참고
- [Longhorn 공식 문서](https://longhorn.io/docs/)
- [nfs-subdir-external-provisioner Github](https://github.com/kubernetes-sigs/nfs-subdir-external-provisioner)
- [Rook-Ceph 공식 문서](https://rook.io/docs/rook/latest/Getting-Started/quickstart/)
