---
title: Jenkins·GitOps·ArgoCD 배포를 Slack 봇 하나로 묶기
date: 2026-07-01
draft: false
featured: true
tags:
  - chatops
  - slack
  - jenkins
  - gitops
  - argocd
  - golang
  - cicd
  - deployment
banner: 
cssclasses: 
description: Jenkins·GitOps PR·ArgoCD로 흩어져 각 단계를 따로 확인하고 곳곳에 수작업이 끼던 배포를, 직접 만든 Slack 봇으로 한 프로세스로 묶고, 초기 버전의 신뢰성 문제를 잡아 업그레이드한 기록.
permalink: 
aliases: 
completed: true
type:
  - tooling
---

## 요약

> [!SUMMARY]
> 봇이 없던 시절 배포는 <b>Jenkins(빌드) → GitOps PR(생성·머지) → ArgoCD(롤아웃 확인)</b>가 따로 놀았다. 한 흐름인데 창구가 셋이라 진행을 각 화면에서 따로 확인해야 했고, 폐쇄망이라 매번 VPN을 물고 Jenkins UI에 들어갔으며, 단계 사이엔 수작업(PR 머지·승인)이 끼었다. 이걸 <b>Slack 한 창구·한 프로세스</b>로 묶는 봇을 직접 만들었다. 슬래시 커맨드 한 번이면 빌드→승인→PR 머지→롤아웃이 한 스레드에서 흐른다. 초기 버전엔 <b>결과와 무관하게 성공을 찍고, 재시작 한 번에 감시가 통째로 사라지는</b> 신뢰성 문제가 있어, 이걸 근본부터 다시 잡아 업그레이드했다. Jenkins REST를 폴링해 실제 결과를 추적하고, 승인 게이트 두 곳을 감지해 의미를 갈라 보고하고, 부팅 시 진행 중 빌드를 Jenkins에 되물어 상태 저장 없이 감시를 복원하며, 권한은 fail-closed로 잠갔다.

## 1. 따로 놀던 배포 단계

봇이 있기 전, 배포는 세 도구를 순서대로 거치지만 <b>각각 따로</b> 다뤄야 했다.

- <b>Jenkins</b>: 폐쇄망이라 VPN을 물고 사내 Jenkins UI에 들어가 잡을 찾고 파라미터를 채워 빌드를 돌린 뒤, 끝났는지 그 화면에서 지켜봤다. QA가 "이 브랜치 좀 검증 환경에 올려주세요"라고 하면 그 절차를 아는 사람이 대신 눌러야 했고, 대개 나였다.
- <b>GitOps PR</b>: 빌드가 이미지·매니페스트를 밀면, 그걸 반영하는 PR을 (초기엔) 사람이 만들고 확인하고 머지했다.
- <b>ArgoCD</b>: PR이 머지되면 ArgoCD가 롤아웃하는데, 새 리비전이 실제로 떴는지·Healthy인지는 또 ArgoCD 화면을 열어 확인했다.

문제는 이 셋이 <b>한 흐름인데 창구가 셋</b>이라는 데 있었다. 배포 하나가 어디까지 왔는지 알려면 Jenkins·GitHub·ArgoCD를 번갈아 열어야 했고, 단계 사이사이엔 수작업(PR 머지, 승인, 상태 확인)이 끼어 있었다. 하나라도 놓치면 "빌드는 됐는데 반영은 안 된" 상태를 한참 뒤에야 발견하곤 했다.

그래서 이 흐름 전체를 <b>Slack 한 창구, 한 프로세스</b>로 묶기로 했다. 채널에서 슬래시 커맨드를 치면 파라미터 모달이 뜨고, 제출하면 Jenkins 빌드가 돌고, 중간에 필요한 승인(DB 스키마 마이그레이션 적용, 이미지 Push)은 <b>Slack 버튼</b>으로 받고, GitOps PR이 생기면 링크와 <b>Merge/Close 버튼</b>을 채널에 띄우고, 머지하면 ArgoCD 롤아웃까지 <b>같은 스레드에서 쭉</b> 이어진다. VPN 없이도, 세 화면을 오가지 않아도, 슬랙만 보면 배포 하나의 진행이 한눈에 보이게 하는 게 목표였다.

