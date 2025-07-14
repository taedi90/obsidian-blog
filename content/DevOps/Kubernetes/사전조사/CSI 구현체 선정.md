---
title: CSI 구현체 선정
date: 2025-07-10
draft: false
tags:
  - Kubernetes
  - CSI
  - Storage
  - Longhorn
  - NFS
  - Ceph
  - Comparison
description: 쿠버네티스 클러스터의 Container Storage Interface(CSI) 구현체로 Longhorn과 nfs-subdir-provisioner를 선정한 과정과 배경을 다룬다.
type:
  - comparison
---

## 🚀 요약
> [!SUMMARY]
> 관리 용이성과 안정적인 성능을 기준으로 여러 CSI를 비교한 결과, <b>Longhorn</b>을 주력으로 활용하고 보조로 <b>nfs-subdir-provisioner</b>를 채택했다. Rook-Ceph는 기능은 강력하지만 운영 복잡성과 성능 튜닝 문제로 선택하지 못했다.

## 💡 개요
쿠버네티스 환경에서 애플리케이션의 데이터를 보존하기 위해서는 <b>영구 볼륨(Persistent Volume)</b>을 제공하는 스토리지 솔루션이 필수적이다. 이 문서는 주요 <b>컨테이너 스토리지 인터페이스(Container Storage Interface, CSI)</b> 구현체 후보들을 비교하고, 내부 클러스터 환경에 가장 적합한 솔루션을 선정하는 과정을 기록한다.

## 📋 선정 배경
CSI 구현체를 선정하기 위해 다음과 같은 기준을 고려했다. 이 기준들은 클러스터의 안정성, 운영 효율성, 그리고 확장성을 보장하기 위해 설정되었다.

- <b>고가용성(High Availability, HA) 및 장애 복구(Failover)</b>: 스토리지 시스템 자체의 장애가 전체 서비스 중단으로 이어지지 않도록 고가용성 구성이 가능한가?
- <b>관리 용이성</b>: 설정이나 유지보수가 간결하고 직관적인가?
- <b>성능</b>: 읽기/쓰기 성능이 애플리케이션 요구사항을 충족하는가?
- <b>백업 및 복구</b>: 데이터 백업 및 복구 솔루션을 제공하거나 쉽게 연동할 수 있는가?
- <b>트러블슈팅 편의성</b>: 장애 발생 시 PV 내부 파일에 쉽게 접근하고 문제를 해결할 수 있는가?
- <b>커뮤니티 활성도</b>: 관련 문서나 이슈 해결 사례를 찾기 용이한가?

## 📊 비교
이 문서에서 최종적으로 비교하는 후보는 `Longhorn`, `nfs-subdir-provisioner`, `Rook-Ceph` 세 가지이다. 실제 조사 과정에서는 <b>OpenEBS</b>, <b>GlusterFS</b>, <b>Mayastor</b> 등 다양한 CSI 구현체를 검토하고 테스트했다. 하지만 <b>Mayastor</b>는 NVMe 환경에 최적화되어 있어 우리의 HDD 기반 클러스터와는 맞지 않았고, 다른 솔루션은 초기 설정 과정에서 좋은 경험을 제공받지 못해 최종 비교군에서 제외했다.

> [!NOTE]
> `nfs-subdir-provisioner`는 엄밀히 말해 CSI 드라이버는 아니지만, 동적 프로비저닝을 지원하며 경량 환경에서 파일 스토리지로 많이 사용되므로 비교군에 포함했다.

