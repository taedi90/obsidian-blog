---
title: "GitHub Issues 기반 DevOps 작업 관리 체계 설계: 타입·계층·상태 표준화"
date: 2026-03-31
draft: false
tags:
  - github-issues
  - devops
  - process
  - project-management
  - automation
banner: 
cssclasses: 
description: DevOps 요청과 작업이 메모로 흩어지는 문제를, 라벨·계층·프로젝트 필드·템플릿으로 표준화해 검색·집계·자동화가 되는 운영안으로 정리한 기록.
permalink: 
aliases: 
completed: true
type:
  - improvement
---

## 요약

> [!SUMMARY]
> DevOps 요청과 작업이 슬랙 DM, 개인 메모, 리포 안 마크다운으로 흩어져서 "그거 어떻게 됐어요"에 답을 못 하는 상태였다. 이걸 GitHub Issues 하나로 모으면서, 이슈 타입은 저장소 라벨 `type/*`로 단일화하고, 계층은 `Epic → Issue → Sub-issue`로 고정하고, 상태·우선순위·영향도·SLO 같은 운영 메타데이터는 라벨이 아니라 GitHub Project 필드로 뺐다. 타입별 템플릿과 Request 파생 규칙까지 정해서, 검색·집계·자동화가 가능한 작업 관리 운영안으로 만들었다.

## 1. 도입 배경

DevOps 팀에 들어오는 일은 형태가 제각각이다. "이 서버 포트 좀 열어주세요" 같은 단발 요청, 며칠 걸리는 개선 작업, 새벽에 터지는 장애, 배포 창구 조정. 문제는 이게 전부 <b>추적되지 않는 채로</b> 들어온다는 거였다. 요청은 슬랙 DM으로 오고, 작업 메모는 각자 노션이나 리포 안 마크다운 파일에 쌓이고, 장애 대응은 기억에 의존했다.

그래서 흔히 겪는 증상이 다 있었다.

- "그거 지금 누가 보고 있어요?"를 물어보고 다녀야 했다. 담당·상태가 한 곳에 없으니까.
- 같은 요청이 두 번 들어와도 처음 것을 찾지 못했다.
- 장애가 끝나면 그걸로 끝이었다. 재발 방지 작업이 이슈로 남지 않으니 다음에 또 똑같이 당했다.
- "이번 분기에 우리가 뭘 했지"를 집계하려면 사람 기억을 긁어모아야 했다.

리포에는 이미 마크다운 파일로 쌓아둔 작업 메모가 여럿 있었다. 그런데 파일은 실행 상태를 추적하지 못한다. 열려 있는지 닫혔는지, 누가 하는지, 언제까지인지가 파일에는 안 담긴다. 어차피 코드는 GitHub에 있으니, 작업도 같은 곳에서 이슈로 관리하면 되는 거였다. 도구를 새로 사는 게 아니라 이미 쓰는 도구를 제대로 쓰는 쪽으로 방향을 잡았다.

## 2. 이슈 타입과 `type/*` 라벨

먼저 정한 건 "이슈를 어떻게 분류할 것인가"였다. GitHub에는 조직 전체에 걸리는 `issue type` 기능이 있는데, 이걸 안 쓰기로 했다.

이유는 단순하다. `issue type`은 조직 전체에 영향을 준다. DevOps 저장소 하나 운영하자고 조직 공통 분류 체계를 건드리는 건 범위가 안 맞았다. 그래서 저장소 라벨 <b>`type/*`</b>을 분류 기준으로 삼았다. 템플릿, triage, 검색, 집계, 자동화를 전부 이 라벨 하나에 걸었다.

규칙은 하나만 지키게 했다. <b>모든 이슈는 반드시 `type/*` 라벨을 정확히 하나 가진다.</b> 여러 개도 안 되고 없는 것도 안 된다. 이게 있어야 나중에 "이번 달 incident 몇 건" 같은 집계가 라벨 필터 한 번으로 나온다.

타입은 다섯 개로 끊었다.

- `type/task`: 계획된 작업. 기능 추가, 운영 개선, 문서화, 자동화 구축.
- `type/bug`: 기대 동작과 실제 동작이 다른, 재현 가능한 결함.
- `type/incident`: 실제 운영 장애. 즉시 대응부터 원인 분석, 재발 방지까지.
- `type/change`: 인프라·설정·배포 변경. 위험도·검증·롤백 계획이 필수인 것들.
- `type/request`: 타 팀이나 사용자의 요청. 수용 여부 판단이 먼저인 항목.

경계가 애매한 조합이 항상 생긴다. 그래서 헷갈리는 짝만 따로 기준을 적어뒀다.