## 2. 초기 버전의 세 가지 한계

묶는다는 목표는 초기 버전으로 달성했다 — 흩어져 있던 단계가 한 스레드에 모였으니까. 그런데 얼마 쓰다 보니 <b>그 창구가 거짓말을 한다</b>는 게 드러났다. 세 가지가 문제였다.

### 2-1. 거짓 성공 보고

가장 심각한 건 이거였다. 빌드 상태를 폴링하다가 빌드가 끝나면 결과 메시지를 갱신하는 부분이 이렇게 생겨 있었다.

```python
# 초기 버전: 빌드가 끝났거나 승인 대기에 걸리면 결과를 갱신하는 부분
if not build_data.get("building", True) or is_waiting:
    result = build_data.get("result", "SUCCESS")   # 결과 없으면 기본값이 SUCCESS
    emoji = "✅"                                     # 결과와 무관하게 초록 체크 고정
    status_msg = (
        "빌드 파트 완료 (승인 대기 중)"
        if is_waiting
        else f"빌드 완료 (`{result}`)"
    )
```

`emoji`가 빌드 결과와 상관없이 `✅`로 고정돼 있다. `FAILURE`로 끝난 빌드도, `ABORTED`로 죽은 빌드도 슬랙에는 초록 체크로 나갔다. 게다가 `build_data.get("result", "SUCCESS")` — 응답에 `result`가 없으면 기본값이 하필 `"SUCCESS"`다. Jenkins가 결과를 아직 안 준 순간에 읽으면 그것도 성공으로 둔갑했다.

배포 봇이 할 수 있는 가장 나쁜 거짓말은 "실패했는데 성공했다고 말하는 것"이다. QA는 초록 체크를 믿고 테스트를 시작하는데 실제로는 이미지가 안 올라가 있는 식이다.

### 2-2. 재시작 시 감시 소실

두 번째. 빌드 감시는 이렇게 스레드로 떠 있었다.

```python
# 초기 버전: 감시 로직을 데몬 스레드로 백그라운드에 던진다
threading_module.Thread(target=task, daemon=True).start()
```

`task` 안에 "큐 대기 → 빌드 번호 확보 → 상태 폴링 → 결과 보고"가 전부 들어 있고, 이걸 <b>데몬 스레드</b>로 프로세스 메모리 안에서만 돌렸다. 진행 상황은 어디에도 기록되지 않았다. 봇 프로세스가 재배포되거나, OOM으로 죽거나, 노드가 재부팅되면 그 순간 돌던 감시 스레드가 전부 증발했다. Jenkins에서는 빌드가 멀쩡히 계속 도는데, 슬랙 스레드는 "진행 중..."에서 영원히 멈춘다. 승인 버튼도 안 뜨고, 결과도 안 온다. 배포한 사람은 봇이 죽은 줄도 모르고 슬랙만 쳐다본다.

### 2-3. admin 자격증명 집중

세 번째는 자격증명이었다. 봇 설정의 기본값이 이랬다.

```python
# 초기 버전 config: Jenkins 접속 계정 기본값이 admin
"JENKINS_USER": environ.get("JENKINS_USER", "admin"),
```

Jenkins `admin` 계정 하나로 빌드도 트리거하고 상태도 읽었다. 여기에 GitHub 토큰, ArgoCD 토큰까지 한 봇이 다 쥐고 있었는데, ArgoCD 쪽은 관리자 권한 토큰을 그대로 넣어 쓰는 구조였다. 봇 컨테이너 하나가 털리면 CI 서버 admin + GitOps 저장소 쓰기 + ArgoCD 관리자가 한꺼번에 넘어간다. blast radius(사고 반경)가 봇 한 대에 다 걸려 있었다. 접근성을 위해 Slack으로 문을 넓혔으면, 그 문 뒤에 있는 권한은 오히려 더 좁혀야 했는데 그 반대였다.

> [!NOTE]
> 이 자격증명 문제는 범위가 커서 따로 위협 모델로 정리했다. blast-radius 관점의 분석과 rotate·fail-closed·HMAC·스코프 서비스계정으로 닫은 과정은 [[배포 봇에 몰린 admin 자격증명을 위협 모델로 정리하기]]에 있다. 아래 6절은 그중 이번 업그레이드에서 코드로 바로 반영한 부분만 다룬다.

