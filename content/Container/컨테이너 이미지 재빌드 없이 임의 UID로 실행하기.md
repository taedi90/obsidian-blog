---
title: 컨테이너 이미지 재빌드 없이 임의 UID/GID로 실행하기
date: 2026-06-26
draft: false
tags:
  - docker
  - kubernetes
  - security
  - arbitrary-uid
  - openshift
  - container
banner: 
cssclasses: 
description: 고객사마다 요구하는 UID/GID가 달라 이미지를 매번 재빌드하던 걸, OpenShift의 arbitrary-UID 패턴을 vanilla 쿠버네티스에 이식해 이미지 하나로 임의 UID/GID에 대응한 기록.
permalink: 
aliases: 
completed: true
type:
  - improvement
featured: true
---

## 🚀 요약

> [!SUMMARY]
> 고객사마다 요구하는 실행 UID/GID가 달라서, 그에 맞춰 컨테이너 이미지를 <b>매번 다시 빌드</b>하고 있었다. 고객사 수만큼 이미지 변형이 생겨 관리가 어렵고 납품·업데이트마다 재빌드가 필요했다. <b>빌드 UID와 런타임 UID를 분리</b>해서, 이미지는 한 번만 빌드하고 런타임 UID/GID는 배포 시 `securityContext`로만 지정하도록 바꿨다. 방식은 OpenShift의 <b>arbitrary-UID 패턴</b>을 vanilla 쿠버네티스에 이식한 것 — 이미지 내부 파일을 빌드 그룹(GID) 소유 + group-writable(`chmod -R g=u`)로 두고, 파드에 그 GID를 `supplementalGroups`로 등록하면 런타임 UID가 무엇이든 group 권한으로 파일에 접근한다. 언어 런타임별로 걸리는 지점(`HOME`, node의 passwd 조회)은 `ENV HOME`과 `nss_wrapper`로 메웠다. 기존 고정 UID 방식은 그대로 두고, 그 위에 임의 UID로도 돌 수 있는 "여지"를 얹는 변경이라 무손상이다.

## 1. 고객사마다 이미지를 다시 빌드하던 문제

제품은 여러 고객사에 폐쇄망으로 납품된다. 그런데 고객사마다 컨테이너를 실행할 UID/GID를 다르게 요구하는 경우가 있었다. 보안 정책상 "이 서비스는 UID 2222로 띄워라" 같은 식이다.

그때마다 우리가 한 건 <b>그 UID/GID에 맞춰 이미지를 다시 빌드</b>하는 것이었다. 이미지 안의 파일 소유권을 그 UID로 맞춰 구우니까. 문제는 이게 쌓인다는 거다.

- 고객사 수만큼 <b>이미지 변형</b>이 생겼다. 같은 서비스인데 UID만 다른 이미지가 여러 개.
- 납품·업데이트 때마다 그 변형들을 <b>다시 빌드</b>해야 했다. GPU 서빙 이미지처럼 무거운 건 빌드 시간도 만만치 않았다.

목표는 단순했다. <b>이미지는 한 번만 빌드하고, 런타임 UID/GID는 배포할 때만 정하게</b> 만드는 것. 빌드 시점의 UID와 런타임 UID를 떼어놓는 것이다.

## 2. OpenShift의 arbitrary-UID 패턴 빌려오기

찾다 보니 이건 OpenShift가 이미 표준으로 푸는 문제였다. OpenShift는 컨테이너 탈출 시 피해를 줄이고 특정 UID에 의존하는 이미지를 못 쓰게 하려고, 기본적으로 <b>프로젝트별 범위 내의 임의 UID(arbitrary UID)로 컨테이너를 실행</b>한다. 그래서 이미지를 만들 때 "특정 UID에 묶지 말고, group 권한으로 돌아가게 만들라"고 권장한다 — 파일을 `GID 0` 소유 + group-writable로 두는 식.

우리는 OpenShift가 아니라 vanilla 쿠버네티스라 이게 강제사항은 아니다. 하지만 <b>보안성과 이식성</b> 때문에 널리 쓰이는 검증된 패턴이라, 이번 UID/GID 종속 문제를 푸는 방식으로 그대로 채택했다.

한 가지만 바꿨다. OpenShift 권장인 `GID 0`(root 그룹) 대신 <b>전용 GID(여기선 3000, 빌드 그룹 `app`이라 하자)</b>를 썼다. 기능적으로는 차이가 없는데, <b>일부 고객사 보안 점검이 `GID 0` 사용 자체를 지적</b>하는 경우가 있어서다. root 그룹을 건드린다는 인상을 주고 싶지 않았다.

## 3. 원리: 빌드 그룹 소유 + supplementalGroups

핵심은 두 줄로 요약된다.

