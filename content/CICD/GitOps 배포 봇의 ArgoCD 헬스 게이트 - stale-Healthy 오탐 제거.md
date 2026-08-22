---
title: GitOps 배포 봇의 ArgoCD 헬스 게이트에서 stale-Healthy 오탐 없애기
date: 2026-02-25
draft: false
tags:
  - argocd
  - gitops
  - kubernetes
  - ci-cd
  - troubleshooting
banner: 
cssclasses: 
description: PR 머지 직후 배포 봇이 "완료"를 알렸는데 정작 새 리비전은 반영되기 전이었다. 직전 sync의 Healthy를 그대로 읽던 오탐을, 머지 커밋 SHA 기준 리비전 매칭 게이트로 걷어낸 기록.
permalink: 
aliases: 
completed: true
type:
  - issue
---

## 요약

> [!SUMMARY]
> PR을 머지하면 배포 봇이 ArgoCD를 폴링해 "배포 완료"를 슬랙에 알린다. 그런데 봇이 <b>직전 sync에서 남아있던 Healthy</b>를 그대로 읽고, 새 리비전이 반영되기도 전에 완료로 오판했다. 머지가 돌려준 커밋 SHA를 기준으로 `status`·`operationState`의 리비전 필드를 모아 매칭시키고, "그 리비전에서 Healthy 도달"을 엄격히 요구하는 게이트로 오탐을 없앴다.

## 1. 환경

- ArgoCD: ApplicationSet 기반 GitOps (앱이 라벨로 스탬핑되어 stage별로 조회됨)
- 배포 봇: Go로 재작성 (구버전은 Python), ArgoCD REST API를 폴링
- 트리거: GitHub PR squash merge → 봇이 슬랙 메시지 한 개를 `chat_update`로 갱신하며 진행 상황 표시

## 2. 이슈

배포 봇의 역할은 단순하다. 개발자가 슬랙에서 PR을 squash merge하면, 봇이 그 커밋이 실제로 클러스터에 반영되고 앱이 정상인지를 대신 지켜봐 주는 것이다. GitOps라 머지가 곧 배포 트리거고, 봇은 ArgoCD Application의 상태를 폴링하다가 다 올라오면 "배포 완료"를 같은 슬랙 메시지에 갱신한다.

문제는 봇이 너무 빨리 완료를 알렸다는 거다. 머지 버튼을 누르자마자 몇 초 만에 "✅ 배포 완료"가 떴는데, 정작 새 코드는 아직 파드에 반영되기 전이었다. 봇 말만 믿고 확인하러 들어가면 옛날 버전이 돌고 있었다.

원인은 <b>최종 일관성(eventual consistency)</b>이었다. ArgoCD는 자기 리컨실 루프에 따라 주기적으로 git을 폴링하고 sync한다. 머지 직후에는 ArgoCD가 아직 새 커밋을 감지하지도, sync를 시작하지도 않은 상태다. 그런데 이때 앱의 `status.health.status`를 읽으면 여전히 `Healthy`다. 직전 sync가 성공적으로 끝났으니 당연히 Healthy인 것이다.

즉 헬스 상태는 <b>"어느 리비전이 Healthy인지"를 말해주지 않는다.</b> 봇은 "Healthy면 됐지"라고 판단했지만, 그 Healthy는 방금 머지한 커밋과 아무 상관 없는 직전 배포의 잔상이었다. 머지와 ArgoCD 리컨실 사이의 경쟁 조건(race condition)이고, 나는 이걸 <b>stale-Healthy 오탐</b>이라고 부른다.

고칠 지점은 분명하다. Healthy만 보지 말고, "머지한 그 커밋에서 Healthy인가"를 봐야 한다.

## 3. 해결

### 1. 어떤 커밋을 기준으로 삼나

리비전을 매칭하려면 먼저 "정답 커밋"이 있어야 한다. 여기서 실수하기 쉬운 게 머지 전 PR 객체의 `merge_commit_sha`를 쓰는 건데, 이건 GitHub가 미리 계산해둔 test-merge SHA일 수 있어서 실제 머지 결과와 다를 수 있다.