## 3. 업그레이드: 실제 결과 추적

패치로 덧댈 수도 있었지만, 세 결함이 다 상태 관리에서 나온 거라 <b>감시 구조부터 다시 잡기로</b> 했다. 초점은 언어가 아니라 상태 관리였다.

> [!NOTE]
> 이 업그레이드를 하며 구현 언어도 Go로 옮겼는데, 언어 비교의 결과는 아니다. 이 무렵 팀이 Go를 주력으로 잡아가던 흐름이 있었고, [[폐쇄망 전용 싱글 바이너리 워크플로우 도구 Deck 만들기|Deck]]을 만들며 Go 프로젝트 구조를 이미 다져둔 게 컸다. 언어 자체는 요점이 아니라 배경이다.

Slack 연결은 <b>Socket Mode</b>를 그대로 유지했다. 폐쇄망 안에서 도는 봇이라 외부에서 들어오는 인바운드 포트를 열 수 없고, Socket Mode는 봇이 아웃바운드 WebSocket으로 Slack에 붙기 때문에 이 제약에 딱 맞는다. 이 결정만은 초기 버전에서 그대로 가져왔다.

바꾼 건 "결과를 무엇으로 판단하느냐"다. 이모지를 고정하는 대신 Jenkins REST(`<build>/api/json`)의 `result`와 `building` 값을 그대로 폴링해, 빌드가 끝난 순간(`!building && res != ""`)에만 실제 결과로 보고하게 했다.

```go
// 업그레이드 후: 빌드가 끝났을 때(!building && res != "")에만 실제 result로 판단한다.
res, building, err := t.BuildResult(ctx, buildURL)
if !building && res != "" {
    // FAILURE는 FAILURE로, ABORTED는 ABORTED로 — 고정 이모지가 사라졌다.
    // 단, 아래 4절의 '승인 게이트 해석'이 이 결과를 한 번 더 걸러 보고한다.
    r.Report(res, buildURL, "", "")
    return res, nil
}
```

고정 이모지가 사라지니 실패가 실패로 나가게 됐다. 그런데 이 파이프라인은 사람 승인을 두 번 기다리고, 그중 뒤 게이트에서 끊긴 건 실패가 아니라 무해한 중단이라, `result` 값만으로는 해석이 끝나지 않는다. 그 얘기가 다음 절이다.

## 4. 승인 게이트: 감지·재감지·해석

이 봇에서 정작 로직이 까다로웠던 건 승인 지점이 하나가 아니라 둘이고, 그 둘의 성격이 정반대라는 데 있었다.

### 4-1. 게이트가 둘인 파이프라인

배포 잡은 진행 중에 사람 승인을 두 번 기다린다. 순서가 정해져 있다.

- <b>DB 스키마 마이그레이션 게이트</b>(`AtlasApply`): 스키마 변경을 실제로 적용하기 직전에 멈춘다. 여기서 승인해야 마이그레이션이 돈다.
- <b>이미지 Push 게이트</b>(`ApproveServiceImagePush`): GitOps 커밋이 끝난 <b>뒤</b>에, 서비스 이미지를 로컬 레지스트리로 올리기 직전에 멈춘다.

두 게이트 사이에 GitOps 매니페스트 커밋(PR 생성)이 끼어 있다는 게 핵심이다. 앞 게이트는 "아직 아무것도 반영 안 됨" 상태에서 멈추고, 뒤 게이트는 "GitOps PR은 이미 만들어진" 상태에서 멈춘다.

> [!NOTE]
> 이 파이프라인에서 실제 클러스터 반영은 파이프라인 성공 시점이 아니라 GitOps PR 머지 + ArgoCD sync 시점이다. 그래서 봇은 빌드가 SUCCESS로 끝나도 "배포 성공"이 아니라 "배포 준비 완료 — PR 머지하면 반영"이라고 표시한다. 이 전제를 깔고 봐야 뒤 게이트가 왜 무해한지가 자연스럽다.

