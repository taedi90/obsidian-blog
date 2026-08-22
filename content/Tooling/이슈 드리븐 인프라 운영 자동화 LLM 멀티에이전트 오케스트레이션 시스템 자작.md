---
title: "이슈 드리븐 인프라 운영 자동화: LLM 멀티에이전트 오케스트레이션 시스템 자작"
date: 2025-10-10
draft: false
featured: true
tags:
  - llm
  - multi-agent
  - mcp
  - kubernetes
  - automation
  - devops
banner: 
cssclasses: 
description: 반복되는 인프라 운영과 트러블슈팅을, 이슈 기반 워크플로우와 역할별 에이전트로 묶어 컨텍스트와 히스토리를 표준화한 운영 보조 시스템을 직접 설계한 기록.
permalink: 
aliases: 
completed: true
type:
  - automation
---

## 요약

> [!SUMMARY]
> 인프라 운영·트러블슈팅이 매번 "로그 긁고 → 원인 찾고 → 고치고 → 검증하고 → 문서 남기고 → 이슈 닫고"를 반복하는데, 그 절차가 사람 머릿속에만 있었다. 이 절차를 메인 오케스트레이터 하나와 역할별 서브에이전트(investigator/implementer/test-engineer/security-auditor/documentation-specialist/issue-manager)로 나누고, 상태는 대화 히스토리 대신 `workspace/`의 JSON 파일로 관리하도록 만들었다. GitHub 이슈를 작업 단위로 삼고, MCP로 Kubernetes·GitHub·검색을 연결했으며, 런북·노트 템플릿과 IaC 서브모듈까지 한 저장소로 묶은 운영 보조 시스템을 직접 설계했다.

이 글은 <b>장애 잡는 절차 자체를 어떻게 자동화·표준화했나</b>에 대한 기록이다. AI 에이전트를 실무 파이프라인에 끼워 넣는 게 주제라, 뒤에 나오는 코드와 프롬프트 골격은 전부 내가 짠 것이다.

## 1. 도입 배경

혼자 여러 클러스터를 맡다 보면 트러블슈팅이 대부분 비슷한 모양으로 반복된다. 파드가 죽었다는 소식을 들으면 로그를 수집하고, 이벤트를 확인하고, 비슷한 사례를 검색하고, 원인을 짚고, 수정하고, 정상 동작하는지 확인하고, 노트를 남기고, 이슈를 닫는다. 순서는 늘 같은데 그 순서가 어디에도 기록되어 있지 않고 내 손버릇으로만 유지되고 있었다.

문제는 두 가지였다.

- 작업 컨텍스트가 매번 휘발되었다. "저번에 그 노드 왜 그랬더라"를 다시 조사해야 했다. 히스토리가 이슈 코멘트와 로컬 메모, 기억에 흩어져 있었다.
- LLM에게 시키면 편하지만 대화가 길어질수록 앞 내용을 놓치거나 로그를 요약하다 없는 사실을 지어냈다. 긴 로그를 통째로 유지하라고 요구하면 특히 심했다.

그래서 방향을 <b>절차를 파일과 역할로 고정해 두고 그 위에서 LLM을 운영하기</b>로 잡았다. 절차가 코드로 남으면 나중의 나도, 다른 사람도 같은 순서로 작업할 수 있다(아마 그 다른 사람도 미래의 나일 가능성이 높지만).

## 2. 오케스트레이터와 서브에이전트 구조

큰 그림은 단순하다. 판단은 하나가 담당하고, 실행은 여럿이 담당한다.

메인 에이전트(오케스트레이터)는 직접 손을 대지 않는다. 상황을 읽고, 계획을 세우고, 어떤 서브에이전트를 호출할지 정하고, 결과를 상태 파일로 남기는 데만 집중한다. 실제 `kubectl apply`나 로그 수집, 검증 같은 작업은 역할이 정해진 서브에이전트에게 위임한다.

