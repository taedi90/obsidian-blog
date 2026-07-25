---
title: Cobra로 Go CLI 만들기
date: 2026-01-15
draft: false
tags:
  - go
  - cobra
  - cli
  - deck
banner: 
cssclasses: 
description: Deck을 Go로 만들면서 "Go에서 CLI를 어떻게 짜지"를 공부하다 spf13/cobra를 만났다. 그러고 나서야 예전에 순수 쉘스크립트로 CLI를 만들 때 help·반응형·로그 포맷에 시간을 쏟고도 오픈소스 CLI만큼 안 나왔던 이유가 보였다.
permalink: 
aliases: 
completed: true
featured: true
type:
  - note
---

## 🚀 요약

> [!SUMMARY]
> [[폐쇄망 전용 싱글 바이너리 워크플로우 도구 Deck 만들기|Deck]]을 Go로 만들며 CLI 구성법을 공부하다 [spf13/cobra](https://github.com/spf13/cobra)를 만났다. 서브커맨드 트리·플래그 파싱·`--help`·자동완성이 라이브러리로 딸려오는 걸 보고서야, 예전에 순수 쉘스크립트로 CLI를 만들 때 help·반응형·로그 포맷을 손수 짜느라 고생하고도 오픈소스 CLI만큼 안 나왔던 이유가 납득됐다. `kubectl`·`helm`·`kubeadm`이 쓰는 바로 그 라이브러리다.

쉘스크립트로 CLI 흉내를 내던 시절엔 완성도가 늘 아쉬웠는데, 돌아보니 그게 온전히 내 탓만은 아니었다.

## 1. 쉘스크립트로 CLI 만들 때 시간을 쏟던 것들

그동안 자잘한 운영 도구는 쉘스크립트로 CLI 흉내를 내왔다. `case "$1" in ...`으로 서브커맨드를 나누고, 나름 그럴싸하게 만들려고 애를 썼다. 그런데 CLI답게 만들려는 노력 대부분이 정작 본질과 무관한 데 들어갔다.

- <b>help.</b> `--help`를 보여주려고 사용법을 `echo`로 직접 찍었다. 명령을 고칠 때마다 그 `echo`도 같이 고쳐야 했고, 안 고치면 문서와 실제 동작이 어긋났다.
- <b>반응형(interactive).</b> 값을 물어보고 확인받는 프롬프트, 잘못된 입력 되묻기 같은 걸 `read`와 `while`로 손수 짰다. 엔터·기본값·취소 처리를 매번 다시 만들었다.
- <b>로그 포맷.</b> 레벨(info/warn/error)에 따라 색을 입히고 접두사를 붙이는 걸 `printf`와 ANSI 코드로 직접 만들었다. 도구마다 포맷이 미묘하게 달라졌다.
- <b>플래그 파싱.</b> `--root`, `--dry-run` 하나 받으려고 `while [[ $# -gt 0 ]]; do case ...`를 명령마다 복붙했다. 축약(`-n`)이나 순서 무관 같은 건 알아서 안 됐다.
- <b>서브커맨드 트리.</b> 2단계(`tool sub action`)만 돼도 `case` 안에 `case`를 중첩해야 했다.

하나하나는 다 할 수 있다. 문제는 이걸 전부, 도구마다, 명령이 늘 때마다 계속 손으로 유지해야 했다는 거다. 그렇게 시간을 쏟고도 완성도는 `kubectl` 같은 오픈소스 CLI 근처에도 못 갔다. 그때는 "내가 부족해서"라고만 생각했다.

## 2. Cobra를 보고 이유를 알았다

Deck을 Go로 짜며 Cobra를 쓰기 시작하니, 위에서 손으로 만들던 게 전부 라이브러리에 기본으로 들어 있었다. 내가 부족했던 게 아니라, 쉘스크립트에는 그걸 대신해줄 층이 없었을 뿐이었다.

- 서브커맨드 트리 — 명령 하나가 `*cobra.Command`고 `AddCommand`로 부모에 붙이면 `deck bundle verify` 같은 경로가 그냥 생긴다.
- 플래그 파싱 — `cmd.Flags().Bool("dry-run", false, "...")` 한 줄. 축약·순서 무관·타입 검증까지 [pflag](https://github.com/spf13/pflag)가 처리한다.
- `--help`/`Usage` — 명령의 `Short`/`Long` 필드에 설명을 적으면 help가 자동 생성된다. 설명이 코드 옆에 있으니 어긋날 일이 없다.
- 셸 자동완성 — 명령 트리에서 bash/zsh/fish/powershell 스크립트를 자동 생성한다.

내가 짜야 하는 건 "이 명령이 무슨 일을 하나"(`RunE` 함수)뿐이고, CLI로서의 격식은 라이브러리가 채운다. 쉘스크립트 시절 진짜 무거웠던 게 이 격식 유지였다는 걸 Go로 옮기고 나서야 알았다. (반응형 프롬프트나 컬러 로그도 Go 생태계엔 [survey](https://github.com/AlecAivazis/survey)·[fatih/color](https://github.com/fatih/color) 같은 라이브러리가 있어서, 쉘로 손수 만들던 걸 대부분 조립으로 해결한다.)

## 3. K8s 진영과 같은 라이브러리라는 점

Cobra를 마음 편히 고른 데엔 이유가 하나 더 있었다. 내가 매일 쓰는 도구들이 이걸로 만들어졌다. `kubectl`, `helm`, `kubeadm`이 전부 spf13/cobra 기반이고, 그 바깥으로도 `docker`·`gh`·`hugo`가 같은 계열이다. (Kubernetes 진영이 워낙 많이 써서 사실상 Go CLI의 표준처럼 자리 잡았다.)

덕분에 내 도구의 사용감이 그 도구들과 결을 맞추게 된다. `kubectl <cmd> --help`, `kubectl completion zsh`가 되듯 `deck <cmd> --help`, `deck completion zsh`가 똑같이 된다. 쓰는 사람이 새로 배울 게 없고, 나도 "kubectl은 이걸 어떻게 처리하지?" 하고 참고할 레퍼런스가 널려 있다. 순수 쉘스크립트로는 이 일관성 자체가 불가능했다.

## 4. 명령 트리를 코드로 세우기

Deck의 명령 트리는 대략 이렇게 잡았다. 루트 아래 동사(apply/bundle/state/…)를 붙이고, 필요한 것만 2단계로 더 나눴다.

```text
deck
├── apply          # 워크플로우(apply 파일)를 번들에 대해 실행
├── plan           # 실행 전 계획을 보여줌 (vars 하위: 유효 변수·컨텍스트 확인)
├── bundle
│   ├── verify     # 번들 무결성 검증
│   └── build      # 번들 생성
├── state
│   ├── show       # 저장된 apply 상태 조회
│   ├── list       # 상태 파일 목록
│   └── clear      # 상태 삭제
├── cache          # 캐시 관리
├── serve          # 데몬/서버 모드
├── ask            # AI 보조 (login/logout/status 하위)
├── completion     # 셸 자동완성 스크립트 생성
└── version
```

코드로는 부모 명령을 만들고 자식을 붙이는 게 전부다.

```go
// state 는 그 자체로 실행하는 게 아니라 하위 명령의 그룹이다.
stateCmd := &cobra.Command{
    Use:   "state",
    Short: "Inspect and clear saved apply state",
}
stateCmd.AddCommand(
    newStateShowCmd(),   // deck state show
    newStateListCmd(),   // deck state list
    newStateClearCmd(),  // deck state clear
)
rootCmd.AddCommand(stateCmd)
```

`case` 중첩이 사라지고 명령 하나가 파일 하나로 떨어진다. 새 명령 추가가 "함수 하나 쓰고 `AddCommand` 한 줄"이 되니 도구를 키우는 부담이 확 줄었다. 쉘스크립트 시절 `case`가 무서워 기능 추가를 미루던 것과 정반대다.

## 5. help·자동완성·문서를 공짜로 얻기

Cobra를 쓰며 제일 이득 본 건 부수적으로 딸려온 것들이었다.

<b>자동완성.</b> `deck completion <bash|zsh|fish|powershell>`로 스크립트를 뽑는다. 사용자가 그걸 셸에 걸면 `deck sta<Tab>` → `state`가 된다. 내가 completion 로직을 짠 게 아니라, 명령을 트리로 정의했더니 Cobra가 만들어줬다.

<b>문서 생성.</b> Cobra엔 명령 트리를 마크다운으로 뽑아주는 기능([cobra/doc](https://github.com/spf13/cobra/blob/main/doc/md_docs.md))이 있다. Deck에는 이걸 감싼 내부 명령을 두고 CLI 레퍼런스를 명령 정의에서 자동 생성한다. 명령을 고치면 문서도 다시 뽑으면 그만이라 "코드는 바뀌었는데 문서는 옛날 그대로"인 사고가 안 난다. (이 자동 생성 문서를 [[Docusaurus 도입기|문서 사이트]]에 그대로 얹었다.)

쉘스크립트 CLI가 오픈소스만큼 안 나왔던 건 실력 탓이라기보다, 트리·플래그·help·자동완성·로그·레퍼런스 문서라는 격식을 맨손으로 다 떠안았던 탓이 컸다. Cobra로 옮기고 나선 내가 관리하는 게 "각 명령이 하는 일"로 좁혀졌다.

## 🔗 참고

- [[폐쇄망 전용 싱글 바이너리 워크플로우 도구 Deck 만들기]]
- [[Docusaurus 도입기]]
- [spf13/cobra](https://github.com/spf13/cobra)
- [spf13/pflag](https://github.com/spf13/pflag)
- [Cobra — Generating Markdown Docs](https://github.com/spf13/cobra/blob/main/doc/md_docs.md)
