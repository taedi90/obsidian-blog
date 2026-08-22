---
title: 쿠버네티스 이미지 pull 인증 방식 정리와 노드 레벨 무중단 적용
date: 2026-07-29
draft: false
tags:
  - kubernetes
  - kubelet
  - containerd
  - image-pull
  - registry
banner: 
cssclasses: 
description: 쿠버네티스에 이미지 pull 권한을 주는 방식이 대체 몇 가지인지 계층별로 정리한 학습 기록. pull 주체가 kubelet→CRI라는 축으로 방식을 늘어놓고, 실측으로 확정한 제약을 정리한 뒤, 내부 클러스터에 노드 레벨을 골라 적용해 검증했다.
permalink: 
aliases: 
completed: true
type:
  - note
---

## 요약

> [!SUMMARY]
> 쿠버네티스에 이미지 pull 권한을 주는 방식을 계층별로 정리했다. 축은 하나다. <b>pull 주체는 Pod가 아니라 노드의 kubelet → CRI</b>이고, 모든 방식은 "kubelet/CRI에 credential을 어떻게 쥐여줄 것인가"의 변형이다. 실측으로 확정한 제약은 다음과 같다. `certs.d`는 Docker Hub를 인증할 수 없고(401), kubelet keyring은 기동 시점에 캐시하므로 재기동이 필수이며, 노드별 root-dir이 다르면 조용히 실패한다. 정리한 선택지 중에서 노드 레벨(kubelet keyring)을 내부 클러스터 10개 노드에 무중단으로 적용하고 검증까지 마쳤다.

## 1. 환경

- 쿠버네티스 클러스터 2개 (검증·운영, 각 control-plane 3 + worker 2)
- CRI: containerd (`certs.d` / `hosts.toml` 사용 중)
- 레지스트리: Docker Hub 프라이빗 저장소 + 사내 레지스트리

## 2. 계기

검증 클러스터에서 프라이빗 이미지를 쓰는 Pod 하나가 `ImagePullBackOff` 상태로 멈췄다. 진단해보니 SA에 `imagePullSecrets`가 붙어 있지 않았다. 같은 네임스페이스의 다른 SA 세 개에는 붙어 있었는데, 이 Pod가 사용하는 SA만 빠져 있었다. 패치해서 원인 자체는 바로 해소되었다.

여기서 멈출 수도 있었다. 하지만 이런 누락이 왜 생기는지 따라가다 보니, 애초에 이미지 pull 권한을 부여하는 방식이 몇 가지이고 각각 어떤 계층에서 동작하는지 정확히 알지 못하고 있었다. 이번 기회에 방식 자체를 정리하기로 했다.

## 3. pull 주체와 방식 계층

방식을 늘어놓기 전에 축이 필요했다. 이미지를 실제로 내려받는 주체는 Pod가 아니라 <b>노드의 kubelet, 그리고 그 뒤의 CRI(containerd)</b>다. 그래서 어떤 방식이든 결국 "kubelet/CRI가 레지스트리에 인증할 credential을 어디서 얻느냐"의 문제로 수렴한다. 이 축으로 정리하면 아래 표와 같다.

| 방식 | 격리 단위 | Secret이 클러스터에 저장됨 | 노드 부트스트랩 필요 |
| --- | --- | --- | --- |
| Pod `imagePullSecrets` | Pod | O | X |
| SA `imagePullSecrets` (admission이 Pod에 머지) | 네임스페이스 | O | X |
| Admission 자동 주입 (Kyverno 등) | 네임스페이스 | O | X |
| 노드 docker config (`{kubelet root-dir}/config.json`) | 노드 전체 | X | O |
| CRI 설정 (containerd `certs.d`/`hosts.toml`) | 노드 전체 | X | O |
| kubelet credential provider plugin (ECR/GCR/ACR 등) | 노드(클라우드 IAM) | X | O(설치) |
| 사전 pull + `imagePullPolicy: Never` | 없음 | X | O |
| 레지스트리 미러/pull-through 캐시로 인증 위임 | 없음 | X | 미러 설정 |
| 네트워크·신원 기반 허용 (VPC Endpoint, IP allowlist, mTLS) | 없음 | X | X |

