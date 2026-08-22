---
title: Jenkins 체크아웃에서 git-lfs가 SCM 토큰을 못 받아 LFS pull이 멈추던 문제
date: 2026-06-18
draft: false
tags:
  - jenkins
  - git-lfs
  - ci-cd
  - troubleshooting
  - credentials
banner: 
cssclasses: 
description: 체크아웃 중 git-lfs가 SCM 자격증명을 넘겨받지 못해 LFS pull이 "Bad credentials"로 실패하던 문제를, Jenkins 이미지에 git-lfs를 넣고 skip-smudge로 자동 smudge를 끈 뒤 인증된 pull로 명시적으로 당기게 고친 기록.
permalink: 
aliases: 
completed: true
type:
  - issue
---

## 요약

> [!SUMMARY]
> 파이프라인 체크아웃 중 git-lfs가 Jenkins가 쥔 SCM 토큰을 넘겨받지 못해 LFS API에서 "Bad credentials"로 막혀 체크아웃이 실패했다. Jenkins 이미지에 `git-lfs`를 설치하고 `git lfs install --system`으로 필터를 등록한 뒤, 체크아웃 단계에서는 자동 smudge를 끄고 인증이 붙은 명시적 pull(`GitLFSPull` 확장 또는 `GIT_LFS_SKIP_SMUDGE=1` + `git lfs pull`)로 LFS 객체를 당기도록 바꿨다.

## 1. 환경

- Jenkins: 2.555.1 (jdk21 기반 커스텀 이미지)
- SCM: GitHub (프라이빗 리포, 토큰 인증)
- 애플리케이션 리포에 LFS로 관리되는 대용량 파일 포함, GitOps 리포는 LFS 미사용

## 2. 이슈

빌드 잡이 소스를 체크아웃하다 LFS 객체를 받는 단계에서 실패했다. 로그를 파보면 LFS API 응답이 <b>Bad credentials</b>였다.

이상했던 건, git 자체 체크아웃(clone/fetch)은 멀쩡히 됐다는 점이다. 토큰은 분명히 정상적으로 통과하는데 LFS만 인증에서 거부됐다. 원인은 <b>git-lfs가 별도 프로세스</b>라는 데 있었다.

git이 LFS로 추적되는 파일을 체크아웃할 때는 <b>smudge</b> 필터가 돈다. 이 필터가 git-lfs를 별도 프로세스로 띄워 LFS API에서 실제 파일 본체를 내려받는데, 이 프로세스는 Jenkins가 git remote helper에 꽂아준 자격증명을 자동으로 물려받지 못한다. 그러니 git 본체는 토큰으로 인증되는데 git-lfs는 무인증(또는 엉뚱한 자격증명)으로 LFS API를 두드리다 "Bad credentials"를 맞고, 체크아웃이 통째로 깨지는 구조였다.

여기에 `git-lfs`가 필터로 등록돼 있지 않으면 LFS 포인터 파일(실제 바이너리가 아니라 해시만 든 텍스트)이 그대로 워크스페이스에 남아 뒤 단계의 빌드가 엉뚱하게 깨진다. 정리하면 두 가지를 같이 손봐야 했다.

- Jenkins 이미지에 git-lfs가 설치되고 필터가 등록돼 있을 것
- 체크아웃 시 git-lfs가 SCM 토큰으로 인증할 것

## 3. 해결

### 1. Jenkins 이미지에 git-lfs 설치와 system 등록

먼저 파이프라인이 도는 Jenkins 이미지에 `git-lfs`를 넣고, 필터를 system-wide로 등록했다. `--system`으로 걸어두면 이 이미지로 도는 모든 잡이 별도 설정 없이 LFS 필터를 쓴다.

```dockerfile
# Jenkins 이미지에 git-lfs 설치
RUN apt-get update && apt-get install -y \
    curl gnupg ca-certificates git-lfs \
    && rm -rf /var/lib/apt/lists/*

# LFS 필터를 system-wide로 등록해, 이 이미지로 도는 모든 잡이 LFS 객체를 정상 처리하게 한다.
# 다만 인증은 별개 문제다. git-lfs는 별도 프로세스라 SCM 토큰이 자동 전달되지 않아,
# 파이프라인 쪽에서 자격증명을 연결해주지 않으면 LFS API에서 "Bad credentials"가 난다.
RUN git lfs install --system
```

`git lfs install`은 "LFS 파일을 어떻게 다룰지"만 등록할 뿐, "누구 자격증명으로 LFS API에 접속할지"는 해결해주지 않는다. 인증은 파이프라인 단계에서 따로 이어붙여야 했다.

### 2. 선언형 체크아웃: GitLFSPull 확장과 https

