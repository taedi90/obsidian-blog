---
title: "devops-agent-kit: 반복 DevOps 업무를 자동화하고 일관성을 확보하는 운영 도구 모음 만들기"
date: 2026-08-02
draft: false
tags:
  - devops
  - automation
  - llm
  - agent
  - cli
description: 반복되는 DevOps 팀 업무를 자동화하고, 누가 작업하든 비슷한 결과가 나오도록 규칙을 만들고, 여러 프로젝트를 효율적으로 관리하기 위한 파이프라인을 만든 기록.
type:
  - automation
---

## 요약

> [!SUMMARY]
DevOps 팀이 관리하는 여러 저장소의 반복 업무를 자동화하고, 작업자가 누구든 비슷한 결과가 나오도록 규칙을 만들고, 여러 프로젝트를 효율적으로 관리하기 위한 파이프라인을 만들었다. AI 에이전트 작업이 워크트리 기반 병렬 처리로 바뀌면서 기존 서브모듈 구조가 낭비가 돼서, 서브모듈을 제거하고 에이전트에게 프로젝트 정보를 전달하는 독립 도구 모음으로 바꿨다. 팀원이 서로 다른 에이전트 도구(Claude Code, Codex, Pi)를 쓰기 때문에 세 도구가 같은 소스를 공유하도록 만들었다.

## 1. 도입 배경

DevOps 팀이 관리하는 저장소가 여섯 개다. 차트 저장소(헬름 차트), gitops 저장소(ArgoCD 매니페스트), jenkins 라이브러리 저장소(Jenkins 공유 라이브러리), 차트 라이브러리 저장소(차트 라이브러리), 앱 저장소(앱 소스), 그리고 이 도구 모음 자체가 그것이다. 이슈는 org/issue-tracker 한 곳에 중앙집중하고, PR은 각 저장소에 올린다.

이 저장소들을 관리하다 보니 반복되는 작업이 매번 같았다. 작업을 시작할 때 추적 이슈가 있는지 확인하고, 없으면 만들고, 브랜치를 만들고, 규칙에 맞게 PR을 올리고, 진행 상황을 기록하고, 머지한 뒤 이슈를 닫는다. 누가 하든 이 절차는 같아야 하는데, 절차가 사람 머릿속에만 있으므로 누가 하느냐에 따라 결과가 달라졌다.

이 절차를 규칙으로 만들고 에이전트가 따르게 하면, 어떤 사람이 작업하든 비슷한 결과가 나온다. 이것이 devops-agent-kit을 만든 첫 번째 이유다. 두 번째 이유는 여러 프로젝트를 효율적으로 관리하기 위한 연결 구조가 필요했다는 점이다. 저장소마다 규칙이 다르고, 저장소 간 의존성도 있으며, 여러 저장소에 걸친 작업도 있다. 이것을 에이전트가 알아서 처리하게 하려면 프로젝트 종류와 경로, 상관관계를 전달해야 했다.

## 2. 서브모듈을 왜 버렸는가

처음에는 issue-tracker 저장소에 서브모듈로 모든 저장소를 묶어 두고, 저장소별로 `.claude/skills/`에 심링크를 만들어 사용했다. `.agent/submodules.yaml`로 tier(A=편집 대상, B=참조 전용)을 나누고, 훅 디스패처로 tier-A 대상만 훅을 발화하게 했다. 동작은 했다.

그런데 AI 에이전트 작업 방식이 바뀌었다. 워크트리를 이용한 병렬 처리로 옮겨 가면서 서브모듈 구조가 낭비가 되었다. 단일 워크트리에서 여러 에이전트가 동시에 작업하면 충돌이 발생했다. 그렇다고 워크트리를 나누면 그때마다 서브모듈 init을 수행해야 했고, 서브모듈 HEAD 해시를 맞추는 것도 부담이었다. 병렬로 작업할 수 있다는 것이 워크트리의 장점인데, 서브모듈이 그 장점을 상쇄하고 있었다.

그래서 서브모듈을 제거했다. 각 저장소는 독립된 클론으로 두고, 에이전트에게 "어떤 프로젝트가 있고, 어디에 있고, 서로 어떤 관계인지"를 알려주는 도구를 따로 만들었다. 그것이 devops-agent-kit이다. 서브모듈이 수행하던 "저장소 묶기"를 도구의 "프로젝트 정보 전달하기"가 대체한 것이다.

## 3. 전체 구조