### 4-2. 멈춘 빌드 감지

먼저 풀어야 할 건 "빌드가 승인 대기 중인지"를 아는 방법이었다. Jenkins의 빌드 상태 JSON을 그냥 보면 안 된다. <b>input 스텝에서 멈춰 있는 빌드도 `building: true`로 보고된다.</b> 실행 중과 승인 대기가 구분이 안 된다는 뜻이다.

구분할 방법은 Pipeline REST API의 `wfapi/pendingInputActions` 하나뿐이었다. 빌드가 input에 걸려 있으면 이 엔드포인트가 대기 중인 input의 `id`와 프롬프트 메시지를 배열로 돌려준다. 걸린 게 없으면 빈 배열이다.

```go
// wfapi/pendingInputActions를 조회해 지금 멈춰 있는 input 게이트가 있는지 본다.
// building=true만으로는 '실행 중'과 '승인 대기'를 구분할 수 없어서 이 엔드포인트가 유일한 판별 수단이다.
func (c *Client) PendingInput(ctx context.Context, buildURL string) (id, message string, pending bool, err error) {
	u := strings.TrimRight(buildURL, "/") + "/wfapi/pendingInputActions"
	var actions []struct {
		ID      string `json:"id"`
		Message string `json:"message"`
	}
	if e := c.getJSON(ctx, u, &actions); e != nil {
		return "", "", false, e
	}
	if len(actions) == 0 {
		return "", "", false, nil
	}
	return actions[0].ID, actions[0].Message, true, nil
}
```

그래서 빌드를 폴링하는 루프에서 매 회차마다 두 가지를 같이 본다. 하나는 빌드 결과(building/result), 하나는 pending input 여부다.

### 4-3. 게이트별 재감지(re-arm)

게이트가 둘이라 감지 로직이 한 번으로 안 끝난다. 앞 게이트를 승인하면 파이프라인이 진행하다 뒤 게이트에서 다시 멈추는데, 이걸 또 잡아서 다시 버튼을 띄워야 한다. 그런데 뒤 게이트에 멈춘 빌드도 여전히 `building: true`라, 순진하게 "input 걸렸네" 하고 매번 알리면 같은 게이트를 폴링 주기마다 중복으로 알리게 된다.

그래서 이미 알린 게이트 id를 `surfaced` 맵에 담아두고, <b>아직 안 알린 id일 때만</b> 승인 요청을 띄운다. 앞 게이트를 승인해 파이프라인이 다음 게이트로 넘어가면 pending input의 id가 바뀌고, 그 id는 맵에 없으니 새로 알린다. 이게 "다음 게이트를 위한 재감지"다.

```go
// 각 게이트를 한 번씩만 알리고, 다음 게이트를 위해 다시 무장한다.
// 두 게이트에 멈춘 빌드 모두 building=true라 매 회차 pending input을 같이 폴링한다.
if id, msg, pending, ierr := t.PendingInput(ctx, buildURL); ierr == nil && pending && id != "" && !surfaced[id] {
	r.Report("AWAITING_APPROVAL", buildURL, id, msg)
	surfaced[id] = true
	lastInputID = id // 종료 상태를 해석할 때 '마지막으로 멈췄던 게이트'가 필요하다
}
```

`lastInputID`를 따로 기억해두는 이유는 다음 절에 있다. 어느 게이트에서 마지막으로 멈췄는지가 빌드가 실패로 끝났을 때의 해석을 가른다.

### 4-4. 종료 상태 해석

같은 "게이트에서 중단"이라도 두 게이트의 의미가 정반대다.

- <b>앞 게이트(마이그레이션)에서 중단</b>: 스키마가 아직 안 적용된 상태다. 여기서 끊으면 배포가 아무 의미가 없다. <b>실패</b>다.
- <b>뒤 게이트(이미지 Push)에서 중단</b>: GitOps PR은 이미 만들어졌고 마이그레이션도 끝난 상태다. 이미지를 로컬 레지스트리에 안 올렸을 뿐, PR을 머지하면 배포는 된다. <b>무해(benign)</b>하다.