그래서 기준 SHA는 <b>머지 API가 200으로 돌려준 응답의 `sha`</b>만 쓴다. 그리고 머지 요청(`PUT`)에는 현재 head SHA를 optimistic concurrency로 실어 보낸다. 그 사이 PR에 새 커밋이 붙었으면 GitHub가 409를 주고, 봇은 엉뚱한 커밋을 머지하는 대신 "다시 시도"를 띄우고 빨리 실패한다. 애매한 기준으로 ArgoCD를 게이팅하느니 여기서 끊는 게 낫다.

### 2. 리비전 후보 모으기

ArgoCD 앱 상태에서 "지금 이 앱이 가리키는 리비전"은 한 군데 박혀 있지 않다. 특히 멀티소스(multiple sources) 앱이면 `status.sync.revisions[]`에 여러 개가 들어온다. 단일 필드만 보면 놓친다. 그래서 관련 필드를 전부 긁어 후보 목록을 만든다.

```go
// 한 앱의 status에서 "지금 가리키는 리비전" 후보를 전부 모은다.
// sync 결과와 operationState의 sync 결과 양쪽을 봐야 누락이 없다.
add := func(r string) {
	if r != "" {
		st.Revisions = append(st.Revisions, r)
	}
}
add(s.Status.Sync.Revision)
for _, r := range s.Status.Sync.Revisions { // 멀티소스 앱 대비
	add(r)
}
add(s.Status.OperationState.SyncResult.Revision)
for _, r := range s.Status.OperationState.SyncResult.Revisions {
	add(r)
}
```

`status.sync`는 ArgoCD가 관측한 현재 sync 상태고, `operationState.syncResult`는 마지막으로 수행한 sync 작업의 결과다. 둘이 항상 같지는 않아서(작업 중이거나 방금 끝난 순간엔 갈릴 수 있다) 양쪽을 모두 후보에 넣는다. 빈 값은 버리고, 중복은 순서를 유지한 채 걸러낸다.

### 3. 짧은 SHA와 긴 SHA 매칭

후보를 모았으면 기준 SHA와 비교하는데, 그냥 문자열 `==`로는 안 된다. ArgoCD가 돌려주는 리비전이 풀 40자 SHA일 때도 있고 짧게 잘린 형태일 때도 있다. 한쪽이 다른 쪽의 접두사이고, 짧은 쪽이 최소 7자 이상이면 같은 커밋으로 인정했다. (7자 미만은 충돌 가능성이 있어 신뢰하지 않는다.)

```go
// 짧은 SHA와 긴 SHA를 같은 커밋으로 인정한다.
func RevisionMatch(a, b string) bool {
	a, b = strings.TrimSpace(a), strings.TrimSpace(b)
	if a == "" || b == "" {
		return false
	}
	if a == b {
		return true
	}
	lo, hi := a, b
	if len(lo) > len(hi) {
		lo, hi = hi, lo
	}
	return len(lo) >= 7 && strings.HasPrefix(hi, lo)
}
```

### 4. 게이트 판정

이제 게이트다. Healthy만으로는 부족하고, <b>"기준 SHA에 도달한 상태에서" Healthy</b>여야 한다.

```go
// Healthy AND (기준 SHA 매칭) 을 함께 요구한다.
func ReadyAtRevision(s AppState, targetSHA string) bool {
	if s.Health != "Healthy" {
		return false
	}
	matched := false
	for _, r := range s.Revisions {
		if RevisionMatch(r, targetSHA) {
			matched = true
			break
		}
	}
	if !matched {
		return false // ← 직전 sync에서 남은 stale-Healthy가 여기서 걸린다
	}
	if s.Sync == "Synced" {
		return true
	}
	// Synced로 안정되기 전, OutOfSync인데 마지막 sync는 성공한 과도기도 인정
	return s.Sync == "OutOfSync" && s.OperationPhase == "Succeeded"
}
```

