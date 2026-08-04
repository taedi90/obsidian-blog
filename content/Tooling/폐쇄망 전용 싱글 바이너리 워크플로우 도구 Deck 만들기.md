---
title: 폐쇄망에서 쓸 싱글 바이너리 도구 'Deck'를 직접 만든 이야기
date: 2026-02-28
draft: false
featured: true
tags:
  - air-gap
  - iac
  - kubernetes
  - golang
  - tooling
  - deck
banner: 
cssclasses: 
description: SSH도 PXE도 프록시도 막힌 폐쇄망에서 K8s를 반복 설치하다, 셸 스크립트와 kubespray의 한계에 부딪혀 직접 만든 워크플로우 도구 이야기.
permalink: 
aliases: 
completed: true
type:
  - tooling
---

## 요약

> [!SUMMARY]
> 고객사 환경 대부분이 air-gapped 온프레미스였고, 그 위에 쿠버네티스를 반복해서 설치해야 했다. 직접 짠 셸 스크립트에서 kubespray로, 다시 <b>Deck</b>이라는 자체 워크플로우 도구로 옮겨온 기록이다. 온라인에서 `prepare`로 아티팩트를 모아 `bundle`로 묶고, 폐쇄망에서 `apply`로 실행한다. 선언형 YAML 워크플로우와 멱등한 typed step으로, 셸보다 검증·재실행·리뷰가 쉬운 구조를 노렸다.

## 1. 도입 배경

도구를 새로 만드는 건 대개 나쁜 선택이라 최대한 피하고 싶었다. 그런데 이번엔 셸 → kubespray로 두 번 갈아타고도 계속 걸리적거려서, 결국 직접 만들게 됐다.

내가 주로 다루던 현장은 이랬다.

- 인터넷이 완전히 차단됨.
- 노드에 SSH로 붙는 것조차 막히거나 곤란한 경우가 있음.
- PXE 부팅, BMC 원격 관리 같은 건 애초에 제공받지 못함.

이런 환경에 쿠버네티스를 설치하는 업무가 자주 발생했다.

### 1세대: kubeadm + 직접 짠 셸 스크립트

처음엔 `kubeadm`을 단독으로 쓰면서, OS 설정부터 k8s 부트스트랩, 차트 설치까지의 과정을 셸 스크립트로 직접 엮었다. 돌아가긴 했다. 문제는 <b>k8s 버전이나 OS 버전이 바뀔 때</b>였다. 버전 간 차이를 스크립트에 반영하고 분기를 쌓다 보니 관리 복잡도가 급격히 불어났고, 검증도 재실행도 리뷰도 어려운 셸의 한계를 그대로 맞았다.

### 2세대: kubespray + kubespray-offline

