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

## 요약

> [!SUMMARY]
> [[폐쇄망 전용 싱글 바이너리 워크플로우 도구 Deck 만들기|Deck]]을 Go로 만들며 CLI 구성 방법을 공부하다가 [spf13/cobra](https://github.com/spf13/cobra)를 접했다. 서브커맨드 트리·플래그 파싱·`--help`·자동완성이 라이브러리에 포함되어 제공된다는 것을 확인한 뒤에야, 예전에 순수 쉘스크립트로 CLI를 만들 때 help·반응형 처리·로그 포맷을 직접 작성하느라 고생했으면서도 오픈소스 CLI만큼 완성도가 나오지 않았던 이유가 납득되었다. `kubectl`·`helm`·`kubeadm`이 사용하는 바로 그 라이브러리다.

쉘스크립트로 CLI를 흉내 내던 시절에는 완성도가 늘 아쉬웠는데, 돌아보면 그것이 온전히 내 실력 탓만은 아니었다.

## 1. 쉘스크립트로 CLI 만들 때 시간을 쏟던 것들

그동안 자잘한 운영 도구는 쉘스크립트로 CLI 형태를 만들어 왔다. `case "$1" in ...` 구문으로 서브커맨드를 나누고, 나름 완성도 있게 만들려고 애를 썼다. 하지만 CLI답게 만들려는 노력의 상당 부분이 정작 본질과 무관한 곳에 들어갔다.

- <b>help.</b> `--help` 출력을 위해 사용법을 `echo`로 직접 찍었다. 명령을 수정할 때마다 그 `echo`도 함께 수정해야 했고, 수정하지 않으면 문서와 실제 동작이 어긋났다.
- <b>반응형(interactive).</b> 값을 물어보고 확인받는 프롬프트와 잘못된 입력 재확인 같은 기능을 `read`와 `while`로 직접 작성했다. 엔터 입력과 기본값, 취소 처리를 매번 새로 만들었다.
- <b>로그 포맷.</b> 레벨(info/warn/error)에 따라 색을 입히고 접두사를 붙이는 기능을 `printf`와 ANSI 코드로 직접 구현했다. 도구마다 포맷이 미묘하게 달라졌다.
- <b>플래그 파싱.</b> `--root`, `--dry-run` 옵션 하나를 받으려고 `while [[ $# -gt 0 ]]; do case ...` 구문을 명령마다 복사해서 붙였다. 축약형(`-n`) 지원이나 인자 순서 무관 처리는 자동으로 되지 않았다.
- <b>서브커맨드 트리.</b> 2단계(`tool sub action`)만 돼도 `case` 안에 `case`를 중첩해야 했다.

각 항목은 개별적으로 해낼 수 있는 작업이다. 문제는 이 모든 것을 도구마다, 그리고 명령이 늘어날 때마다 계속 손으로 유지해야 했다는 점이다. 그렇게 많은 시간을 들였는데도 완성도는 `kubectl` 같은 오픈소스 CLI 근처에도 미치지 못했다. 그때는 "내가 부족해서"라고만 생각했다.

## 2. Cobra를 보고 이유를 알았다

Deck을 Go로 작성하며 Cobra를 사용하기 시작하니, 앞서 손으로 만들던 기능들이 전부 라이브러리에 기본으로 포함되어 있었다. 내가 부족했던 것이 아니라, 쉘스크립트에는 그 역할을 대신해 줄 계층이 없었을 뿐이었다.

- 서브커맨드 트리 — 명령 하나가 `*cobra.Command` 구조체이고, `AddCommand`로 부모에 붙이면 `deck bundle verify` 같은 경로가 저절로 생긴다.
- 플래그 파싱 — `cmd.Flags().Bool("dry-run", false, "...")` 한 줄. 축약·순서 무관·타입 검증까지 [pflag](https://github.com/spf13/pflag)가 처리한다.
- `--help`/`Usage` — 명령의 `Short`/`Long` 필드에 설명을 적으면 help 출력이 자동 생성된다. 설명이 코드 옆에 있으므로 어긋날 일이 없다.
- 셸 자동완성 — 명령 트리에서 bash/zsh/fish/powershell 스크립트를 자동 생성한다.

내가 작성해야 하는 것은 "이 명령이 어떤 일을 하는가"에 해당하는 (`RunE` 함수)뿐이고, CLI로서의 형식은 라이브러리가 채워 준다. 쉘스크립트 시절 실제로 무거웠던 부분이 이 형식 유지였다는 것을 Go로 옮기고 나서야 알았다. (반응형 프롬프트나 컬러 로그도 Go 생태계에는 [survey](https://github.com/AlecAivazis/survey)·[fatih/color](https://github.com/fatih/color) 같은 라이브러리가 있어서, 쉘로 직접 만들던 기능을 대부분 조립으로 해결할 수 있다.)

## 3. K8s 진영과 같은 라이브러리라는 점

Cobra를 마음 편히 선택하는 데는 이유가 하나 더 있었다. 내가 매일 사용하는 도구들이 이 라이브러리로 만들어졌다는 점이다. `kubectl`, `helm`, `kubeadm`이 모두 spf13/cobra 기반이며, 그 외에도 `docker`·`gh`·`hugo`가 같은 계열이다. (Kubernetes 진영이 워낙 널리 사용해서 Go CLI의 사실상 표준처럼 자리 잡았다.)

덕분에 내 도구의 사용감이 그 도구들과 결을 맞추게 된다. `kubectl <cmd> --help`, `kubectl completion zsh`가 동작하듯 `deck <cmd> --help`, `deck completion zsh`도 똑같이 동작한다. 사용자가 새로 익힐 것이 없고, 나 역시 "kubectl은 이것을 어떻게 처리하지?"라고 참고할 레퍼런스를 쉽게 찾을 수 있다. 순수 쉘스크립트로는 이런 일관성 확보 자체가 불가능했다.

## 4. 명령 트리를 코드로 세우기

Deck의 명령 트리는 대략 다음처럼 구성했다. 루트 아래에 동사 형태의 명령(apply/bundle/state/…)을 배치하고, 필요한 것만 2단계로 더 나누었다.

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

`case` 중첩이 사라지고 명령 하나가 파일 하나에 대응된다. 새 명령 추가가 "함수 하나를 작성하고 `AddCommand` 한 줄을 추가하기"가 되었으니 도구를 키우는 부담이 크게 줄었다. 쉘스크립트 시절 `case` 구조가 부담스러워 기능 추가를 미루던 것과 정반대의 경험이다.

## 5. help·자동완성·문서를 공짜로 얻기

Cobra를 사용하면서 가장 이득을 본 부분은 부수적으로 함께 얻게 된 기능들이었다.

<b>자동완성.</b> `deck completion <bash|zsh|fish|powershell>` 명령으로 스크립트를 생성할 수 있다. 사용자가 그 스크립트를 셸에 등록하면 `deck sta<Tab>` → `state` 처럼 자동완성이 동작한다. 내가 completion 로직을 작성한 것이 아니라, 명령을 트리로 정의했더니 Cobra가 자동으로 만들어 준 것이다.

<b>문서 생성.</b> Cobra에는 명령 트리를 마크다운으로 출력해 주는 기능([cobra/doc](https://github.com/spf13/cobra/blob/main/doc/md_docs.md))이 있다. Deck에는 이 기능을 감싼 내부 명령을 두고, CLI 레퍼런스를 명령 정의에서 자동 생성한다. 명령을 수정하면 문서를 다시 생성하면 되므로 "코드는 바뀌었는데 문서는 옛날 그대로"인 문제가 발생하지 않는다. (이 자동 생성 문서를 [[Docusaurus 도입기|문서 사이트]]에 그대로 활용했다.)

쉘스크립트 CLI가 오픈소스 수준의 완성도에 미치지 못했던 것은 실력 탓이라기보다, 명령 트리·플래그 파싱·help·자동완성·로그·레퍼런스 문서라는 형식을 맨손으로 전부 감당해야 했던 탓이 컸다. Cobra로 옮긴 뒤에는 내가 관리하는 범위가 "각 명령이 하는 일"로 좁혀졌다.

## 참고

- [[폐쇄망 전용 싱글 바이너리 워크플로우 도구 Deck 만들기]]
- [[Docusaurus 도입기]]
- [spf13/cobra](https://github.com/spf13/cobra)
- [spf13/pflag](https://github.com/spf13/pflag)
- [Cobra — Generating Markdown Docs](https://github.com/spf13/cobra/blob/main/doc/md_docs.md)
