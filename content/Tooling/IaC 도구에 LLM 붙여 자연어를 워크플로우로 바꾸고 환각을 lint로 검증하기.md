---
title: "IaC 도구에 LLM 붙이기: 자연어를 K8s 워크플로우로 바꾸고 환각을 lint로 검증하기"
date: 2026-03-16
draft: false
featured: true
tags:
  - llm
  - iac
  - kubernetes
  - automation
  - tooling
  - deck
banner: 
cssclasses: 
description: 자체 폐쇄망 IaC 도구에 LLM을 붙여 자연어를 워크플로우 YAML로 뽑되, 생성물이 디스크에 닿기 전에 lint를 통과해야만 쓰이도록 게이트를 건 이야기.
permalink: 
aliases: 
completed: true
type:
  - automation
---

## 요약

> [!SUMMARY]
> 선언형 워크플로우를 처음부터 손으로 쓰는 진입장벽을 낮추려고, 폐쇄망용 IaC 도구 <b>Deck</b>에 LLM을 붙여 `deck ask`를 만들었다. 자연어 요청을 워크플로우 YAML로 뽑되, 모델이 생성한 파일은 곧바로 디스크에 쓰지 않고 세션이 소유한 <b>candidate 상태</b>에만 올려두고, `deck_lint`가 통과할 때까지 완료 신호를 거부한다. 큰 요청은 파일 대신 `plan` 아티팩트에서 멈추고, 애매하면 추측 대신 확인 질문을 던진다. LLM 환각을 "믿을 만하게" 만드는 지점을 모델이 아니라 코드에 둔 셈이다.

이 글은 [[폐쇄망 전용 싱글 바이너리 워크플로우 도구 Deck 만들기|Deck 본체 이야기]]에서 이어진다. 그쪽이 "폐쇄망에서 워크플로우 러너를 왜, 어떻게 만들었나"라면, 이 글은 그 위에 얹은 "자연어로 워크플로우를 뽑되 LLM이 지어낸 걸 어떻게 걸러내나"에 대한 기록이다.

## 1. 도입 배경

Deck의 워크플로우는 YAML로 쓴다. `version`, `vars`, `phases`, `steps`에 typed step을 얹는 얕은 구조라 읽기는 쉬운데, 백지에서 처음 쓰는 건 여전히 일이다. `CheckHost`·`KernelModule`·`WriteContainerdConfig`·`InitKubeadm` 같은 kind가 각각 어떤 스키마를 받는지 기억하고 있어야 하고, phase 순서와 조건부 실행(`when`), step 간 출력 등록(`register`)까지 맞물려야 한다. 스키마 문서를 띄워놓고 필드를 하나씩 대조하는 그 초기 마찰이 매번 아까웠다.

그래서 "kubeadm single-node 폐쇄망 워크플로우 하나 만들어줘" 정도의 자연어를 던지면 초안이 나오게 하고 싶었다. 문제는 뻔했다. LLM은 그럴듯한 걸 지어낸다. 존재하지 않는 kind, 오타 난 필드, 스키마에 없는 값을 아무렇지 않게 뱉는다. 그걸 폐쇄망에 그대로 반입해서 `apply`했다가는, 현장에서 몇 시간을 날린다. LLM을 붙이는 것 자체보다 <b>생성물을 어떻게 신뢰 가능하게 만드느냐</b>가 이 기능의 전부였다.

검증을 모델에게 맡기지 않았다. 모델은 후보를 만들 뿐이고, 그게 실제 파일이 될지는 코드가 정한다.

> [!IMPORTANT]
> `deck ask`는 지금도 <b>실험적</b> 기능이다. 그리고 Deck 본체와 같은 단일 바이너리 안에 함께 들어간다. 별도 서비스나 데몬을 띄우지 않는다. 워크플로우 진실(스키마·경로·검증 동작)은 항상 로컬 deck 사실이 권위를 갖고, LLM은 그 위에서 초안을 쓰는 보조일 뿐이라는 선을 처음부터 그었다.

## 2. deck ask의 두 갈래

`deck ask`는 요청이 들어오면 먼저 프롬프트와 현재 워크스페이스를 훑어 라우트를 정한다. 크게 두 갈래다.

- <b>분석 모드</b> (`question`/`explain`/`review`/`plan`): 읽기 전용. 워크스페이스 파일과 deck 로컬 사실, 필요하면 외부 증거를 근거로 답하거나 플랜 아티팩트를 남길 뿐, 워크플로우 파일은 쓰지 않는다.
- <b>작성 모드</b> (`draft`/`refine`): 범위가 제한된 작성 런타임으로 전환해 실제 파일을 만들거나 고친다.

플래그로 경로를 강제하지 않으면 요청을 분류하는데, 안전하게 분류하기 애매하면 섣불리 추측하지 않고 되묻는다. 작성 의도를 못 박고 싶으면 `--create`(draft)나 `--edit`(refine)을 쓴다.