| 구분 | <b>Longhorn</b> | <b>nfs-subdir-provisioner</b> | <b>Rook-Ceph</b> |
| :--- | :--- | :--- | :--- |
| <b>스토리지 타입</b> | <b>블록(Block)</b>, 파일 (ReadWriteOnce) | <b>파일(File)</b> (ReadWriteMany) | <b>블록(Block)</b>, <b>파일(File)</b>, <b>오브젝트(Object)</b> |
| <b>장점</b> | - GUI 대시보드 제공<br>- 직관적인 백업/스냅샷<br>- 경량 아키텍처<br>- 설치 및 설정 용이 | - 설정이 매우 간단함<br>- 기존 NFS 서버 활용 가능 | - 기능이 매우 풍부함 (HA, 스냅샷, 복제 등)<br>- 대규모 환경에 적합<br>- 높은 확장성 |
| <b>단점</b> | - 일부 기능은 아직 불안정하다는 평가<br>- ReadWriteMany 지원 제한적 | - NFS 서버가 <b>단일 장애점(SPOF)</b>이 될 수 있음<br>- 성능이 NFS 서버에 종속됨 | - 아키텍처가 복잡하고 무거움<br>- 초기 설정 및 운영 난이도 높음<br>- 상대적으로 낮은 쓰기 성능 (테스트 환경 기준) |

### 벤치마크: 복제본 수에 따른 쓰기 속도
성능 비교를 위해 간단한 쓰기 속도 벤치마크를 진행했다.

- <b>테스트 환경</b>: 1Gbps 네트워크, 7200rpm HDD
- <b>테스트 명령어</b>: `dd if=/dev/zero of=1GB_test_file bs=1M count=1024 oflag=direct`
- <b>조건</b>: 스토리지와 Pod가 서로 다른 노드에 위치

| <b>구분</b> | <b>Local</b> | <b>NFS (async)</b> | <b>Rook-Ceph</b> | <b>Longhorn</b> |
| :--- | :--- | :--- | :--- | :--- |
| <b>복제본 1개</b> | 200MB/s | 99MB/s | 23MB/s | 57.4MB/s |
| <b>복제본 2개</b> | - | - | 15MB/s | 40MB/s |
| <b>복제본 3개</b> | - | - | 12MB/s | 30MB/s |

> [!IMPORTANT]
> 벤치마크 결과, `Rook-Ceph`는 복제본 수가 늘어날수록 안정성을 확보하지만 쓰기 속도가 Longhorn에 비해 현저히 낮게 측정되었다. Ceph의 성능을 최적화하기 위한 커스터마이징은 많은 시간과 노력이 필요할 것으로 판단했다.

## ✅ 선정 사유
위 비교와 벤치마크 결과를 바탕으로 다음과 같은 결론을 내렸다.

1.  <b>Longhorn</b>:
    -   `관리 용이성`과 `경량 아키텍처`라는 초기 선정 기준을 잘 만족시켰다.
    -   GUI 대시보드를 통해 백업, 스냅샷, 복제본 관리 등을 직관적으로 수행할 수 있었다.
    -   테스트 환경에서 `Rook-Ceph` 대비 우수한 쓰기 성능을 보여주었다.
    -   따라서 <b>블록 스토리지(Block Storage)</b>가 필요한 `Stateful` 애플리케이션의 기본 스토리지 솔루션으로 채택하기로 했다.

2.  <b>nfs-subdir-provisioner</b>:
    -   `ReadWriteMany` 볼륨이 필요하고 높은 성능이 요구되지 않는 경우에 적합하다고 판단했다.
    -   설정이 매우 간단하여 빠르게 적용할 수 있다는 장점이 있었다.
    -   NFS 서버의 가용성은 별도로 확보해야 하는 과제가 있지만, 보조적인 <b>파일 스토리지(File Storage)</b> 솔루션으로 활용 가치가 높다고 보았다.

`Rook-Ceph`는 기능적으로 가장 풍부했지만, 우리 클러스터의 규모와 운영 인력을 고려했을 때 초기 도입 및 유지보수 비용이 너무 크다고 판단했다. 특히 성능 문제를 해결하기 위한 전문 지식과 시간이 추가로 요구되는 점이 큰 부담으로 작용했다.

## 🔗 참고
- [Longhorn 공식 문서](https://longhorn.io/docs/)
- [nfs-subdir-external-provisioner Github](https://github.com/kubernetes-sigs/nfs-subdir-external-provisioner)
- [Rook-Ceph 공식 문서](https://rook.io/docs/rook/latest/Getting-Started/quickstart/)