- <b>Task vs Incident</b>: Task는 계획된 실행, Incident는 이미 터진 상황. 장애 후속 개선은 Incident의 후속 Task로 뗀다.
- <b>Bug vs Incident</b>: Bug는 결함 자체 수정, Incident는 운영 영향이 실제로 난 사건. 장애를 유발한 결함은 둘로 나눠 관리할 수 있다.
- <b>Change vs Task</b>: 운영 환경을 건드리면 가능한 한 Change. 롤백 계획을 강제하고 싶어서다.
- <b>Request vs Task</b>: Request는 접수와 판단이 먼저다. 승인되면 별도 실행 이슈를 새로 만든다.

## 3. Epic, Issue, Sub-issue 계층

두 번째는 계층이다. 큰 일과 작은 일을 같은 평면에 두면 목록이 금방 지저분해진다. 그래서 3단으로 고정했다.

`Epic → Issue → Checklist 또는 Sub-issue`

- <b>Epic</b>: 여러 작업을 묶는 상위 단위. 목표·범위·완료 조건을 정의하고, 구현 상세는 안 담는다. 별도 타입을 만들지 않고 <b>일반 Issue에 `epic` 라벨</b>을 붙여 운영한다.
- <b>Issue</b>: 담당자가 실제로 처리하는 기본 실행 단위. 하나의 목적과 명확한 완료 기준을 가진다.
- <b>Sub-issue</b>: Issue를 더 쪼갠 것.

여기서 자주 헷갈리는 게 "이걸 Sub-issue로 뗄까, 체크리스트로 둘까"다. 기준을 명시해뒀다. 담당자가 다르거나, 일정을 따로 추적해야 하거나, 독립적인 리뷰·배포·검증이 필요하거나, 진행 상태를 개별로 보고해야 하면 <b>Sub-issue</b>로 분리한다. 반대로 같은 담당자가 하루 안에 끝낼 수 있고 별도 상태 추적이 필요 없으면 부모 이슈 안 <b>체크리스트</b>로 둔다.

계층을 표현할 때 라벨이나 본문 텍스트로 흉내 내지 않게 했다. 본문에 `Parent`, `Child Issues` 목록을 손으로 유지하면 금방 실제와 어긋난다. GitHub의 native [Sub-issues 기능](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues)으로만 부모-자식을 연결하고, 그게 유일한 계층 소스가 되도록 했다.

## 4. Request 처리와 파생 관계

Request를 다루는 방식이 이 운영안에서 제일 신경 쓴 부분이다. 처음엔 "요청이 들어오면 그 이슈를 실제 작업 이슈로 상태를 바꿔가며 쓰면 되지 않나" 싶었는데, 그렇게 하면 접수 기록과 실행 기록이 한 이슈에 뒤섞인다. 나중에 "무슨 요청이 몇 건 들어왔나"와 "그래서 실제로 뭘 했나"를 둘 다 잃는다.

그래서 Request는 <b>접수와 판단만 기록</b>하는 이슈로 못 박았다. 실행이 필요하면 Request의 타입을 바꾸지 않고 후속 이슈를 새로 만든다. 그리고 이 관계는 계층이 아니라 <b>파생 관계</b>로 관리한다.

- `Epic → Issue → Sub-issue`만 부모-자식 계층으로 쓴다.
- `Request → Task/Bug/Incident/Change/Epic`은 부모-자식이 아니라 파생이다. Request를 실행 이슈의 부모로 걸지 않는다.
- 실행 단위가 하나면 Request에서 실행 이슈 1건, 여러 개면 먼저 Epic을 만들고 그 아래에 실행 이슈를 붙인다.

대신 서로 링크는 반드시 남긴다. Request 본문에는 `Follow-up Issues` 섹션에 파생된 이슈를 나열하고, 후속 이슈 본문에는 `Source` 섹션에 원본 Request를 적는다. Epic이 낀 경우 `Request → Epic → 실행 이슈`가 링크로 다 보이게 한다. 이렇게 해두니 Request는 결정만 나면 닫을 수 있고, 실제 진행 추적은 후속 이슈들이 맡는다. 접수와 실행의 책임이 깔끔하게 갈린다.

## 5. 운영 메타데이터와 Project 필드