이걸 봇이 알아서 갈라줘야지, 안 그러면 뒤 게이트에서 중단한 운영자가 "배포 실패" 빨간 메시지를 보고 놀란다. 반대로 앞 게이트에서 끊었는데 "무해" 취급하면 스키마 안 올라간 걸 성공인 줄 안다. 둘 다 사고다.

그래서 빌드가 끝났을 때, Push 게이트 id를 기준으로 종료 상태를 세 갈래로 나눴다. 3절에서 미룬 "해석"이 여기다.

```go
switch {
// SUCCESS이고 Push 게이트까지 도달했으면 → Push 포함 정상 종료
case res == "SUCCESS" && pushInputID != "" && surfaced[pushInputID]:
	r.Report("DEPLOYED_PUSH_OK", buildURL, "", "")
// 비-SUCCESS인데 '마지막으로 멈춘 게이트'가 Push 게이트면 → 무해한 push 미완료
// (GitOps PR과 앞선 마이그레이션은 이미 커밋됨)
case res != "SUCCESS" && pushInputID != "" && lastInputID == pushInputID:
	r.Report("DEPLOYED_PUSH_INCOMPLETE", buildURL, "", res)
// 그 외 게이트에서 실패/중단(예: 마이그레이션 미적용) → 있는 그대로 실패
default:
	r.Report(res, buildURL, "", "")
}
```

`DEPLOYED_PUSH_INCOMPLETE`는 봇 안에서 "배포는 커밋됐다"로 취급한다. 그래서 PR 머지 버튼도 정상적으로 열어준다. 반대로 앞 게이트에서 끊긴 비-SUCCESS는 remap 없이 원래 결과(FAILURE/ABORTED)를 그대로 올린다.

### 4-5. Slack 문구·버튼 분기

해석이 갈리니 사람에게 보여주는 문구도 게이트마다 달라야 했다. 같은 승인 대기 카드인데 안내가 반대이기 때문이다. input id로 분기해서 리드 문구·승인 버튼 라벨을 바꿨다.

```go
switch inputID {
case pushInputStepID: // 이미지 Push 게이트
	lead = "*서비스 이미지 로컬 레지스트리 Push 승인 대기*\n_중단해도 GitOps PR은 유지됩니다 (머지하면 클러스터에 반영)._"
case atlasInputStepID: // DB 마이그레이션 게이트
	lead = "*DB 스키마 마이그레이션 승인 대기*\n_중단하면 스키마가 적용되지 않아 배포가 실패로 처리됩니다._"
default:
	lead = fmt.Sprintf("*승인 대기 — %s*", inputID)
}
```

승인 버튼도 마이그레이션 게이트는 "마이그레이션 적용", Push 게이트는 "Push 승인"으로 다르게 찍었다. 중단 버튼의 확인 문구도 마찬가지다. 마이그레이션을 중단하면 "스키마 미적용, 배포는 실패로 처리됩니다"라고 분명히 경고하고, Push를 중단하면 "이미지 Push를 중단했습니다"로 담담하게 끝낸다. 문구 한 줄 차이 같지만, 운영자가 버튼을 누르기 전에 "지금 끊으면 뭐가 어떻게 되는지"를 알려주는 건 이 문구뿐이다.

버튼 자체의 동작은 단순하다. 승인은 멈춘 input에 `proceedEmpty`를 POST하고, 중단은 `input/<id>/abort`를 POST한다. 승인 요청 값에는 빌드 URL과 input id를 `|`로 묶어 실어서, 버튼이 눌렸을 때 어느 빌드의 어느 게이트인지 되찾는다.

```go
// 버튼 값에 빌드 URL과 input id를 함께 실어 왕복시킨다.
// Jenkins 빌드 URL과 input id에는 '|'가 안 들어가므로 구분자로 안전하다.
func encodeApprove(buildURL, inputID string) string { return buildURL + "|" + inputID }
```

어려운 API를 쓴 건 아니다. `wfapi/pendingInputActions`로 멈춘 걸 알아내고, 맵 하나로 게이트를 한 번씩만 알리고, id로 종료 해석을 가른 게 전부다. 정작 시간을 쓴 건 "이 게이트에서 끊으면 대체 무슨 상태가 되는가"를 게이트마다 못 박는 일이었다. 파이프라인 단계의 의미를 봇이 대신 기억하게 해서, 운영자가 매번 그걸 떠올리지 않아도 되게 했다.