이렇게 나눈 이유는 컨텍스트 분리다. 메인이 로그 원문을 모두 유지하면 금방 오염된다. 대신 서브에이전트가 로그를 확인해서 <b>요약된 JSON</b>만 돌려주게 하고, 메인은 그 JSON만 신뢰한다. 메인 프롬프트에는 아예 다음과 같이 명시해 두었다.

```markdown
# 메인 오케스트레이터 원칙 (CLAUDE.md 발췌)
1. Orchestrator Pattern: 분석/계획은 Main이, 실행/검증은 Subagent에게 위임한다.
2. Stateless Context: 대화 히스토리 대신 workspace/ 내 JSON 파일로 상태를 유지한다.
3. 환각 방지: 로그·파일 원문을 통째로 기억하려 하지 말고, Subagent가 요약한 JSON만 신뢰한다.
```

간단한 `kubectl get`이나 단일 파일 읽기, 사용자 의사결정 지원까지 굳이 위임하면 오히려 느려지므로, 그런 작업은 메인이 직접 수행한다. 어디까지 위임할지 경계를 긋는 데 많은 노력이 필요했다.

## 3. 파일 기반 상태 관리

이 시스템에서 공들인 부분은 에이전트 자체보다 <b>상태 관리 프로토콜</b>이다. 모든 작업은 이슈 번호 폴더 안에서만 진행한다.

```
workspace/
├── tasks/ISSUE-{N}/           # 진행 중인 작업
│   ├── current_task/          # '기억'에 해당하는 JSON들
│   │   ├── investigation.json   # 원인 + 해결책 제안(2~3안)
│   │   ├── plan.json            # 선택된 해결책의 실행 계획
│   │   ├── implementation.json  # 실행 결과
│   │   └── verification.json    # 검증 결과
│   └── temp/                  # 임시 파일 (/tmp 금지)
└── history/tasks/ISSUE-{N}/   # 완료된 작업 아카이브 (Git 관리)
```

각 단계가 다음 단계로 넘어갈 때 대화로 전달하는 것이 아니라 JSON을 작성해서 전달한다. 그래서 세션이 끊겨도, 며칠 뒤에 다시 열어도, 해당 폴더만 읽으면 "어디까지 했는지"가 복원된다. `current_task.json`을 작업의 <b>SSOT(Single Source of Truth)</b>로 두고, 작업이 끝나면 폴더째로 `history/`로 옮겨 커밋한다. 이렇게 하면 이슈 하나가 통째로 감사 로그가 된다.

예를 들어 investigator가 출력하는 `investigation.json`은 다음과 같은 모양이다. 원인만 기재하는 것이 아니라 해결책을 위험도까지 붙여 여러 안으로 제안하게 했다.

```json
{
  "root_cause_analysis": {
    "primary_cause": "노드의 컨테이너 런타임이 Pod Sandbox를 정리하지 못함",
    "confidence_level": "high",
    "evidence": ["kubelet 로그 스니펫", "이벤트 메시지"]
  },
  "suggested_solutions": [
    { "id": "sol-1", "title": "파드를 정상 노드로 이동", "risk": "low",
      "verification": { "complexity": "simple", "method": "kubectl get pod" } },
    { "id": "sol-2", "title": "해당 노드 런타임 재시작", "risk": "high",
      "verification": { "complexity": "moderate", "method": "노드 Ready 확인" } }
  ]
}
```

메인은 이 JSON을 받아 사람이 읽을 요약으로 바꾸고 나에게 "1안/2안 중 무엇으로 갈까요"를 묻는다. 결정은 사람이 하고, 그 결정도 `decisions.json`에 남는다.

## 4. 이슈 기반 워크플로우

작업의 시작과 끝을 GitHub 이슈에 묶었다. 별도 티켓 시스템을 새로 만드는 대신, 이미 쓰던 이슈를 그대로 워크플로우의 상태 기계로 활용했다. `issue-manager` 에이전트가 이 생명주기를 전담한다.