정리하면서 곁에서 두 가지를 더 확인했다.

- 노드에 그냥 `docker login`을 해도 동작하긴 하지만, 동작하는 것이 "우연"인 경우가 많다. kubelet은 `{root-dir}/config.json`, `{cwd}/config.json`, `${HOME}/.docker/config.json`, `/.docker/config.json` 순서로 파일을 탐색하는데, systemd 유닛은 `HOME`이 비어 `/`로 잡히는 경우가 흔해서 `~/.docker/config.json`이 아예 탐색 범위 밖으로 벗어난다. CRI가 containerd라도 docker 데몬과 무관하게 <b>파일 위치만 맞으면</b> 동작한다.
- 노드에 credential과 이미지 캐시가 남는 방식을 사용한다면 `AlwaysPullImages` admission plugin이 필수다. 캐시된 프라이빗 이미지라도 매번 레지스트리 인증을 다시 통과시켜서, 권한 없는 워크로드가 이미지 이름만 알고 노드 캐시를 임의로 사용하는 것을 막는다.

## 4. 실측으로 확정한 제약

표는 문서만 봐도 만들 수 있다. 하지만 "이 환경에서 실제로 동작하는가"는 그렇지 않아서, 클러스터를 변경하지 않는 선에서 실측으로 확정했다.

### 3-1. certs.d와 Docker Hub 토큰 인증

노드의 containerd에는 이미 `config_path = "/etc/containerd/certs.d"` 설정이 켜져 있었고, 사내 레지스트리 여러 개가 이 방식으로 관리되고 있었다. `certs.d`의 `hosts.toml`은 pull 요청마다 다시 읽히므로 <b>데몬 재시작이 필요 없는</b> 경로였다. 여기에 Docker Hub 항목만 추가하면 끝날 것 같았다.

동작하지 않았다. `hosts.toml`에는 username/password 필드가 없고 정적 `header.authorization`만 지정할 수 있는데, Docker Hub는 registry 엔드포인트에서 Basic 인증을 받지 않고 별도 토큰 교환(`auth.docker.io`)을 요구한다. containerd는 그 토큰 요청에 이 헤더를 실어 보내지 않는다. 노드에 실험하지 않고 `curl`로 확정했다.

- registry 엔드포인트에 Basic을 직접 전송 → <b>HTTP 401</b>
- 토큰 교환 후 Bearer로 요청 → <b>HTTP 200</b>

즉 `certs.d`로는 Docker Hub 인증이 불가능하고, kubelet keyring만 가능하다. 이 실험으로 자격증명 자체가 유효함도 함께 확인했다.

### 3-2. kubelet keyring의 기동 시 캐시

canary 노드 하나에 `config.json`만 배치하고 kubelet은 재기동하지 않은 상태에서, `imagePullSecrets`가 전혀 없는 Pod를 그 노드에 고정하여 pull을 시도했다. 결과는 `insufficient_scope` 실패였다. <b>파일을 올려두는 것만으로는 효과가 없고, kubelet 재기동이 필수</b>다. keyring은 kubelet이 시작될 때 한 번 읽어서 캐시한다.

### 3-3. 노드별 root-dir 불일치

적용 과정에서 노드 한 대에서만 pull 검증이 계속 `insufficient_scope`로 실패했다. 그 노드만 표준 경로(`/var/lib/kubelet`)가 아닌 커스텀 root-dir을 사용하는데, 파일을 표준 경로에 넣었던 것이다. <b>잘못된 경로에 넣으면 조용히 실패</b>하고, 에러 메시지가 인증 실패와 구분되지 않아 한참 헤맸다.

스크립트가 `/proc/<kubelet-pid>/cmdline`에서 `--root-dir` 값을 직접 읽어 자동 감지하도록 수정했다. 구버전 systemd(CentOS 7)는 `systemctl show --value`를 거부하므로, systemd에 의존하지 말고 `/proc`을 파싱해야 한다.

