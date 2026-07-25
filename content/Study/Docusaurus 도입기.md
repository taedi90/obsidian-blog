---
title: Docusaurus 도입기
date: 2026-01-28
draft: false
tags:
  - docusaurus
  - documentation
  - i18n
  - deck
banner: 
cssclasses: 
description: 기능이 늘수록 README 한 장으로는 설명이 안 되던 CLI 도구의 문서를 Docusaurus로 옮긴 기록. CLI 레퍼런스는 코드에서 자동 생성하고, 한/영 번역은 AI로 돌린 구성.
permalink: 
aliases: 
completed: true
type:
  - note
---

## 🚀 요약

> [!SUMMARY]
> [[폐쇄망 전용 싱글 바이너리 워크플로우 도구 Deck 만들기|Deck]]의 문서를 README 한 장으로 버티다, 기능이 늘며 스크롤 지옥이 되자 [Docusaurus](https://docusaurus.io/)로 옮겼다. 문서를 파일 하나로 늘려가는 구조를 얻고, CLI 레퍼런스는 [[Cobra로 Go CLI 만들기|Cobra]] 명령 정의에서 자동 생성해 얹고, 한/영 번역은 AI(`claude -p`)로 돌리되 source_hash 증분·용어집·조사 정규화로 품질을 잡았다. 배포는 GitHub Pages.

README는 시작할 땐 좋은데, 딱 거기까지다.

## 1. README 한 장이 감당 안 되던 순간

README는 시작점으로는 최고다. 리포 열면 바로 보이고, 설치 몇 줄에 예시 몇 개면 충분하다. 문제는 도구가 자라면서 생긴다.

- 설치, 개념(워크플로우 모델), 명령별 사용법, 트러블슈팅, FAQ가 한 파일에 쌓이면서 한 화면에서 원하는 곳을 못 찾는다.
- "새 기능 추가"를 쓸 때마다 기존 README 어디를 건드려야 흐름이 안 깨지나를 고민하게 된다. 문서 구조가 없으니 매번 즉흥이다.
- 코드 예시·명령 옵션이 늘면 README가 그냥 길어지기만 한다. 목차를 손으로 달아도 금방 어긋난다.

결국 설명이 점점 어려워졌다. 기능이 하나면 한 문단이면 되지만, 서로 얽힌 기능이 열 개가 되면 그걸 읽기 좋게, 그리고 새 글을 간편하게 추가할 수 있게 담을 그릇이 필요했다.

## 2. 왜 Docusaurus였나

정적 사이트 생성기는 많다(MkDocs, VitePress, Hugo…). Docusaurus로 기운 이유는 이렇다.

- 마크다운을 그대로 쓴다. `docs/` 아래 `.md`를 두면 사이드바에 항목이 생긴다. 새 문서를 추가하는 게 "파일 하나 만들기"라 저항이 없다.
- 사이드바, 이전/다음 내비, 검색, 버전 표기 같은 구조가 기본 제공이다. README에서 손으로 흉내 내던 목차가 공짜로 생긴다.
- i18n이 1급 기능이다. 뒤에 나올 한/영 번역을 얹을 자리가 처음부터 있다.
- React 기반이라 필요하면 컴포넌트로 확장할 수 있다. 당장은 안 써도 도망갈 구석이 있는 셈.

`docs/introduction.md`, `docs/quick-start.md`, `docs/workflow-model.md`처럼 개념을 파일로 쪼개고, CLI 레퍼런스는 `docs/cli/` 아래로 몰았다. README는 다시 "설치하고 여기(문서 사이트)로 오라"는 짧은 안내로 돌아갔다.

## 3. CLI 레퍼런스는 코드에서 자동 생성해 얹기

문서에서 제일 잘 어긋나는 게 CLI 레퍼런스다. 명령 옵션을 코드에서 바꿔놓고 문서를 안 고치면 거짓말이 된다. Deck은 명령을 [[Cobra로 Go CLI 만들기|Cobra]]로 정의하는데, Cobra엔 명령 트리를 마크다운으로 뽑는 기능이 있다. 그래서 CLI 레퍼런스 마크다운을 코드에서 생성해 `docs/cli/`에 넣고, 그걸 Docusaurus가 렌더한다.

```text
cobra 명령 정의 (Short/Long/Flags)
   │  deck __gendocs <dir>  (내부 명령)
   ▼
docs/cli/*.md  (명령별 레퍼런스, 자동 생성)
   │  docusaurus build
   ▼
문서 사이트의 CLI 레퍼런스 페이지
```

명령을 고치면 생성 명령을 다시 돌려 `docs/cli/`를 갱신하고, CI에서 생성물이 최신인지(`make verify-generated`류)를 검사한다. 손으로 쓴 문서가 아니니 옵션 하나 바뀌어도 레퍼런스가 항상 코드와 일치한다. README 시절 제일 자주 나던 "문서만 옛날 그대로" 사고가 이 지점에서 사라졌다.

## 4. 한/영 번역을 AI로 돌리기

Docusaurus i18n은 기본 로케일(`en`)의 `docs/`와 별개로 `i18n/ko/.../current/` 아래 번역본을 둔다. 문제는 이걸 사람이 계속 맞춰 쓰는 게 불가능하다는 거다. 영문 문서를 고칠 때마다 한글본을 똑같이 손보는 건 금방 밀린다.

그래서 번역을 스크립트로 돌렸다. 아이디어는 두 가지다.

<b>AI를 번역 엔진으로.</b> 영문 `.md`를 입력으로 받아 한글본을 생성하는 스크립트를 뒀다(`translate-docs.mjs`). 번역 엔진은 헤드리스로 부르는 AI CLI다(`claude -p` 같은 형태, 환경변수로 다른 엔진 교체 가능). 번역기 API를 따로 붙이는 대신 이미 쓰는 코딩 에이전트를 그대로 파이프로 쓴 셈이다.

<b>소스 해시로 증분 번역.</b> 매번 전부 다시 번역하면 느리고 낭비다. 그래서 번역본 프런트매터에 원문 해시(`source_hash`)를 박아둔다. 다음에 돌릴 때 원문 해시가 그대로면 건너뛰고, 바뀐 문서만 다시 번역한다.

```text
docs/quick-start.md  ──(hash 계산)──┐
                                    ▼
        i18n/ko/.../quick-start.md 의 source_hash 와 비교
             │ 같으면 skip           │ 다르면 재번역
             ▼                       ▼
           그대로                  AI 번역 → source_hash 갱신
```

여기에 번역 품질을 잡는 장치 두 개를 얹었다. 하나는 용어집(`TERMINOLOGY.md`) — 코드 식별자·CLI 명령·플래그·YAML 키·에러코드는 번역하지 말고 영어 그대로 두라는 규칙과 문체(문어체 `~합니다`, 번역투 금지)를 프롬프트에 같이 넣는다. 안 그러면 `deck apply`를 "덱 적용"으로 옮기는 참사가 난다. 다른 하나는 조사 후처리 — 영어 단어를 그대로 둘 때 뒤에 붙는 조사(은/는, 이/가)를 그 단어의 실제 발음 받침에 맞춰야 자연스럽다("deck은/deck을"). 이건 AI에 맡기면 흔들려서, 번역 뒤에 결정적 정규화 패스를 한 번 더 돌려 고정 표기로 강제한다.

정리하면 "AI 1패스 + 조사 정규화 1패스", 그리고 해시로 바뀐 것만. 사람은 용어집과 예외 규칙만 관리하면 되고, 영문을 고친 뒤 스크립트 한 번이면 한글본이 따라온다.

## 5. 배포는 GitHub Pages로

문서 사이트는 GitHub Pages로 배포했다. `docs/`나 워크플로우가 바뀌면 Actions가 `npm ci && npm run build`로 정적 사이트를 만들고, 그 산출물을 Pages 아티팩트로 올려 배포한다. (배포 워크플로우 자체는 [[GitHub Actions 입문기|GitHub Actions]] 글에서 CI 전반과 함께 다룬다.) 문서를 push하면 몇 분 뒤 사이트가 갱신되니, 문서도 코드와 같은 흐름을 탄다.

## 🔗 참고

- [[폐쇄망 전용 싱글 바이너리 워크플로우 도구 Deck 만들기]]
- [[Cobra로 Go CLI 만들기]]
- [[GitHub Actions 입문기]]
- [Docusaurus](https://docusaurus.io/)
- [Docusaurus — i18n](https://docusaurus.io/docs/i18n/introduction)