- <b>시작</b>: 이슈 생성(제목 `Type: 한글 제목`, `workflow:*`·`priority:*`·`env:*` 라벨), 본문에 진행 단계 체크리스트, `workspace/tasks/ISSUE-{N}/` 초기화.
- <b>진행</b>: 서브에이전트가 한 단계 끝낼 때마다 체크리스트를 `[ ]`에서 `[x]`로 바꾸고, 결과 요약을 한글 코멘트로 남김.
- <b>종료</b>: 문서화가 끝나면 커밋(서브모듈 먼저, 메인 나중), 아카이브 이동, 이슈 close.

`git push`는 반드시 내 명시적 승인을 받은 뒤에만 실행하도록 제한했다. 프로덕션 변경(`apply`)도 마찬가지다. 에이전트가 임의로 원격 저장소를 변경하는 상황이 가장 위험하기 때문에, 파괴적이거나 되돌리기 어려운 동작 앞에는 사람 승인 게이트를 두었다.

## 5. 역할별 에이전트

서브에이전트는 역할과 도구 권한을 좁게 나눠서 구성했다. 한 에이전트가 모든 것을 처리하게 두면 결국 메인과 똑같이 오염되고, 권한도 과도해진다. 각자 사용할 수 있는 도구(tools)를 프론트매터에서 제한했다.

| 역할 | 에이전트 | 하는 일 | 권한 성격 |
| :--- | :--- | :--- | :--- |
| Manager | `issue-manager` | 이슈 생성/종료, 커밋/푸시 | GitHub·Git 전담 |
| Analyst | `investigator` | 로그 수집, 원인 분석, 해결책 2~3안 제안 | <b>Read-Only</b> (조회만) |
| Executor | `implementer` | kubectl/Ansible/Helm 실행, 파일 수정 | 변경 권한 |
| Tester | `test-engineer` | 복잡한 검증, 안정성 모니터링 | 조회 + 임시 파드 |
| Auditor | `security-auditor` | RBAC·Secret·NetworkPolicy 정적 검사 | 스캔 전용 |
| Scribe | `documentation-specialist` | 작업 노트·런북 작성 | 파일 쓰기 |

특히 investigator는 <b>진단만 하고 실행은 하지 않는다</b>. `get`·`logs`·`describe`만 허용되고 `apply`·`edit`는 프롬프트로 금지시켰다. 조사하다가 즉흥적으로 수정해 버리는 사고가 사람이든 LLM이든 흔하게 발생하기 때문이다. 진단과 실행을 같은 에이전트에게 주면 그런 사고가 잘 생긴다.

security-auditor는 변경된 파일에서 하드코딩된 키와 `privileged: true`, 와일드카드 RBAC, NetworkPolicy 부재 같은 문제를 점검하고 등급(A~F)을 매긴다. CRITICAL이 하나라도 나오면 등급 F로 작업을 차단하고 승인을 요구하게 했다. 완벽한 보안 검사는 아니지만, "키를 그대로 커밋에 포함하는" 흔한 사고를 한 겹 걸러주는 정도는 한다.

## 6. MCP로 외부 도구 붙이기

에이전트가 실제로 무언가를 수행하려면 외부 환경에 접근해야 한다. 여기를 전부 <b>MCP(Model Context Protocol)</b>로 연결했다. 연결한 서버는 대략 다음과 같다.

- `kubernetes-mcp-server`: 클러스터 리소스 조회·조작. API 호출이라 무료이므로 최우선으로 사용하게 했다.
- `github`: 이슈/코멘트/커밋. issue-manager 전용.
- `filesystem`: `workspace/` 상태 파일 조작.
- `web-search`, `context7`: 유사 사례 검색과 공식 문서 참조. investigator가 근본 원인을 짚을 때 로그만 보지 말고 외부 사례까지 종합하라고 연결했다.
- `gemini-cli`: 대용량 로그 요약·문서 생성처럼 토큰을 많이 소비하는 작업은 저비용 모델로 넘긴다.