```
devops-agent-kit/
├── config/projects.yaml       # 팀 공통 설정 (저장소 목록, 규칙, Slack, Orca)
├── skills/                     # 6개 스킬 (SKILL.md)
│   ├── devops-issue/
│   ├── devops-repo/
│   ├── devops-pr-review/
│   ├── devops-schedule/
│   ├── devops-knowledge/
│   └── devops-update/
├── hooks/                      # 세션 시작·편집 감지 훅
│   ├── session-index.sh
│   ├── edit-reminder.sh
│   ├── payload.sh
│   └── pi-adapter.ts
├── scripts/                    # 공통 스크립트
│   ├── resolve-config.sh
│   ├── identify-repo.sh
│   ├── knowledge.sh
│   └── ...
└── tests/                      # 16개 테스트 파일
```

스킬은 `SKILL.md` 파일 하나씩이다. 에이전트가 읽고 따르는 지시서 역할을 한다. 코드가 아니라 문서가 인터페이스다. 스킬 본문은 실제로 호출될 때만 로드되고, 세션 시작 시에는 라우팅 인덱스만 주입한다.

## 4. 세 도구가 같은 소스를 공유하게 한 방법

팀원이 서로 다른 에이전트 도구를 사용한다. Claude Code, Codex CLI, Pi 세 가지가 모두 사용되고 있다. 처음에는 Claude Code 플러그인 마켓플레이스로 배포했는데, 세 도구의 의존성이 따로 놀고 버전도 따로 갔다. Codex와 Pi는 마켓플레이스 채널로 닿지도 않았다.

마켓플레이스를 폐기하고 직접 설치 구조로 바꿨다. 하나의 git 저장소를 클론하고 `install.sh`를 실행하면 세 도구에 스킬과 훅이 등록된다. 같은 소스를 공유하고 버전을 함께 관리한다. `git pull` 한 번이면 세 도구가 모두 갱신된다.

| 도구 | 스킬 | 훅 등록 위치 | 편집 감지 |
|---|---|---|---|
| Claude Code | `~/.claude/skills/` 심링크 | `~/.claude/settings.json` | `Edit\|Write` |
| Codex | `~/.codex/skills/` 심링크 | `~/.codex/hooks.json` | `apply_patch` |
| Pi | `~/.agents/skills/` 직접 탐색 | `~/.pi/agent/extensions/` 확장 | 어댑터 경유 |

Claude Code와 Codex는 훅 스키마가 같아서 같은 셸 스크립트를 그대로 공유한다. matcher 문자열만 다르다. Pi는 훅 계약이 TypeScript 확장이므로 `hooks/pi-adapter.ts`가 Pi 이벤트를 같은 셸 스크립트의 입출력 형태로 옮기는 얇은 변환기 역할을 수행한다.

마켓플레이스의 경로에 버전이 들어가서 이미 열린 세션이 옛 스크립트를 실행하는 조용한 stale 문제도 같이 해결됐다. 직접 설치는 경로에 버전이 없으니까 `git pull`이 끝나는 즉시 열려 있는 세션의 훅이 새 로직을 쓴다.

> [!INFO]- 잡담: 마켓플레이스의 가치는 뭐였나
> `/plugin install` 한 줄로 끝나는 편의성이 마켓플레이스의 가치였는데, 그 편의성을 `git clone` + `install.sh` 두 줄로 바꾼 대가로 세 도구 호환과 stale 문제 해결을 얻었다. `install.sh`가 멱등해서 몇 번을 실행해도 같은 상태로 수렴하므로, 처음 설치할 때만 두 줄이 필요하고 그다음부터는 `update.sh` 한 줄이다.

## 5. 설정의 2층 구조

팀 공통값은 `config/projects.yaml`에, 개인값은 `~/.config/issue-tracker/config.yaml`에 둔다. 개인 파일이 팀 공통값을 키 단위로 덮어쓴다.

```yaml
# config/projects.yaml (팀 공통)
issue_repo: org/issue-tracker      # 추적 이슈를 중앙집중할 저장소
project_number: <보드 번호>                    # GitHub Projects 보드 번호

projects:
  차트 저장소:
    repo: org/chart-repo
    tier: edit                         # 편집 대상
    required_checks: [policy, lint, template, namespace-patch-tests]
    auto_close_issue: true
    rules:
      - "OSS 차트 직접 수정 금지. values override 로 동작 변경"
      - "차트 내부 values.yaml 에 환경값 금지. 사이트 차이는 values/<site>/ 에만"

  app-repo:
    repo: org/app-repo
    tier: edit
    branch_issue_source: local        # 브랜치 번호가 이 저장소 자체 이슈
    base_branch: develop              # main 이 아니라 develop
    auto_close_issue: false
    convention_docs:                  # AGENTS.md 대신 흩어진 규약
      - CLAUDE.md
      - docs/team-process.md
```

`resolve-config.sh`는 yq의 `*` 연산자로 병합한다. `*n`(널 병합)이 아니라 `*`를 사용하는 이유는, `*n`을 사용하면 팀=true·개인=false 조합에서 결과가 여전히 true가 되어 개인이 `false`로 훅을 끌 수 없게 되기 때문이다. (이 문제 때문에 한참 헤맸다.)