## 5. 상태 비저장 복원

재시작하면 감시가 사라지던 문제. 흔한 해법은 "진행 중인 배포 상태를 DB나 파일에 체크포인트로 남기는" 것이다. 그런데 그렇게 하면 봇이 또 하나의 상태 저장소가 되고, 그 상태가 Jenkins의 실제 상태와 어긋나는 순간(스플릿 브레인) 새로운 버그가 생긴다.

그래서 방향을 뒤집었다. <b>봇은 아무 상태도 저장하지 않는다.</b> 진행 중인 배포가 무엇인지는 Jenkins가 이미 알고 있으니, 부팅할 때 Jenkins에 되물으면 된다. 빌드를 트리거할 때 알림 보낼 채널 ID를 빌드 파라미터(`SLACK_CHANNEL_ID`)에 심어두고, 재시작 시 진행 중인 빌드 목록을 조회해 그 파라미터로 어느 채널에 보고할지 복원한다.

```go
// 업그레이드 후: 부팅 시 Jenkins의 진행 중 빌드를 조회해 감시를 다시 붙인다
func (d Deps) ResumeWatches(ctx context.Context) {
    builds, err := d.ListRunning(ctx)   // Jenkins에 "지금 도는 빌드 뭐 있어?"를 되묻는다
    ...
    for _, b := range builds {
        channelID := b.Params["SLACK_CHANNEL_ID"]   // 빌드 파라미터에서 알림 채널 복원
        if channelID == "" {
            continue   // 채널을 모르면 스킵 (로컬 상태가 없으니 지어내지 않는다)
        }
        go d.resumeOne(ctx, b.URL, channelID, b.UserID, /* 폼 파라미터 복원 */)
    }
}
```

`ListRunning`은 배포 잡의 빌드 목록에서 `building=true`인 것만 골라, 각 빌드의 파라미터와 트리거한 사람까지 함께 긁어온다. 봇이 죽었다 살아나면 로그에 이렇게 찍힌다.

```
[resume] 1 in-progress build(s) found — re-attaching watchers
```

그리고 슬랙 스레드에 "봇 재시작 — 진행 중인 배포 감시를 재개합니다"를 붙이고 하던 감시를 이어간다. Jenkins를 유일한 진실의 출처(source of truth)로 두니, 봇은 언제 죽어도 다시 조립되는 stateless 컴포넌트가 됐다.

## 6. fail-closed 권한 게이트와 스코프 서비스 계정

마지막으로 자격증명. Slack으로 문을 넓혔으니 그 뒤의 권한은 좁혀야 했다.

권한 게이트는 <b>fail-closed</b>로 잡았다. 허용 사용자 목록이 비어 있으면 "전체 허용"으로 관대하게 넘어가는 게 아니라, 아예 기동을 거부한다.

```go
// 업그레이드 후: 허용 사용자 목록이 비면 전체 허용이 아니라 기동 자체를 거부한다
if len(c.AllowedUsers) == 0 {
    return nil, fmt.Errorf("ALLOWED_USERS is empty: fail-closed, refusing to allow all users")
}
```

초기 버전의 `ALLOWED_USERS` 기본값은 `"*"`(전체 허용)였다. 설정을 깜빡하면 조용히 누구나 배포할 수 있게 열려버리는 것이다. fail-closed는 그 반대로, 설정을 깜빡하면 아무도 못 쓰게 잠긴다. 실수했을 때 안전한 쪽으로 넘어지게 만드는 게 게이트의 기본이라고 본다. 사용자 판별은 Slack user ID 직접 매칭에 실패하면 `users.info`로 프로필 이메일을 조회해 허용 목록과 대조하는데, 조회가 실패하거나 이메일이 비면 그대로 거부한다. 승인 버튼도 마찬가지다 — 버튼은 누구 눈에나 보이지만, 눌렀을 때 같은 판별을 거치므로 보이는 것과 누를 수 있는 것이 분리된다.