라벨로 상태·우선순위까지 다 표현하려는 유혹이 있다. `status/in-progress`, `priority/p0`, `impact/high` 같은 라벨을 만들기 시작하면 끝이 없고, 이슈 하나에 라벨이 열 개씩 붙는다. 그래서 선을 그었다. <b>라벨은 `type/*`과 `epic`만.</b> 나머지 운영 메타데이터는 전부 [GitHub Project 필드](https://docs.github.com/en/issues/planning-and-tracking-with-projects/understanding-fields/about-text-and-number-fields)로 뺐다.

<b>Status</b>는 이슈의 생명주기다.

- `Todo`: 아직 시작 안 함 (생성 시 기본값)
- `In progress`: 진행 중
- `Blocked`: 외부 의존성이나 장애물로 진행 불가. 원인을 같이 기록한다.
- `Review`: 구현 완료, 검토·승인·검증 대기
- `Done`: 완료. 체크리스트와 완료 기준을 갱신한 뒤 넘긴다.
- `Canceled`: 중단·폐기. 사유를 남긴다.

<b>Priority</b>는 `P0`(즉시 대응, 서비스 안정성·핵심 일정에 직접 영향), `P1`(빠른 대응, 단기 일정 내 처리), `P2`(계획된 일정으로 처리 가능) 세 단계.

<b>Impact</b>는 영향 범위다. `Low`(제한된 내부 영향), `Medium`(특정 팀·일부 서비스), `High`(다수 사용자·핵심 서비스), `Critical`(광범위한 장애나 중대한 운영 리스크).

<b>SLO</b>는 `Breached`(위반 발생), `At risk`(위반 가능성 높음), `None`(직접 관련 없음). 장애·변경 이슈에서 SLO 상태를 붙여두면 사후에 "이 작업이 SLO를 건드렸나"를 되짚기 쉽다.

라벨은 GitHub 조직/저장소 어디서나 텍스트로 남지만, 필드로 관리하면 Project 보드에서 정렬·필터·그룹핑이 된다. Priority로 정렬하고 Status로 칼럼을 나누는 게 라벨로는 안 되는 일이라 굳이 필드로 옮겼다.

## 6. 타입별 템플릿

타입을 나눠도 사람마다 본문 채우는 방식이 다르면 집계가 안 된다. 그래서 타입별로 [Issue Template](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/configuring-issue-templates-for-your-repository)을 만들어 최소한의 뼈대를 강제했다. 예를 들어 Change 템플릿은 이렇게 잡았다. 위험도·검증·롤백을 비워두고 넘어가지 못하게 하는 게 목적이다.

```md
## 1. Change Summary
무엇을 변경하는지

## 2. Source
- Request:

## 3. Type
- [ ] Infra
- [ ] Config
- [ ] Deployment

## 4. Risk
- Low / Medium / High

## 5. Change Window
적용 일정 또는 배포 시간

## 6. Approver
승인자

## 7. Validation
검증 방법

## 8. Rollback Plan
롤백 방법
```

Incident 템플릿은 탐지 시각·영향·임시 조치·추정 원인을 받고, 마지막에 `Follow-up Actions`로 재발 방지 작업 생성을 유도한다. 장애가 그냥 닫히고 끝나는 걸 막으려는 장치다.

```md
## 9. Incident Summary
무슨 사건이 발생했는지

## 10. Detected At
발생 또는 탐지 시각

## 11. Impact
영향 서비스, 사용자, 팀

## 12. Severity
- Low / Medium / High / Critical

## 13. Detection
어떻게 탐지했는지

## 14. Mitigation
임시 조치 또는 즉시 대응

## 15. Suspected Root Cause
추정 원인

## 16. Follow-up Actions
- [ ] 원인 분석
- [ ] 영구 조치
- [ ] 재발 방지 작업 생성

## 17. Done Criteria
사건 종료 기준과 후속 조치 완료 기준
```

공통으로 owner·reviewer·approver·due date·관련 서비스·parent·source request 같은 메타데이터는 본문이나 Issue Form 필드로 받게 했다. 완료 기준(`Done Criteria`)이 없는 이슈는 작업 시작 전에 채우는 걸 규칙으로 뒀다. "끝났다"의 정의가 없으면 이슈가 영영 안 닫히기 때문이다.

## 7. 자동화로 넘어갈 여지

이 표준화의 진짜 목적은 사실 자동화다. 사람이 규칙을 다 지키리라 기대하는 건 순진하고, 결국 뭔가는 빠진다. 그래서 [GitHub Actions](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows)로 걸 수 있는 규칙을 미리 염두에 두고 스키마를 짰다.

- `type/*` 라벨이 없는 이슈에 triage 필요 표시를 붙인다.
- `type/incident`가 생성되면 `Priority=P0` 검토를 유도한다.
- `Done Criteria`가 비어 있으면 Review로 넘어가기 전에 보완을 요청한다.
- Request와 후속 이슈 사이에 상호 링크가 없으면 보완을 요청한다.

라벨 하나에 타입을 몰아넣고, 계층을 native 기능으로만 표현하고, 메타데이터를 필드로 빼둔 게 전부 여기서 값을 한다. 분류 기준이 `type/*` 하나로 고정돼 있으니 Actions에서 조건을 걸기가 단순하다. 자동화는 아직 붙이기 전이고, 지금은 규칙과 스키마부터 정해둔 단계다.

돌아보면 대단한 기술이 들어간 작업은 아니다. 라벨 몇 개, 필드 몇 개, 템플릿 다섯 개. 그런데 "작업이 어디 있는지 아무도 모른다"에서 "필터 한 번이면 나온다"로 바뀌는 데는 이 정도면 충분했다. 도구를 더 산 게 아니라 이미 있던 GitHub Issues의 규칙을 정한 것뿐이다.

## 참고

- [About issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/about-issues)
- [Adding sub-issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues)
- [About Projects](https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects)
- [Configuring issue templates](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/configuring-issue-templates-for-your-repository)