그래서 [kubespray](https://github.com/kubernetes-sigs/kubespray)와 kubespray-offline으로 전환했다. 다양한 버전·환경에 대응하기가 한결 수월해졌지만, 이것도 마냥 좋지만은 않았다.

- kubespray 릴리스 하나가 대응하는 쿠버네티스 마이너 버전이 <b>3개 남짓</b>(N-2)으로 좁다. 그 밖의 버전을 원하면 kubespray 버전 자체를 옮겨야 한다.
- kubespray 버전에 따라 요구하는 Ansible 버전이 달라지거나, 인벤토리 필드 값이 바뀌는 경우가 생긴다.
- CNI 컴포넌트 버전이 고정돼 있거나, CRI 설치 과정에서 호스트의 기존 컨테이너 런타임이 갈아엎어지는 등 커스텀에 제약이 많다.
- kubespray-offline은 결국 셸 스크립트 기반이다. 실행하려면 오프라인 미러를 컨테이너로 띄워야 해서 <b>containerd(혹은 podman)를 먼저 반입·설치</b>하고 그 위에 nginx 웹서버와 도커 레지스트리를 올려야 한다. 셸에서 벗어나지 못한 데다, 설치 환경에 사전 작업이 많았다.

그리고 무엇보다 결정적이었던 건, 고객사 보안 요구가 강해지면서 <b>서버 간 SSH 접근에 제약</b>이 걸리는 경우가 생긴 것이다. kubespray를 포함한 Ansible 계열은 SSH를 전제로 움직이니, 이 지점에서 통째로 막혔다.

### 그래서 Deck

가급적 Ansible이나 Terraform을 쓰고 싶었다. 하지만 <b>Ansible</b>은 SSH 친화적이라 SSH가 막힌 환경에서 곤란했고(localhost 모드로 우회하면 결국 노드마다 붙어 돌려야 한다), <b>Terraform</b>은 대상에 맞는 provider가 없으면 애초에 쓸 수가 없었다. 남는 건 다시 셸인데, 그건 1세대에서 이미 한계를 봤다.

결국 이 불편함들을 하나씩 녹여낼 도구를 직접 만들기로 했다. kubeadm은 그대로 쓰되(Deck 안의 한 step으로 다룬다), 그 위에서 OS 세팅부터 차트 설치까지를 엮던 오케스트레이션 계층 — 예전의 셸, 그다음의 kubespray — 을 대체하는 워크플로우 도구다.

> [!IMPORTANT]
> 그래서 처음부터 선을 그었다. <b>Deck은 범용 IaC 도구가 아니다.</b> 연결된 일반 환경이라면 Ansible·Terraform·Pulumi를 쓰는 게 맞다. Deck은 SSH/PXE/BMC가 없고 번들 반입과 현장 검증이 중요한, 딱 그 극단적인 경우에만 집중한다. 정의하자면 IaC라기보다 "셸 스크립트보다 구조화된 워크플로우 러너"에 가깝다.

## 2. 방향과 언어

방향은 좁게 잡았다. 번들 하나로 반입이 끝나야 하고(자체 완결), 명령과 step 표면적은 최소로 유지한다. "이것도 되면 좋잖아"를 계속 쳐내지 않으면 또 하나의 무거운 범용 도구가 되기 때문이다.

언어는 Go로 골랐다. 정적 링크된 단일 바이너리, 쉬운 크로스 컴파일, 그리고 HTTP 서버와 도커 레지스트리 프로토콜까지 한 바이너리에 넣을 수 있다는 점이 컸다. 폐쇄망에 던져 넣을 도구가 런타임이나 인터프리터를 요구하면 그 자체로 실격이다.

## 3. 네트워크 경계로 갈리는 흐름

Deck의 실행은 시간축이 아니라 <b>네트워크 경계</b>로 갈린다. 인터넷이 되는 쪽에서 필요한 걸 다 긁어모아 번들로 묶고, 폐쇄망에서는 그 번들만으로 실행한다.

<b>온라인 단계.</b> 인터넷이 되는 빌드 머신에서 워크플로우가 참조하는 리눅스 패키지·쿠버네티스 바이너리·컨테이너 이미지·임의 파일을 `prepare`로 모으고, `bundle build`로 `bundle.tar` 하나에 묶는다. 이 번들이 폐쇄망으로 넘어가는 유일한 물건이다.

```bash
# 워크스페이스 생성 → 워크플로우 검증 → 아티팩트 수집 → 번들 패키징
deck init --out ./site
cd ./site
deck lint
deck prepare
deck bundle build --out ./bundle.tar
```

<b>오프라인 단계.</b> 번들을 반입하면 먼저 무결성을 확인하고, 폐쇄망 노드에서 `apply`로 워크플로우를 실행한다. 여기서부터는 인터넷이 필요 없다.

```bash
# 반입 직후 무결성 확인 (전송 중 손상은 실행 도중이 아니라 실행 전에 걸러야 한다)
deck bundle verify --file ./bundle.tar

# 폐쇄망 노드에서 워크플로우 실행. 실패했다가 다시 돌려도 완료된 step은 건너뛴다.
deck apply
```

`prepare`·`bundle`·`apply`로 단계를 나눈 건, 각 단계가 도는 위치(온라인 빌드 머신 vs 폐쇄망 노드)가 다르기 때문이다. 경계를 명령으로 드러내야 "지금 어디서 뭘 하는 중인지"가 헷갈리지 않는다.

## 4. 내장 서버

멀티 노드가 대단한 난관은 아니었다. 워크플로우 구성에 따라 노드마다 번들을 반입해 개별로 `apply`해도 된다. 다만 같은 데이터를 노드마다 USB로 나르는 게 번거로워서, 한 노드에 반입한 데이터를 나머지가 당겨쓰면 편하겠다 싶어 서버 기능을 붙였다.

마침 환경도 이 방향과 맞았다. SSH는 막혀도 서버 간 TCP 통신은 제약이 없거나, 있어도 방화벽 허용 신청이 SSH보다 수월한 경우가 많았다. 그래서 서버가 노드에 밀어넣는(push) 대신 각 노드가 HTTP로 당겨가는(pull) 구조로 잡았다. 파일 서버와 이미지 미러를 한 바이너리에 담아 한 노드에서 `deck server up`으로 띄우면, 나머지 노드는 그 주소에서 바이너리·워크플로우·패키지·이미지를 pull한다. nginx·레지스트리를 따로 세우던 kubespray-offline식 사전 작업이 없어진 셈이다.

- <b>정적 파일 서버</b>: 패키지·바이너리·워크플로우 YAML을 HTTP로 배포한다.
- <b>pull 전용 도커 레지스트리</b>: 표준 `/v2` API로 이미지를 내려준다. 다른 노드의 containerd가 이 주소를 그냥 레지스트리로 보고 이미지를 pull한다.

여기서 구현상 하나 짚고 넘어갈 게 있다. 이 레지스트리는 표준 OCI push를 받는 완전한 레지스트리가 아니다. [google/go-containerregistry](https://github.com/google/go-containerregistry)로 <b>tarball을 소스로 삼아 read-only `/v2` pull만 제공</b>하는 구조다. 폐쇄망 노드는 이미지를 내려받기만 하면 되지 push할 일이 없으니, blob 저장·layer push까지 구현할 이유가 없었다. skopeo 같은 외부 바이너리를 반입하는 대신 이 라이브러리를 쓴 덕에 "단일 바이너리" 원칙도 지켰다.

서버는 콘텐츠를 나눠줄 뿐, 노드에 명령을 밀어넣지 않는다. 실제 실행은 각 노드의 로컬 엔진이 하니, 단일 노드에서 직접 돌리든 서버에서 받아 돌리든 노드에서 실행되는 방식은 똑같다.

## 5. YAML 워크플로우와 typed step

워크플로우 문법은 helm·k8s에 익숙한 사람이 처음 봐도 읽히게 만들고 싶었다. 그래서 `version`·`vars`·`steps` 정도의 얕은 구조로 갔고, 각 step은 `kind`로 무슨 작업인지 선언한다.

```yaml
version: v1alpha1
vars:
  kubernetesVersion: v1.30.1

steps:
  - id: disable-swap
    kind: Swap
    spec:
      disable: true
      persist: true

  - id: load-kernel-modules
    kind: KernelModule
    spec:
      names: [overlay, br_netfilter]
      load: true
      persist: true

  - id: kubeadm-init
    kind: InitKubeadm
    spec:
      configFile: /tmp/deck/kubeadm-init.yaml
      configTemplate: |          # 표준 kubeadm 설정을 그대로 임베드
        apiVersion: kubeadm.k8s.io/v1beta4
        kind: ClusterConfiguration
        kubernetesVersion: "{{ .vars.kubernetesVersion }}"
        networking:
          podSubnet: 10.244.0.0/16
```

<b>typed step</b>은 `kind`마다 스키마가 정해진 선언형 작업 단위다. `swapoff -a`를 셸로 때리는 대신 `kind: Swap`, 커널 모듈은 `kind: KernelModule`, 파일 배포는 `kind: CopyFile`/`WriteFile`, 이미지는 `kind: DownloadImage`/`LoadImage` 하는 식이다. 쿠버네티스 관련도 `InitKubeadm`·`JoinKubeadm`·`ResetKubeadm`·`UpgradeKubeadm`으로 나눠 두었다.

임의 셸을 실행하는 `kind: Command`도 있지만, 되도록 typed step으로 쓰는 걸 전제로 했다. 서비스·명령·파일·포트가 준비되길 기다리는 것도 셸 루프 대신 `WaitForService`·`WaitForCommand`·`WaitForFile`·`WaitForTCPPort` 같은 전용 kind로 처리한다.

kind 이름은 대체로 동사+목적어형(`DownloadImage`·`WriteFile`·`InitKubeadm`)으로 맞췄다. 다만 이게 명칭만 길어진 건 아닌지는 지금도 가끔 의심스럽다.

## 6. 멱등성

셸 스크립트가 무서운 이유는 두 번 돌리면 두 번 다 다르게 동작할 수 있어서다. 파일이 이미 있고, 설정이 이미 들어가 있고, 패키지가 이미 깔린 상태에서 또 돌렸을 때도 결과가 같아야 한다. 그래서 각 typed step이 <b>멱등성(idempotency)</b>을 스스로 책임지게 만들었다.

특히 신경 쓴 게 설정 파일 편집이다. containerd의 `config.toml`에 pause 이미지나 insecure 레지스트리 설정을 <b>중복 없이</b> 넣거나 빼야 하는데, 이걸 매번 `sed`로 하면 두 번 돌렸을 때 같은 블록이 두 번 박힌다. 그래서 containerd 설정은 아예 전용 kind(`WriteContainerdConfig`, 레지스트리 호스트는 `WriteContainerdRegistryHosts`)로 두어, 필요한 키만 조정하고 이미 원하는 상태면 아무것도 하지 않도록 했다.

```yaml
# containerd 설정을 선언적으로 조정한다. 이미 값이 맞으면 파일을 건드리지 않는다.
- id: configure-containerd
  kind: WriteContainerdConfig
  spec:
    path: /etc/containerd/config.toml
    systemdCgroup: true
    sandboxImage: registry.k8s.io/pause:3.9
```

범용 파일도 마찬가지 발상이라, 임의 TOML/YAML/JSON은 `EditTOML`·`EditYAML`·`EditJSON`이 경로 단위로 값을 조정한다.

## 7. 상태 관리와 스키마 관리

<b>상태 관리.</b> `apply`가 중간에 실패하면 처음부터 다시 돌리고 싶지 않다. 그래서 완료된 단계(phase)를 상태로 기록해, 재실행하면 완료된 건 건너뛰고 이어서 간다.

<b>스키마 관리.</b> typed step이 늘어나니 문서화가 골칫거리가 됐다. 손으로 쓴 문서는 코드와 금방 어긋난다. 그래서 <b>Go struct를 단일 진실 공급원(source of truth)</b>으로 삼고, 거기서 각 kind의 스키마 문서를 생성하는 파이프라인으로 갔다. 스키마 문서를 고치려면 문서가 아니라 struct를 고쳐야 한다. 귀찮아 보이지만, 이래야 "문서는 그렇다는데 실제론 안 되네" 같은 사고를 막는다. 폐쇄망에선 그 사소한 어긋남 하나가 현장 몇 시간을 잡아먹는다.

## 8. 하면서 배운 것

절반은 시행착오였다. 처음엔 이것저것 다 되는 범용 도구를 지향했다가, "그건 Ansible이 이미 더 잘한다"는 벽에 계속 부딪혀 기능을 <b>덜어내는</b> 방향으로 되돌아왔다. 미출시 프로젝트라 하위 호환을 신경 쓰지 않은 게 이때 크게 도움이 됐다. 어제 만든 걸 오늘 미련 없이 지울 수 있었다.

명령어 표면, DSL 문법, kind 네이밍 같은 건 지금도 "이게 최선인가" 싶은 구석이 남아 있다. 요구 정의부터 DSL 문법, 멱등성 추상화, 상태 관리, 다운로드용 샌드박스까지 밑바닥을 직접 설계해보니, 평소 잘 쓰던 도구들이 그 자리에 오기까지 얼마나 많은 결정을 내렸을지 조금은 짐작하게 됐다.

최종적으로 이 도구로 고객사 설치도 하고 내부 테스트 환경도 세우면서, 실제로 쓸 만하다는 건 확인했다. 세상을 바꿀 도구는 아니고 갈 길도 멀지만, SSH도 PXE도 프록시도 없는 방에 USB 하나 들고 들어가 `apply` 한 번으로 클러스터를 세우는 건 전보다 확실히 담백해졌다.

## 참고

- [Deck (GitHub)](https://github.com/Airgap-Castaways/deck)
- [kubespray](https://github.com/kubernetes-sigs/kubespray)
- [kubeadm 공식 문서](https://kubernetes.io/docs/reference/setup-tools/kubeadm/)
- [google/go-containerregistry](https://github.com/google/go-containerregistry)
- [containerd 문서](https://containerd.io/docs/)