자격증명은 역할별로 쪼갰다. Jenkins는 admin이 아니라 빌드 트리거/조회만 가능한 API 토큰으로, GitHub 토큰은 GitOps PR Merge/Close에만 쓰고 없으면 그 버튼만 비활성화되며(링크는 그대로 노출), ArgoCD는 관리자 토큰 대신 <b>토큰 발급만 허용하고 UI 로그인은 막은 봇 전용 로컬 계정</b>에 `applications, get` 권한 하나만 준 최소 스코프 토큰을 위임했다.

```bash
# ArgoCD: 봇 전용 읽기 계정 생성 (apiKey는 토큰 발급만 허용, 비밀번호 로그인 차단)
kubectl -n argocd patch configmap argocd-cm --type merge -p '
data:
  accounts.deploy-bot: apiKey
'
# RBAC은 applications, get 하나만 — sync/delete/create는 주지 않는다
```

배포 관측(PR 머지 후 ArgoCD가 실제로 그 리비전에서 Healthy가 됐는지 확인)에 필요한 권한은 읽기뿐이라, 굳이 sync나 삭제 권한을 줄 이유가 없었다. 봇이 털려도 넘어가는 건 "애플리케이션 상태 조회" 정도로 반경을 좁혔다. 토큰류(봇 토큰, 앱 토큰, JWT 성격의 ArgoCD 토큰)는 전부 시크릿 참조로만 주입하고 코드·설정에 평문으로 남기지 않았다.

> [!NOTE]
> "Slack 버튼으로 배포 승인을 받는 게 보안상 괜찮냐"는 질문이 남는다. 답은 "버튼 자체가 권한이 아니게 만들면 괜찮다"이다. 버튼을 누른 주체가 허용 목록에 있는지 매번 확인하고(fail-closed), 버튼이 호출하는 백엔드 권한을 최소로 좁혀두면, 슬랙은 그냥 편한 입력 수단일 뿐 권한의 원천이 아니다. 봇에 몰렸던 자격증명을 위협 모델로 뜯어 정리한 상세는 [[배포 봇에 몰린 admin 자격증명을 위협 모델로 정리하기]]에 있다.

## 7. 회고

전부 다 만든 건 아니다. Jenkins가 PR 생성 시점에 봇으로 직접 웹훅을 쏘는 실시간 경로는 아직 폴링으로 대체 중이고, stage별 클러스터 라우팅도 더 다듬을 여지가 있다. PR을 머지한 뒤 ArgoCD가 정말 그 리비전에서 Healthy가 됐는지 확인하는 부분은 따로 [[GitOps 배포 봇의 ArgoCD 헬스 게이트 - stale-Healthy 오탐 제거|헬스 게이트]]로 정리했다.

이 작업의 뼈대는 두 겹이다. 하나는 <b>따로 놀던 세 단계(Jenkins·GitOps·ArgoCD)와 그 사이의 수작업을 한 프로세스로 묶은 것</b>. 다른 하나는 그 묶음을 <b>믿을 수 있게</b> 만든 것 — 초기 버전으로 먼저 묶고, 업그레이드하며 "실패를 실패라고 말하고, 죽어도 되살아나게" 고쳤다. 속도를 몇 배 올렸다는 정량 지표를 들이밀 생각은 없다. 흩어져 있던 걸 하나로 모으고, 그 하나가 거짓말을 안 하게 만든 게 결과다.

## 참고

- [Slack Socket Mode](https://api.slack.com/apis/socket-mode)
- [slack-go/slack (Go SDK)](https://pkg.go.dev/github.com/slack-go/slack)
- [Jenkins Pipeline `input` step](https://www.jenkins.io/doc/pipeline/steps/pipeline-input-step/)
- [Jenkins Remote Access API](https://www.jenkins.io/doc/book/using/remote-access-api/)
- [argocd account (로컬 계정·토큰)](https://argo-cd.readthedocs.io/en/stable/user-guide/commands/argocd_account/)
- [Atlas — versioned migrations apply](https://atlasgo.io/versioned/apply)
- [[수작업 SQL 관리를 Atlas 버전드 마이그레이션으로 전환하기|이 파이프라인이 적용하는 마이그레이션의 Atlas 도입 이야기]]