긴 로그를 비싼 모델에게 통째로 입력하는 것이 가장 큰 낭비다. 그래서 "로그 패턴 요약은 Gemini, 판단은 메인"으로 역할을 나눴다. `.mcp.json`에 서버를 선언해 두면 되는데, 토큰이나 API 키는 당연히 파일에 평문으로 두면 안 되므로 환경변수로 주입한다.

```jsonc
// .mcp.json — 서버 선언 예시 (키는 환경변수로 주입)
{
  "mcpServers": {
    "github": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "GITHUB_PERSONAL_ACCESS_TOKEN",
               "ghcr.io/github/github-mcp-server"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "<REDACTED>" }
    },
    "kubernetes-mcp-server": { "command": "npx", "args": ["mcp-server-kubernetes"] }
  }
}
```

> [!IMPORTANT]
> MCP를 연결하는 순간 에이전트가 실제 클러스터를 조작할 수 있게 된다. 그래서 investigator처럼 조회만 필요한 에이전트에는 변경 계열 MCP를 아예 주지 않는 것이 중요하다. 편의보다 권한 최소화가 먼저다.

## 7. 런북·노트 템플릿과 IaC 서브모듈

시스템의 마지막 부분은 결과물을 남기는 부분이다. 작업이 끝나면 `documentation-specialist`가 두 가지를 작성한다.

- <b>노트</b>: `note/{type}/ISSUE-{N}_{title}.md`. 개요 → 실행 내용 → 검증 결과 → 롤백 가이드 순서로 고정했다. 이번 작업이 무엇이었는지 사람이 읽을 기록이다.
- <b>런북</b>: 트러블슈팅 건이면 `runbook/{category}/{problem}.md`에 사례를 누적한다. 같은 증상이 또 나타나면 "저번에는 이렇게 해결했다"를 바로 찾을 수 있다.

둘 다 `template/` 밑의 템플릿을 기준으로 생성해서 문서 형식이 제각각이 되지 않게 했다. 노트가 매번 다른 형식이면 결국 아무도 읽지 않는다.

IaC 저장소(Ansible 플레이북)는 <b>Git 서브모듈</b>로 이 저장소 아래에 붙여 두었다. 운영 보조 시스템과 실제 인프라 코드를 한 작업 공간에서 다루되, 버전은 각자 관리하려는 의도다. implementer가 서브모듈 경로에서 플레이북을 실행하고, 커밋도 서브모듈을 먼저 만들고 메인을 나중에 만든다.

클러스터 접속 정보(IP·kubeconfig·계정)는 코드에 명시하지 않고 `environments/clusters/{name}/`에 따로 두었다. 에이전트는 작업 전에 반드시 이 경로를 먼저 읽어 접속 정보를 확보하고, 없으면 IP를 추측해서 실행하지 못하도록 차단했다. 접속 정보를 추측으로 채우는 순간 엉뚱한 클러스터를 조작할 수 있으므로, 여기만큼은 엄격하게 잠갔다.

## 8. 한계

아직 사람 승인 게이트가 여러 곳에 있어서 완전 무인은 아니다. 애초에 그것을 목표로 한 것도 아니다. 되돌리기 어려운 동작 앞에는 사람이 개입하도록 해 두었다. 지금 이 시스템이 확보해 준 것은 결정을 위한 재료를 표준화된 형태로 빠르게 모아 주는 것이지, 나 대신 결정해 주는 것이 아니다.

재사용할 만한 골격은 역할 분리, 상태 파일, 승인 게이트다. 도구가 Claude든 다른 무엇이든, 프롬프트 한 번으로 모두 시키기보다 <b>절차를 파일과 역할로 나눠 두는 편</b>이 실무에서는 확실히 덜 위험했다.

## 참고

- [Model Context Protocol](https://modelcontextprotocol.io)
- [Claude Code Subagents](https://docs.claude.com/en/docs/claude-code/sub-agents)
- [Claude Code MCP](https://docs.claude.com/en/docs/claude-code/mcp)
- [GitHub MCP Server](https://github.com/github/github-mcp-server)