## 5. 내부 클러스터 적용

정리한 선택지를 실제 환경에 대입해 보았다. 이 클러스터는 단일 솔루션 전용 내부 클러스터인데 네임스페이스와 SA가 계속 늘어나고 배포 주체도 다양하다. Pod마다 SA마다 secret을 붙이는 방식은 이 조건에서 계속 누수되는 구조다. 이번처럼 하나 빠지면 조용히 장애가 터진다. 그래서 <b>노드 레벨(kubelet keyring)</b>을 선택했다. 출발점이었던 Kyverno 자동 주입은 컴포넌트 부하 때문에 당장 도입하기 어렵고 내부 클러스터에만 필요한 상황이라 제외했다.

적용은 두 클러스터 10개 노드에 무중단으로 진행했다.

- 롤아웃을 유발하는 `kubectl drain`은 배제하고 kubelet 재기동만 수행했다. 지키려던 기준은 "사용자가 체감하는 중단을 만들지 않는다"였다.
- 노드에 passwordless sudo가 없어서 특권 Pod(`nsenter`)로 우회하여 파일 배치와 재기동을 수행했고, 자격증명이 Pod spec에 평문으로 남지 않도록 Secret을 볼륨으로 마운트했다.
- 노드 한 대씩, 매 단계 실패 시 중단하는 파이프라인(baseline 기록 → root-dir 감지 → 배치 → 재기동 → Ready 확인 → 재시작 diff → pull 검증)으로 진행했고, 운영 클러스터에서는 적용 전 대조군(`ErrImagePull` 실패 확인)을 먼저 수행하여 이미지 캐시 착시를 배제했다.

kubelet 재기동의 실제 영향도 관찰해 두었다. 노드가 `Ready` 상태를 벗어난 적은 없었고, static pod은 mirror 객체만 재생성되면서 `.status.startTime`이 리셋되는 착시가 있으며(`restartCount`는 유지), device plugin은 소켓 재등록 때문에 재시작되었다. 예상하지 못한 부작용도 하나 있었다. <b>노드 credential을 활성화하면 `ImagePullBackOff` 상태로 멈춰 있던 롤아웃이 조용히 완주한다.</b> 68분간 멈춰 있던 배포가 canary 노드 재기동과 함께 완료되었다. 무중단 작업이라고 해서 아무 일도 일어나지 않는 것은 아니다.

## 6. 남겨둔 것

- PAT 로테이션: 로테이션할 때에는 클러스터의 Secret뿐 아니라 노드에 복사해둔 파일 사본까지 함께 갱신해야 한다. 노드 파일은 Secret과 자동으로 동기화되지 않는다. 노드 레벨 방식이 편의를 준 만큼 이 이중 관리 부담을 남긴다.
- 개인 계정으로 만든 레지스트리 Secret 정리: 운영 환경에 개인 계정으로 만든 secret이 남아 있다. 담당자 퇴사나 권한 변경 시 깨질 수 있는 지점이므로, 언젠가 팀 계정으로 정리해야 한다.
- crashloop Pod: 양쪽 클러스터에 수백~수천 회 재시작 중인 Pod들이 있지만, 이번 작업과 무관하므로 손대지 않았다. 별개 과제로 남긴다.

## 참고

- [Kubernetes — Pull an Image from a Private Registry](https://kubernetes.io/docs/tasks/configure-pod-container/pull-image-private-registry/)
- [Kubernetes — Configure Service Accounts (imagePullSecrets)](https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/#add-imagepullsecrets-to-a-service-account)
- [Kubernetes — Kubelet credential provider](https://kubernetes.io/docs/tasks/administer-cluster/kubelet-credential-provider/)
- [Kubernetes — AlwaysPullImages admission controller](https://kubernetes.io/docs/reference/access-authn-authz/admission-controllers/#alwayspullimages)
- [containerd — Registry host configuration (hosts.toml)](https://github.com/containerd/containerd/blob/main/docs/hosts.md)
- [Docker — Token authentication (registry auth flow)](https://distribution.github.io/distribution/spec/auth/token/)