- 이미지 내부 파일을 <b>빌드 그룹(GID 3000) 소유 + group-writable</b>로 만든다. `chmod -R g=u` — group 권한을 owner 권한과 같게 맞추는 것.
- 파드를 띄울 때 그 <b>GID 3000을 `supplementalGroups`로 등록</b>한다.

그러면 런타임 UID가 2222든 9999든, 파드가 GID 3000을 보조 그룹으로 갖고 있으니 group 권한으로 이미지 파일을 읽고 쓴다. UID는 자유롭고, 접근권은 group이 책임진다.

기존 방식이 왜 안 깨지냐면, `runAsUser`/`runAsGroup`을 빌드 UID(3000)로 그대로 주면 <b>owner 권한</b>으로 접근하니 종전과 100% 동일하다. 게다가 `g=u`로 group 권한이 owner와 같아졌으니, 임의 UID가 group 권한으로 통과하면 빌드 UID(owner)는 자동으로 통과한다. 그래서 이번 변경은 기존을 강제로 바꾸는 게 아니라 선택지를 넓히는 것이다.

배포 시 파드에 주입하는 pod-level `securityContext`는 이렇게 생겼다.

```yaml
securityContext:
  runAsUser: 3000            # 사이트 런타임 uid (기본 3000, 사이트별 지정)
  runAsGroup: 3000           # 사이트 런타임 gid
  runAsNonRoot: true
  fsGroup: 3000              # runAsGroup 미러 (아래 5절)
  fsGroupChangePolicy: OnRootMismatch
  supplementalGroups:
    - 3000                   # 이미지 빌드 그룹 GID — 이게 임의 UID 대응의 핵심
    # + 필요 시 도메인 디바이스 그룹 (예: GPU 노드 접근용 44)
```

## 4. 언어 런타임마다 걸리는 지점

`g=u`만으로 다 되면 좋았을 텐데, 임의 UID로 띄우면 언어 런타임별로 다른 데서 걸렸다. 걸림돌은 세 종류였다.

<b>① 런타임 쓰기 경로 권한 (`chmod -R g=u`)</b>
런타임이 작업·로그·캐시 디렉토리에 쓰려는데 group 쓰기 권한이 없으면 `EACCES`로 죽는다. `/app`, `/var/log/supervisor`, `/run`, GPU 서빙의 `/vllm-workspace` 같은 경로들. 여기에 `g=u`를 걸어 group이 owner만큼 쓰게 했다.

<b>② `HOME`이 `/`로 잡히는 문제 (`ENV HOME` / 캐시 env)</b>
임의 UID는 `/etc/passwd`에 엔트리가 없다. 그러면 `HOME`이 `/`로 잡히고, `~/.cache` 같은 데 쓰려다 실패한다. 두 갈래로 대응했다.

- `ENV HOME=/home/app`을 명시하고 그 경로도 `g=u`로 열어두거나,
- 캐시 경로를 환경변수로 직접 돌린다. 예: HuggingFace는 `HF_HOME`, Maven은 `-Duser.home`(JVM `user.home`도 passwd 기반이라), Go는 `GOPATH`를 절대경로로.

<b>③ node의 passwd 조회 (`nss_wrapper`)</b>
이건 <b>node 런타임 전용</b> 함정이었다. node의 `os.userInfo()`(내부적으로 `uv_os_get_passwd`)는 현재 UID가 passwd에 없으면 예외를 던지며 죽는다. python·go·java·dotnet은 이걸 안 하는데 node만 한다.

대응은 `nss_wrapper`다. `LD_PRELOAD=libnss_wrapper.so`를 entrypoint에 걸어, 임의 UID를 passwd 엔트리로 <b>동적 매핑</b>해준다. node가 "나는 UID 2222"를 조회하면 wrapper가 가짜 passwd 엔트리를 만들어 돌려주는 식. code-server, 사용자 node 앱, MCP 서버 같은 node 기반 이미지에만 이 entrypoint를 붙였다.

> [!NOTE]
> node 이미지에서 `chmod -R g=u`는 <b>`USER` 전환 전(root)</b>에 실행해야 한다. 빌더에서 온 `.venv` 같은 비-소유 파일이 섞여 있으면 USER 전환 후엔 권한이 없어 chmod가 실패한다. 이거 놓쳐서 빌드가 깨진 뒤에야 순서를 바로잡았다.

## 5. fsGroup은 왜 runAsGroup을 따라가나

`securityContext`의 `fsGroup`을 별도 값이 아니라 `runAsGroup`과 같게 뒀는데, 이유가 있다.