리비전 매칭에서 걸러지는 지점(`matched == false`)이 바로 오탐을 잡는 곳이다. 머지 직후의 stale-Healthy는 후보 리비전에 새 SHA가 없으니 여기서 `false`가 되고, 봇은 계속 폴링한다.

마지막 두 줄은 겪어보고 추가한 예외다. sync 상태가 `Synced`면 당연히 통과인데, ArgoCD는 리비전에서 Healthy하게 sync가 끝난 직후에도 리소스 드리프트 등으로 잠깐 `OutOfSync`로 다시 튈 때가 있다. 이 경우까지 실패로 보면 멀쩡히 배포된 걸 타임아웃으로 처리해버린다. 그래서 `OutOfSync`이더라도 마지막 sync 작업이 `Succeeded`면 성공으로 인정했다.

> [!NOTE]
> 이 게이트는 <b>모니터링 전용</b>이다. 봇은 ArgoCD에 sync·rollback 같은 side-effect 요청을 보내지 않는다. 상태를 읽어 판정만 하고, 실제 배포는 ArgoCD 리컨실 루프에 맡긴다. 봇이 성급하게 `refresh=hard`를 남발하면 그것대로 ArgoCD에 부하를 준다.

## 4. 확인

판정 로직이 순수 함수라 네트워크 없이 테이블 테스트로 검증했다. 특히 오탐 케이스(`stale healthy no rev`)를 `false`로 잡는 게 이 작업의 전부라, 그 케이스를 테스트에 먼저 넣었다.

```go
sha := "deadbeefcafef00d"
cases := []struct {
	name string
	s    AppState
	want bool
}{
	{"healthy synced at rev",   AppState{Health: "Healthy", Sync: "Synced", Revisions: []string{sha}},                                     true},
	{"stale healthy no rev",    AppState{Health: "Healthy", Sync: "Synced"},                                                               false}, // 오탐 재현
	{"healthy synced wrong rev",AppState{Health: "Healthy", Sync: "Synced", Revisions: []string{"0000000000"}},                            false},
	{"progressing",             AppState{Health: "Progressing", Sync: "Synced", Revisions: []string{sha}},                                 false},
	{"outofsync op succeeded",  AppState{Health: "Healthy", Sync: "OutOfSync", OperationPhase: "Succeeded", Revisions: []string{sha}},     true},
	{"outofsync op running",    AppState{Health: "Healthy", Sync: "OutOfSync", OperationPhase: "Running", Revisions: []string{sha}},       false},
}
```

`stale healthy no rev`는 Healthy·Synced인데 후보 리비전이 비어 있는 상태다. 바로 머지 직후의 그 순간이다. 이 케이스가 `false`로 나오면 오탐은 잡힌 것이다.

실제 폴링 루프는 앱별로 한 줄씩 상태를 그려 슬랙에 갱신한다. 아직 도달 안 한 앱은 `⏳`, 게이트를 통과하면 `✅`로 바뀐다.

```text
⏳ `stg-tenant-a-core` sync=OutOfSync health=Progressing
✅ `stg-tenant-a-data` sync=Synced health=Healthy
```

모든 대상 앱이 `✅`가 되면 봇이 최종 "배포 완료"를 확정한다. 이제 이 완료는 "머지한 그 커밋이 올라와서 Healthy"라는 뜻이 됐다. 고치기 전엔 그냥 "뭔가 Healthy"였던 것과는 다르다.

## 참고

- [ArgoCD Resource Health](https://argo-cd.readthedocs.io/en/stable/operator-manual/health/)
- [ArgoCD API Docs](https://argo-cd.readthedocs.io/en/stable/developer-guide/api-docs/)
- [ArgoCD Multiple Sources for an Application](https://argo-cd.readthedocs.io/en/stable/user-guide/multiple_sources/)
- [GitHub REST: Merge a pull request](https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request)
- [[Jenkins·GitOps·ArgoCD 배포를 Slack 봇 하나로 묶기|이 헬스 게이트가 사는 배포 봇 이야기]]