자격증명이 들어가는 값은 팀 설정에 두지 않는다. Slack 봇 토큰과 user id, 지식 저장소 DSN은 개인 파일에만 둔다.

## 6. 훅: 차단이 아니라 상기

훅은 두 개다. 둘 다 작업을 차단하지 않는데, 편의성 때문이다. 강제는 CI의 몫이고 훅은 상기 역할을 담당한다.

훅이 작업을 차단하면 에이전트가 멈추고, 결국 훅을 끄게 된다. 그렇게 되면 훅이 있든 없든 같아진다. 차단이 아니라 상기로 설계하면, 에이전트가 훅을 무시하고 진행할 수는 있지만 무시한 사실은 남는다. `set -e`를 쓰지 않고 `set -uo pipefail`만 사용한다. 그리고 어떤 경우에도 `exit 0`으로 끝난다.

### SessionStart: 라우팅 인덱스 주입

`hooks/session-index.sh`는 세션이 열릴 때 관리 대상 저장소 목록과 스킬 라우팅 인덱스를 주입한다. 스킬 전문은 여기 넣지 않고, 실제로 호출될 때만 로드되도록 둔다.

현재 세션의 작업 디렉토리가 관리 대상 저장소 안이면, 그 저장소가 무엇인지, 그리고 파일을 수정하는 작업은 추적 이슈를 남겨야 한다는 사실을 명시한다. 편집 리마인더는 이미 수정한 뒤에야 발화하므로, 착수 시점에 스킬을 타게 하려면 이 블록이 필요하다.

### PostToolUse: 편집 리마인더

`hooks/edit-reminder.sh`는 관리 대상 저장소를 편집하면 발화한다. 브랜치 규약(`feat/123`, `fix/456` 등)에 맞으면 해당 번호를 짚어 진행 기록을 요구하고, 규약 밖이라면(`main`, `develop`, 임의 이름) 추적 이슈 확인·생성과 브랜치 규약 준수를 함께 요구한다.

`branch_issue_source: local`인 저장소(앱 저장소)는 브랜치 번호가 그 저장소 자체 이슈임을 밝힌다. issue-tracker 이슈가 아니라 앱 저장소 이슈 번호라는 뜻이다.

## 7. 여섯 개의 스킬

| 스킬 | 언제 | 하는 일 |
|---|---|---|
| devops-onboarding | 설치 직후 1회 | gh 토큰 스코프, 저장소 경로, Slack 봇 토큰 매핑 |
| devops-issue | 작업 시작 전 | 이슈 검색·생성, Project status 전이, 진행사항 기록, PR 머지 후 종료 |
| devops-repo | 다른 저장소를 다룰 때 | 경로 해석, 저장소별 규칙 로드, 브랜치 생성, PR 작성 |
| devops-pr-review | 타인 PR 검토 시 | diff 중심 검토, 리뷰, 조건 충족 시 머지 |
| devops-schedule | 일정 공유 시 | GitHub Project 항목 + 세션 맥락으로 초안, Slack List 에 게시 |
| devops-update | 설치본 갱신 시 | 뒤처짐 확인, 로컬 변경 diff, update.sh 실행, 검증 |

각 스킬이 언제 발동해야 하는지는 `SKILL.md`의 description에 키워드로 명시했다. 에이전트가 키워드를 보고 자동으로 스킬을 선택하게 된다.

### devops-issue: 이슈 생애주기 관리

이슈 하나의 생애주기를 전부 다룬다. 작업 시작 전에 기존 이슈를 검색하고, 없으면 생성한다. Project status를 전이하고, 진행사항을 본문 체크리스트와 코멘트로 기록하고, PR 머지 후에 명시적으로 닫는다. 이 과정을 규칙으로 고정했으므로, 어떤 사람이 작업하든 같은 절차를 따르게 된다.

이슈는 중앙 저장소(org/issue-tracker)에 두고, PR은 각 저장소에 올린다. 크로스레포 자동 종료가 안 되는 점이 까다로운 부분이다. GitHub 네이티브 closing 키워드(`Closes org/issue-tracker#N`)는 같은 저장소 안에서만 동작한다. `auto_close_issue: true`인 저장소는 `close-linked-devops-issues.yml` 재사용 워크플로를 호출해서 PR 본문의 표기를 실제 종료로 연결한다.

### devops-repo: 저장소 라우팅

다른 저장소의 파일을 다룰 때 경로를 해석하고 규칙을 로드한다. 로컬 클론 경로는 개인 설정에서 찾고, 없으면 팀 설정의 `default_path`에서 찾는다. 여러 저장소에 걸치는 작업이면 흐름 문서(`docs/flows/`)로 순서를 판단하여 순차 또는 Orca 병렬로 진행한다.