```bash
# 새 워크플로우 초안 작성 (draft)
deck ask --create "create an air-gapped rhel9 single-node kubeadm workflow"

# 기존 워크플로우 다듬기 (refine)
deck ask --edit "add containerd configuration to the apply workflow"

# 읽기 전용 검토 (review)
deck ask --review
```

토폴로지를 두루뭉술하게("cluster") 주면 확인 질문이 늘어서, `single-node`처럼 명시하는 쪽이 실제로 가장 안정적으로 붙었다. 이 경계 감각은 문서로 안내할 수밖에 없는 부분이다.

## 3. 자연어에서 워크플로우 YAML까지

작성 모드로 결정되면, 모델이 뭘 건드리기 전에 코드가 먼저 <b>프리플라이트(preflight)</b>를 돈다. 어떤 파일이 범위에 들어가는지, 정말 누락된 정보 때문에 요청이 막혀 있는지, refine이 앵커 파일 말고 동반 파일까지 손대야 하는지, 빈 워크스페이스라 초기 스캐폴드가 필요한지를 코드가 정한다. 모델에게 "알아서 판단해"를 넘기지 않는 지점이다.

그다음 모델은 단출한 도구 모음으로만 작업한다. `read`, `glob`, `grep`, `file_write`, `file_edit`, `validate`, `schema`, 빈 워크스페이스일 때의 `init`, 외부 증거가 허용되고 필요할 때의 `web_search` 정도다. 임의 셸 실행 같은 건 없다.

여기서 `file_write`와 `file_edit`는 <b>디스크를 건드리지 않는다</b>. 이 도구들은 세션이 소유한 candidate 상태(후보 파일 맵)만 갱신한다. 실제 파일 쓰기는 세션이 성공적으로 끝난 뒤에야, `deck ask`가 한 번에 처리한다. 중간에 뭐가 잘못돼도 워크스페이스는 원래 그대로다. 별도 롤백 절차가 필요 없는 이유가 여기 있다. 실패하면 아무것도 안 쓰는 게 기본값이다.

빈 워크스페이스에서는 작성 런타임이 내부 `init` 도구를 먼저 부를 수 있는데, 이건 생성할 파일에 필요한 최소한의 디렉터리와 ignore 파일, 출력용 `.keep`만 준비한다. 전체 `deck init`을 돌리거나 템플릿을 까는 게 아니다. 작성 모드가 딱 자기 범위만 건드리게 묶어둔 것이다.

## 4. lint 게이트

환각을 거르는 실제 장치는 lint다. candidate 상태는 그 자체로는 아무 보증이 없다. 모델이 `InitKubeadmm`(오타) 같은 걸 써도 candidate에는 일단 올라간다. 그래서 <b>완료(finish)를 lint에 종속</b>시켰다.

작성 세션은 셋 중 하나에 이를 때까지 반복한다.

- `deck_lint`(내부적으로는 `validate`)가 통과하고 모델이 finish를 부름
- `deck ask`가 차단 요인을 감지하고 확인 질문으로 되물음
- 세션이 턴 예산에 도달함 (`--max-iterations`, draft/refine에만 적용)

모델이 "다 했다"고 finish를 불러도, 그 턴에 lint가 통과한 상태가 아니면 코드가 거부한다. 실제로 finish 처리부에는 이런 가드가 박혀 있다.

```go
// 이번 세션에서 deck_lint가 통과하지 않았으면 finish를 받아들이지 않는다.
if !s.lastLintPassed {
    s.appendSyntheticFailure(turn, authorToolFinish, "finish rejected until deck_lint succeeds in this session")
    // ...
}
// candidate 파일이 하나도 없어도 finish 거부
if len(s.candidateByPath) == 0 {
    s.appendSyntheticFailure(turn, authorToolFinish, "finish rejected because no candidate files have been written")
    // ...
}
```

lint 자체는 겉핥기가 아니다. candidate 파일을 임시 워크스페이스로 스테이징한 뒤, 개별 파일 검증부터 시나리오 엔트리포인트 파싱(`validate.EntrypointWithContext`), plan 계약 검증, 의미 수준 비평(semantic critic)까지 거친다. 여기서 나오는 지적은 blocking과 advisory로 나뉜다. blocking이 하나라도 있으면 lint는 실패로 떨어지고, 모델은 그 진단을 받아 다음 턴에 고쳐야 한다. "존재하지 않는 kind", "필수 필드 누락" 같은 게 여기서 걸린다.

검증과 범위 강제를 코드 레벨에 뒀다. 모델이 아무리 자신 있게 완료를 선언해도, lint를 통과한 candidate가 아니면 디스크에 닿지 못한다.

## 5. plan 모드와 확인 질문

한 번에 좋은 결과를 뽑기엔 요청이 너무 크거나 모호할 때가 있다. 그때 파일을 억지로 쓰게 두면 빈약한 워크플로우가 나온다. 그래서 두 개의 안전판을 더 뒀다.