Jenkins Git 플러그인에는 `GitLFSPull` 확장이 있다. 체크아웃에 이 확장을 넣으면 git-lfs가 SCM 자격증명으로 인증해 LFS 객체를 당긴다. 별도 프로세스인 git-lfs에 토큰을 연결해주는 게 이 확장이 하는 일이다.

```groovy
checkout([
    $class: 'GitSCM',
    branches: [[name: scmBranch]],
    extensions: [
        [$class: 'CleanBeforeCheckout'],
        [$class: 'LocalBranch', localBranch: scmBranch],
        [$class: 'CloneOption', noTags: true, reference: env.MIRROR_DIR, shallow: false, depth: 0, timeout: 30],
        // LFS 객체를 SCM 자격증명으로 인증해 pull. 이게 없으면
        // smudge가 LFS API에 무인증으로 접근해 "Bad credentials"로 막힌다.
        [$class: 'GitLFSPull']
    ],
    userRemoteConfigs: [[
        credentialsId: env.GIT_CREDENTIAL_ID,
        // https 필수: http로 두면 GitHub가 https로 리다이렉트하며 git-lfs 자격증명 흐름이 깨진다.
        url: "https://github.com/${env.APP_REPO}.git"
    ]]
])
```

여기서 한 번 더 겪은 문제는 리모트 URL 프로토콜이었다. `http://`로 두면 GitHub가 `https://`로 리다이렉트하는데, 그 리다이렉트를 거치는 과정에서 git-lfs 자격증명 흐름이 깨졌다. 그래서 URL은 처음부터 `https://`로 고정해야 했다. (LFS를 안 쓰는 GitOps 리포에서는 `GitLFSPull`이 그냥 no-op라 넣어둬도 무해하다.)

### 3. 셸 기반 체크아웃: skip-smudge 후 명시적 pull

선언형 `checkout`을 안 쓰고 셸에서 직접 `git clone`/`checkout`을 하는 잡도 있었다. 여기서는 자동 smudge를 아예 끄는 쪽으로 갔다. `GIT_LFS_SKIP_SMUDGE=1`을 걸면 clone·checkout 단계에서 git-lfs가 자동으로 객체를 받으려 들지 않는다(포인터만 받아둔다). 그렇게 실패 지점을 먼저 제거한 뒤, 인증이 확실히 붙은 상태에서 `git lfs pull`로 한 번에 당겼다.

```bash
# GIT_LFS_SKIP_SMUDGE=1: checkout 중 auto-smudge가 LFS를 받다 실패해 checkout이 깨지는 것을 막는다.
# 자격증명은 origin URL(https + 토큰)에 실려 있으므로, 이후 'git lfs pull'이 인증된 채로 객체를 받는다.
rm -rf "${targetDir}"
GIT_LFS_SKIP_SMUDGE=1 git clone ${cloneOptions} \
    https://${GIT_USER}:${GIT_PASS}@github.com/${repo}.git "${targetDir}"
cd "${targetDir}"
git fetch --all --prune --no-tags
GIT_LFS_SKIP_SMUDGE=1 git checkout "${ref}"
git lfs pull
```

두 단계로 쪼갠 것이다. 자동 smudge가 인증 없이 돌다 실패하는 대신, smudge를 꺼서 checkout을 먼저 통과시키고, 자격증명이 실린 origin으로 `git lfs pull`을 명시적으로 돌린다. `${GIT_USER}`/`${GIT_PASS}`는 자격증명 스토어에서 주입받는 값이라 로그·스크립트에 평문으로 남기지 않는다.

## 4. 확인

같은 잡을 다시 돌려 체크아웃이 실패하지 않고 통과하는지 봤다. LFS 단계에서 "Bad credentials"가 사라지고 pull이 정상 종료했다.

워크스페이스의 LFS 파일이 포인터가 아니라 실제 바이너리로 내려왔는지도 확인했다.

```bash
# LFS로 추적되는 파일이 실제로 받아졌는지(포인터가 아닌 본체인지) 확인한다.
git lfs ls-files   # 받아진 객체는 앞 상태 표시가 '*' (checkout됨)로 뜬다
```

`git lfs ls-files`에서 대상 파일들이 checkout된 상태로 잡히고, 이어지는 빌드가 실제 바이너리를 정상적으로 참조하면 끝이다. 인증이 붙은 뒤로는 실패가 재발하지 않았다.

## 참고

- [Git LFS](https://git-lfs.com/)
- [git-lfs install (man)](https://github.com/git-lfs/git-lfs/blob/main/docs/man/git-lfs-install.adoc)
- [git-lfs pull (man)](https://github.com/git-lfs/git-lfs/blob/main/docs/man/git-lfs-pull.adoc)
- [Jenkins Git plugin](https://plugins.jenkins.io/git/)