서브모듈이 수행하던 "어떤 저장소가 있고 어디에 있는지 안내하는 역할"을 이 스킬이 대신한다. 에이전트는 서브모듈을 초기화할 필요 없이 설정에서 경로를 읽어 저장소를 찾는다.

### devops-knowledge: 지식 저장소

가장 최근에 추가된 스킬이다. 사건(incident, decision, tuning)과 개체(entity), 분야(domain) 다섯 종류의 문서를 PostgreSQL에 저장하고 검색한다. 한국어 문자 바이그램 FTS로 색인한다. 별도 글로 다룰 예정이다.

## 8. 마이그레이션

기존 `.agent/skills/`와 `.claude/skills`, `.codex/skills` 심링크를 해체하고, 새 저장소의 `install.sh`로 대체했다. 차트 저장소에 있던 차트 관련 스킬은 차트 저장소 자체의 규칙으로 두었고, 팀 수준의 이슈 생애주기·라우팅·PR 리뷰는 devops-agent-kit으로 옮겼다.

옛 Claude Code 플러그인(`devops-flow@issue-tracker` 마켓플레이스) 설치 잔재를 감지하고 안내하는 기능도 넣었다.

마이그레이션 순서:

1. Claude Code 세션에서 `/plugin uninstall devops-flow@issue-tracker` 실행 (사용자만 가능)
2. `~/.codex/skills/devops-*`와 `~/.config/issue-tracker/plugin-current` 삭제
3. 새 저장소 클론 후 `install.sh` 실행
4. 개인 설정의 옛 저장소 키를 `projects.devops-agent-kit.path`로 변경

`install.sh`가 잔재를 감지하면 실행할 명령을 안내하므로, 안내를 확인한 뒤 지워도 된다.

## 9. 테스트

`bash tests/run-all.sh`로 실행한다. 16개 테스트 파일이 있고, 대부분은 외부 의존 없이 동작하는 단위 테스트다. 임시 HOME에서 실행해서 실제 환경을 건드리지 않는다.

지식 저장소 통합 테스트는 임시 PostgreSQL 데이터베이스를 만들어 실제 스키마를 올리고 CLI를 스텁 없이 실행한다. 71개 테스트 케이스가 있다. 전제 조건이 없으면 `SKIP`을 출력하고 `rc=77`로 끝난다.

`grep -P`를 사용하지 않는다. macOS 기본 grep은 이를 지원하지 않으면서 조용히 실패해서 검사가 항상 통과하는 것처럼 보인다. python3 코드포인트 검사로 대체한다. 테스트를 작성하다 발견한 함정이다.

## 10. 남은 과제

이슈 생애주기에 맞춰서, 프로젝트 관계에 맞춰서 잘 동작하고 있으나 아직 도입 초기 단계라 더 지켜봐야 할 것 같다.

Codex의 편집 감지가 조용히 동작하지 않을 수 있다. `apply_patch` 도구가 파일 경로를 payload의 개별 키로 넘기지 않고 patch 텍스트에 포함하는 것 같은데, 라이브 캡처로 확정하지 못했다. 확정되면 `payload.sh`에 patch 텍스트에서 경로를 추출하는 후보 로직을 추가하면 된다.

지식 저장소는 1단계(어휘 검색)다. 벡터 검색과 품질 가중은 임베딩 모델과 한국어 토크나이저를 정한 뒤에 추가된다. 설계는 4단계까지 완료했다: tsvector → BM25 → embedding+HNSW → PG19 SQL/PGQ.

`simple` 토크나이저는 조사가 붙은 한국어를 다른 토큰으로 본다. `기각`으로 질의하면 본문의 `기각한`에는 걸리지 않는다. 문자 바이그램으로 해결했지만, 활용어미는 여전히 분리 토큰으로 잡힌다.

Slack Lists API는 페이지네이션이 구현되어 있지 않아서, 값이 있는 행이 100건을 넘으면 첫 페이지에 없는 컬럼이 누락될 수 있다.

## 참고

- [이슈 드리븐 인프라 운영 자동화 LLM 멀티에이전트 오케스트레이션 시스템 자작](../Tooling/이슈%20드리븐%20인프라%20운영%20자동화%20LLM%20멀티에이전트%20오케스트레이션%20시스템%20자작.md) — 이 글의 전신. 에이전트 오케스트레이션 설계에 대해 다룬다.
- [GitHub Issues 기반 DevOps 작업 관리 체계 설계](../Tooling/GitHub%20Issues%20기반%20DevOps%20작업%20관리%20체계%20설계.md) — 이슈 관리 체계 자체에 대한 글.
- [LLM이 유지관리하는 개인 지식·커리어 위키 만들기](../Tooling/LLM이%20유지관리하는%20개인%20지식·커리어%20위키%20만들기.md) — 지식 저장소의 개인 위키 버전.