<b>plan 모드.</b> `deck ask plan`은 파이프라인 앞부분(프롬프트 이해·워크스페이스 점검·차단 요인 도출)은 공유하되, 워크플로우 파일 대신 `./.deck/plan/` 아래 구현 아티팩트에서 멈춘다. 큰 작업을 바로 코드로 떨구지 않고, 계획을 먼저 눈으로 확인하는 단계다.

```bash
# 큰 요청은 먼저 plan으로 (읽기 전용, 파일은 안 씀)
deck ask plan "air-gapped rhel9 kubeadm cluster with prepare/apply split"

# 확인이 필요한 항목은 --answer로 채워 저장된 플랜에서 이어감
deck ask plan --from .deck/plan/latest.json --answer topology.kind=multi-node

# 확정된 플랜을 실제 작성으로 넘김
deck ask --from .deck/plan/latest.md "implement this plan"
```

<b>확인 질문.</b> 요청에 차단 요인이 남아 있으면 `deck ask`는 추측해서 뭔가를 쓰는 대신 계획 단계에서 멈춘다. 노드가 몇 대인지, 컨트롤플레인/워커 배치가 어떻게 되는지처럼 워크플로우 정확성을 좌우하는 값을 임의로 지어내지 않는다. LLM이 가장 자주 사고 치는 게 "모르는 걸 아는 척 채우는" 지점인데, 그걸 애초에 막아두는 쪽을 택했다.

세션 트랜스크립트와 도구 결과는 `./.deck/ask/` 아래에 남고, 디버깅용 `last-agent-session.json`도 함께 떨어진다. 모델이 왜 그런 결정을 했는지 나중에 되짚을 수 있어야 했다.

## 6. 로컬 사실과 외부 증거의 경계

붙이면서 계속 신경 쓴 게 "무엇을 권위로 삼느냐"였다. 두 종류의 사실을 섞지 않았다.

- <b>워크플로우 진실</b>(경로, 스키마, typed step, 검증 동작)은 deck 로컬 사실이 권위를 갖는다. 여기엔 외부 조회가 끼어들 여지를 안 줬다. 모델이 웹에서 주워온 그럴듯한 스키마보다, 이 바이너리가 실제로 파싱하는 스키마가 항상 옳다.
- <b>업스트림 제품 사실</b>(설치 절차, 버전별 호환성, 문제 해결)은 최신성이 필요할 수 있어서, 외부 증거를 선택적으로 붙였다. 작성 모드에서는 매번 미리 긁어오는 대신 루프 안의 선택 도구(`web_search`, MCP)로 노출했다.

제공자는 `openai`·`openrouter`·`gemini`를 지원한다. 제공자·모델·엔드포인트는 `config set`으로 한 번 저장해두면 되고, API 키는 워크플로우나 repo에 박지 않도록 `DECK_ASK_API_KEY` 환경변수로 주입한다.

```bash
# 제공자·모델·엔드포인트를 한 번 저장해 둔다.
deck ask config set \
  --provider openai \
  --model <chat-model> \
  --endpoint https://api.openai.com/v1

# 키는 환경변수로 주입한다. (config set --api-key 로 저장하면 XDG config 파일에 들어간다)
export DECK_ASK_API_KEY="..."

# 외부 증거(MCP) 제공자 상태 점검
deck ask config health
```

## 7. 한계

아직 실험 딱지를 못 뗐다. 작성 라우트는 모델 접근에 전적으로 의존해서, 모델을 못 부르면 그냥 빠르게 실패한다. 로컬 검증이 생성을 대신할 수는 없으니 어쩔 수 없는 부분이긴 하다. `explain`·`review`는 모델이 없을 때 제한적인 로컬 폴백만 준다.

lint 게이트가 걸러주는 건 "구조적으로 틀린 것"까지다. lint를 통과하는 의미상 나쁜 워크플로우(맞긴 한데 이 현장엔 안 맞는 구성)는 여전히 사람이 봐야 한다. 그래서 큰 건 plan으로 한 번 끊고 눈으로 확인하는 흐름을 권하는 쪽으로 갔다. 이 기능이 없애준 건 "백지의 마찰"이다. "리뷰의 책임"은 여전히 사람 몫이다.

kind 네이밍이나 라우트 분류 경계처럼 Deck 본체에서도 계속 의심하던 지점들이, LLM을 붙이니 그대로 프롬프트와 분류기의 애매함으로 옮겨왔다. 자연어라는 입력이 원래 그런 것이긴 한데, 어디까지 코드로 강제하고 어디부터 모델에게 맡길지는 지금도 조정 중이다.

## 참고

- [Deck (GitHub)](https://github.com/Airgap-Castaways/deck)
- [OpenAI API Reference](https://platform.openai.com/docs/api-reference)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [[폐쇄망 전용 싱글 바이너리 워크플로우 도구 Deck 만들기]]
