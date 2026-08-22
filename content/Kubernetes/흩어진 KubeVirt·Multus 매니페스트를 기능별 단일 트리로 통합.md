---
title: 두 갈래로 흩어진 KubeVirt·Multus 매니페스트를 기능별 단일 트리로 통합하기
date: 2025-10-17
draft: false
tags:
  - kubernetes
  - kubevirt
  - multus
  - manifests
  - refactoring
banner: 
cssclasses: 
description: 두 디렉토리로 흩어지고 구버전 VM 정의까지 중복된 KubeVirt·Multus 매니페스트를, 기능별 단일 트리로 묶고 죽은 파일을 걷어낸 정리 기록.
permalink: 
aliases: 
completed: true
type:
  - note
---

## 요약

> [!SUMMARY]
> KubeVirt·Multus 매니페스트가 `kubevirt/`와 `network/` 두 트리에 나뉘어 있었고, 마스터 VM 정의가 구버전·신버전으로 중복되어 있었다. 어느 파일이 실제로 배포된 것인지 매번 헷갈리는 것이 문제였다. 기능별(operators / networking / vms / datavolumes) 단일 트리로 통합하고, 구버전과 실험 잔재는 `archive/`로 옮겼다.

VM 하나를 수정하려고 매니페스트를 찾다가, 같은 이름의 파일이 두 곳에서 나오는 것을 보고 시작한 정리다. 대단한 기술이 들어간 작업은 아니고 `git mv`가 거의 전부지만, 이런 상태가 쌓이면 나중에 반드시 사고가 발생한다. 배포된 것과 다른 파일을 수정해 놓고 "왜 반영이 안 되지?"라고 의문을 갖는 종류의 사고이다.

## 1. 흩어진 매니페스트

KubeVirt 관련 파일이 리포 안에서 두 갈래로 나뉘어 있었다.

- `kubevirt/` : Operator CR들이 루트에 흩뿌려져 있고, 그 밑에 `multus/`, `vms/`가 따로 있었다.
- `network/` : 여기에도 `multus/`가 또 있었고, `vm/`, `vm/test/`에 VXLAN 데몬셋과 VM 정의가 들어 있었다.

문제는 `multus/`가 두 트리에 모두 존재한다는 점이었다. 같은 개념(Multus 관련 매니페스트)이 물리적으로 두 곳에 분리되어 있으니, Secondary 네트워크를 수정하려면 두 디렉토리를 모두 확인해야 했다. `network/`라는 이름도 모호했다. VXLAN 오버레이용인지 Multus용인지 VM용인지, 폴더 이름만으로는 알 수가 없었다.

애초에 <b>발견성(discoverability)</b>이 없는 구조였다. 처음 보는 사람은 물론이고 만든 사람조차도 "그 파일이 어디 있더라"를 매번 다시 찾아야 했다.

## 2. 중복과 구버전 파일

트리를 확인해 보니 흩어진 것보다 중복된 것이 더 큰 문제였다.

<b>마스터 VM 정의가 두 벌</b>이었다. `kubevirt/vms/master{1,2,3}.yaml`과 `network/vm/test/master{1,2,3}.yaml`이 동시에 존재했다. 같은 마스터 노드를 가리키는 정의가 구버전·신버전으로 공존하는 셈인데, 실제로 클러스터에 배포되어 있는 것은 `network/vm/test/` 쪽이었다(212줄, VXLAN bridge 포함). `kubevirt/vms/` 아래의 것들은 secondary 네트워크도 없는 65줄짜리 구버전, 즉 이전 시도의 잔재였다.

여기에 실험 중에 만들다 둔 VLAN NAD(`nad.yaml`), 이전 브리지 방식 NAD(`nad-vm-bridge.yaml`), Multus 예제로 만들어 둔 `vm-master1-multus-example.yaml` 같은 파일이 현행 매니페스트 사이에 섞여 있었다. 삭제하기에는 아깝고 두자니 헷갈리는, 바로 그런 파일들이었다.

## 3. 기능별 단일 트리로 재편

`network/`를 없애고 전부 `kubevirt/` 아래로 모은 뒤, 파일이 아니라 <b>역할</b>을 기준으로 폴더 구조를 다시 구성했다.

```text
kubevirt/
├── operators/     # KubeVirt·CDI Operator와 CR
├── networking/    # 네트워크 인프라
│   ├── multus/    # Multus CNI (두 트리에 있던 걸 하나로)
│   ├── vxlan/     # VXLAN 오버레이 (구 network/vm)
│   └── policy/    # NetworkPolicy
├── vms/           # VM 정의
│   ├── production/    # 상시 운영 VM (agent, ansible-agent)
│   ├── master-nodes/  # 마스터 노드 VM
│   └── templates/     # VM 템플릿
├── datavolumes/   # DataVolume·스토리지
└── archive/       # 구버전·실험 잔재
```

원칙은 단순했다. "이 파일은 무엇을 하는 것인가"라는 기준으로만 위치를 정했다. Operator는 `operators/`에, 네트워크는 `networking/` 아래에 종류별로, VM은 쓰임새별로(`production` / `master-nodes` / `templates`) 배치했다. 파일 내용을 수정하지 않고 경로만 옮겼기 때문에(`git mv` 기준 대부분 R100, 100% 동일) 배포 결과가 달라질 위험은 없었다.

구버전·실험 파일은 삭제하지 않고 `archive/`로 옮겼다. 마스터 구버전 정의는 `vm-master2-old.yaml`처럼 `-old` 접미사를 붙여, 파일명만 봐도 "이것은 더 이상 사용하지 않는 파일"임이 드러나게 했다. 삭제해도 무방했지만, 나중에 "예전에는 어떻게 작성했더라"를 참고할 일이 종종 있어서 남겨 두는 방향을 택했다.

루트와 각 디렉토리에 README를 추가하여, 설치 순서(operators → networking → datavolumes → vms)와 각 폴더의 용도를 기록해 두었다. 다음에 이 구조를 다룰 사람이 트리만 보고도 전체 흐름을 파악할 수 있게 하기 위함이다.

## 4. 정리하고 나서

파일 내용은 거의 수정하지 않았는데도 사용 경험은 확실히 달라졌다. 마스터 VM을 수정할 때는 `vms/master-nodes/`만 열면 되고, 네트워크가 의심될 때는 `networking/` 아래만 확인하면 된다. "이것이 배포된 최신본이 맞는가"를 확인하느라 두 트리를 대조하던 일이 사라졌다.

`vms/templates/`에 VM 생성 가이드용 README와 기본 템플릿을 하나 두었다. 폴더가 기능별로 나뉘어 있으니 이런 자료가 들어갈 자리가 자연스럽게 생겼다.

## 참고

- [KubeVirt 공식 문서](https://kubevirt.io/)
- [Containerized Data Importer (CDI)](https://github.com/kubevirt/containerized-data-importer)
- [Multus CNI](https://github.com/k8snetworkplumbingwg/multus-cni)
- [Kubernetes: 리소스 배포 관리](https://kubernetes.io/docs/concepts/cluster-administration/manage-deployment/)
- [[재기동·노드 이동에도 유지되는 KubeVirt VM 고정 IP]]
- [[고밀도 노드에서 신규 파드 네트워크 설정 실패 Multus 데몬 OOMKilled]]
- [[VXLAN 세컨더리 네트워크 VM의 외부망 접근 설계와 비대칭 라우팅]]