`fsGroup`은 무조건 필요한 게 아니라, <b>블록(non-NFS) PVC</b>가 갓 붙을 때 `root:root`로 마운트되는 경우의 쓰기를 위해 둔다. 볼륨을 `fsGroup` 그룹 소유로 바꿔주니까. 그런데 NFS는 `chown`을 무시하므로 여기선 사실상 no-op이고, 멤버십만 프로세스 보조그룹에 추가된다. 그래서 굳이 새 값을 만들지 않고 `runAsGroup`을 따라가게 해 일관성을 뒀다.

한 가지 더, `fsGroupChangePolicy: OnRootMismatch`. `fsGroup`을 주면 쿠버네티스가 볼륨을 recursive `chown`하는데, 대용량 볼륨이면 이게 파드 기동을 한참 잡아먹는다. `OnRootMismatch`는 최상위 소유권이 안 맞을 때만 손대게 해 그 비용을 피한다.

GPU처럼 디바이스 노드 접근이 필요한 워크로드는 도메인별 디바이스 그룹(예: `44`)을 `supplementalGroups`에 추가로 얹었다.

## 6. 검증

이미지가 정말 임의 UID로 도는지 확인해야 했다. 각 이미지를 두 케이스로 띄웠다.

1. 빌드 UID 그대로 (`3000:3000`)
2. 임의 UID/GID (예 `2222:2233`)

둘 다 `supplementalGroups: [3000]`을 주고, 런타임 쓰기 경로에 `mkdir` + `touch` 프로브를 돌려 쓰기가 되는지 봤다. 여기서 한 가지 지름길이 있다. <b>임의 UID(group 권한)로 통과하면 빌드 UID 3000(owner 권한)은 자동으로 충족</b>된다 — `g=u`로 group이 owner와 같으니까. 그래서 임의 UID 케이스만 통과하면 끝이었다.

대부분은 클러스터에 프로브 파드로 띄워 확인했고, GPU 서빙처럼 큰 이미지는 빌드 서버에서 네이티브로 빌드한 뒤 `docker run`으로 직접 검증했다.

## 7. 리스크: group-writable을 어떻게 볼 것인가

`chmod -R g=u`로 디렉토리·파일에 group 쓰기 권한(`w`)이 붙는다. 이게 걸리는 지점이다. 일부 고객사 보안 정책이나 점검 도구가 <b>"group-writable 파일/디렉토리"를 감점 또는 위반 항목으로 분류</b>할 수 있다. 그래서 납품 전 리스크 분석이 필요하다고 봤다.

다만 실제 영향은 제한적이라고 판단했다.

- `w`가 붙는 경로는 <b>작업·로그·캐시 디렉토리</b>(`/app`, `/home/app`, `/var/log/supervisor`, `/run` 등)다. 시스템 바이너리·설정 같은 민감 경로가 아니다.
- 베이스 시스템 경로(`/usr`, `/etc` 대부분)는 `g=u`를 아예 안 걸었다.
- 그룹이 <b>전용 GID 3000</b>이라 world-writable이 아니다. 그 GID를 `supplementalGroups`로 가진 파드만 접근한다.

팀 리뷰에서도 이 부분을 짚었다. "전체 경로 스코프가 넓어진 게 아니라 특정 그룹을 쓰는 방식이고, root로 도는 것도 아니니 컨테이너 non-root 요건은 여전히 충족한다"는 데 의견이 모였다. 다만 <b>고객사가 non-root를 실제로 어떻게 점검하는지</b>가 불명확해, 몇몇 고객사에는 사전 확인이 필요하다는 걸 숙제로 남겼다.

## 회고

결국 OpenShift가 오래 다듬어온 패턴을 우리 환경(vanilla 쿠버네티스 + 폐쇄망 납품)에 맞춰 이식한 작업이다. 이미지 하나로 어떤 고객사 UID/GID든 커버하게 되니, "고객사 수만큼 이미지"라는 곱셈이 사라졌다. 남은 건 group-writable에 대한 고객사별 보안 검토뿐인데, 그건 기술이 아니라 커뮤니케이션의 영역이다.

## 🔗 참고

- [OpenShift — Support arbitrary user IDs (image guidelines)](https://docs.openshift.com/container-platform/4.16/openshift_images/create-images.html#images-create-guide-openshift_create-images)
- [Kubernetes — Configure a Security Context for a Pod (fsGroup, supplementalGroups)](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/)
- [Kubernetes — Configure volume permission and ownership change policy (fsGroupChangePolicy)](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/#configure-volume-permission-and-ownership-change-policy-for-pods)
- [nss_wrapper](https://cwrap.org/nss_wrapper.html)
- [[클러스터 전체 파드의 실제 실행 UID GID 수집 도구 만들기|클러스터 파드들이 실제 어떤 UID/GID로 도는지 수집한 이야기]]
