---
title: 배포 봇 한 곳에 몰린 admin 자격증명을 위협 모델로 정리하기
date: 2026-06-11
draft: false
featured: true
tags:
  - cicd
  - security
  - threat-modeling
  - slack-bot
  - argocd
  - devsecops
banner: 
cssclasses: 
description: 배포 봇 하나에 CD·git·CI admin이 다 몰려 있던 걸 위협 모델로 뜯어보고, 평문 토큰·fail-open 인가·무검증 웹훅을 rotate·fail-closed·HMAC·스코프 서비스계정으로 정리한 기록.
permalink: 
aliases: 
completed: true
type:
  - note
---

> [!SUMMARY]
> Slack 배포 봇 하나에 CD·git·CI admin 자격증명이 다 몰려 있던 걸 위협 모델로 뜯어봤다. 평문 토큰·fail-open 인가·무검증 웹훅을 rotate·fail-closed·HMAC·스코프 서비스계정으로 하나씩 닫았다.

배포 봇 이야기다. Jenkins에서 빌드하고, gitops 리포에 PR을 올리고, 그걸 merge하면 ArgoCD가 클러스터에 반영하고, 마지막에 k9s로 확인하는 흐름을 Slack 채널 하나로 묶어둔 봇이었다. 개발자가 도구 네 개를 다 이해할 필요도 없고, VPN 안쪽 인가 PC에서만 열리는 콘솔들을 QA가 붙잡고 씨름할 필요도 없다. 접근성 하나는 확실히 좋았다.

문제는 그 편의가 어디서 나왔느냐다. 봇이 그 네 단계를 대신 눌러주려면, 네 단계에 필요한 권한을 봇이 다 쥐고 있어야 한다. 편해진 만큼 한 프로세스에 권한이 쌓였다는 뜻이다. 그걸 뒤늦게 들여다본 기록이다.

## 1. 봇을 줄이지 않은 전제

보안 관점에서 제일 쉬운 처방은 "봇이 하는 걸 줄이자"다. merge는 branch protection으로 넘기고, 승인은 ArgoCD·Jenkins UI에서 직접 하게 하고, 봇은 알림만. 표면이 줄면 위험도 준다.

그런데 이건 안 된다. 애초에 이 봇이 존재하는 이유가 <b>Slack 단일 창구</b>였다. 콘솔들이 VPN 내부 인가 PC에서만 열려서 접근성이 나빴고, 비개발 부서는 gitops 리포를 직접 봐야 변경을 알 수 있었다. 그 불편을 없애려고 만든 걸, 보안을 이유로 다시 불편하게 되돌리면 당사자 입장에선 개악이다.

그래서 전제를 하나 박고 시작했다. 인터페이스(Slack에서 다 한다)는 건드리지 않는다. 손댈 건 <b>봇이 admin 자격증명을 직접 쥐고 있다는 사실</b> 쪽이다. 사용자는 여전히 버튼만 누르고, 실제 권한 실행은 그 권한만 가진 실행자에게 넘긴다 — 이 방향이면 UX는 그대로 두고 위험만 뗄 수 있다. 관심사를 인터페이스와 자격증명으로 갈라 놓으니 "역할 과다"라는 뭉뚱그린 불만이 실제로 고칠 수 있는 항목들로 쪼개졌다.

## 2. 위협 모델

"봇 역할이 많다"는 느낌만으로는 뭘 먼저 고쳐야 할지 안 나온다. 그래서 봇 컨테이너를 하나의 신뢰 경계로 놓고, 여기가 뚫리면 뭐가 새는지부터 적었다.

한 컨테이너의 환경변수에 이만큼이 들어 있었다.

- Slack 봇/앱 토큰
- GitHub 토큰 (gitops 리포 merge + 브랜치 삭제 권한)
- Jenkins admin 자격증명
- ArgoCD stg/prod admin JWT

blast-radius가 곧바로 나온다. 이 호스트 한 곳이 털리면 공격자는 <b>이 권한들의 합집합</b>을 얻는다. 코드를 merge해 배포 파이프라인에 임의 변경을 밀어넣고, prod ArgoCD를 admin으로 주무르고, Jenkins를 admin으로 잡는다. CI·CD·git이 한 번에 넘어간다. "봇 하나 나가는" 사고가 아니라 배포 경로 전체가 나가는 사고다.

경계를 이렇게 그어놓고 코드를 다시 읽으니, 막연하던 불안이 위치가 찍힌 이슈 다섯 개로 바뀌었다. 순서는 UX와 무관하게 순수하게 이득만 있는 것부터. 이게 그렇게 추린 즉시 트랙이다.

## 3. 평문으로 커밋된 무기한 admin JWT

여기서 가장 시급한 건 이거였다. `docker-compose.yml`에 ArgoCD stg/prod admin 토큰이 <b>기본값으로 박혀</b> 있었다. env가 안 넘어오면 이 기본값을 쓰도록.

```yaml
# docker-compose.yml — env 미주입 시 쓰이는 기본값 자리에
# ArgoCD admin JWT가 그대로 들어가 있었다 (값은 마스킹)
- ARGOCD_STG_SERVER=${ARGOCD_STG_SERVER:-https://10.10.30.180:30088}
- ARGOCD_STG_AUTH_TOKEN=${ARGOCD_STG_AUTH_TOKEN:-<REDACTED JWT>}
- ARGOCD_PROD_SERVER=${ARGOCD_PROD_SERVER:-https://10.10.31.182:30088}
- ARGOCD_PROD_AUTH_TOKEN=${ARGOCD_PROD_AUTH_TOKEN:-<REDACTED JWT>}
```

두 가지가 겹쳐서 나빴다. 하나는 `admin:apiKey` 스코프 JWT라는 점, 다른 하나는 <b>만료가 없다</b>는 점. ArgoCD API 키는 발급할 때 expiry를 안 주면 무기한이다. 무기한 admin 토큰이 git에 평문으로 올라갔다는 건, 리포 접근 권한을 가진 누구든(그리고 리포가 어디로 새든) prod ArgoCD admin을 영구히 쥔다는 뜻이다.

여기서 흔히 하는 착각이 "히스토리에서 지우면 되지"다. 아니다. 이미 커밋돼 push된 시크릿은 <b>이미 유출된 것</b>으로 취급해야 한다. git 히스토리 purge는 앞으로 clone하는 사람이 못 보게 막을 뿐, 이미 어딘가로 흘러간 값을 되돌리진 못한다. 그래서 순서가 있다.

1. 먼저 토큰을 revoke하고 rotate한다. 이게 실제로 문을 잠그는 유일한 조치다.
2. 그다음 히스토리에서 값을 걷어낸다(뒤늦게라도 노출 표면을 줄이는 위생).
3. 코드에선 기본값을 아예 없앤다. env로만 주입하고, 없으면 안 뜨게.

새로 쓴 봇에는 토큰 기본값 자체가 없다. 값이 코드나 compose 파일 어디에도 안 남게 하는 게 재발 방지의 핵심이라, 이건 "고쳤다"보다 "그런 자리를 없앴다"에 가깝다.

## 4. fail-open 인가

인가 로직이 fail-open이었다. 허용 사용자 목록이 비어 있거나 `*`이면 전부 통과.

```python
def is_user_allowed(user_id):
    """ALLOWED_USERS=='*' 또는 비어있으면 전체 허용. 아니면 이메일 매치."""
    if not ALLOWED_USERS or ALLOWED_USERS == "*":
        return True   # ← 설정을 깜빡하면 조용히 전원 허용
    ...
```

의도는 "설정 안 했으면 일단 열어두고 나중에 잠그자"였겠지만, 보안 기본값이 열림이면 잠그는 걸 잊는 순간 그냥 열려 있다. 그리고 이런 건 사고 나기 전엔 티가 안 난다. 채널에 들어올 수 있는 사람은 누구나 배포를 트리거할 수 있는 상태였다는 뜻이다.

<b>fail-closed</b>로 뒤집었다. 허용 목록이 비면 통과가 아니라 기동 거부. 다시 쓴 봇은 부팅 시점에 이걸 검사한다.

```go
// 허용 사용자 목록이 비어 있으면 "전원 허용"이 아니라 기동 자체를 거부한다.
if len(c.AllowedUsers) == 0 {
    return nil, fmt.Errorf("ALLOWED_USERS is empty: fail-closed, refusing to allow all users")
}
```

여기엔 짝이 있는 함정이 하나 더 있었다. 승인 버튼 핸들러에는 권한 체크가 아예 없었다. `/deploy` 슬래시 커맨드는 게이트를 통과하는데, 정작 파이프라인이 멈춰 서서 승인을 기다리는 input 버튼 — DB 스키마 마이그레이션 적용이나 prod 이미지 push 같은, 가장 파괴적인 지점 — 은 버튼만 보이면 아무나 누를 수 있었다. 슬래시 커맨드에는 권한 체크가 있었지만 승인 버튼에는 없었다. 승인·중단 버튼에도 같은 게이트를 물렀다. 새 봇은 슬래시든 버튼이든 모든 상호작용을 사용자 허용 검사로 감싼다.

## 5. 서명 없는 웹훅

봇은 Jenkins가 보내는 웹훅을 받아 PR 알림과 승인 요청을 채널에 띄웠다. 그런데 그 웹훅 핸들러가 본문을 아무 검증 없이 그대로 신뢰했다.

```python
def jenkins_input_webhook(*, flask_request_obj, jsonify_func, app_obj):
    """Jenkins input 스테이지 도달 시 승인 요청 수신."""
    data = flask_request_obj.json   # ← 서명·시크릿 확인 없이 바로 신뢰
    channel_id = data.get("channel_id")
    build_number = data.get("build_number")
    ...
```

웹훅 포트에 닿을 수 있는 사람이면 누구나 "prod 배포 승인이 필요합니다" 같은 그럴듯한 메시지를 채널에 꽂을 수 있다. Jenkins가 보낸 건지, 사내망 어딘가에서 누가 curl로 쏜 건지 봇은 구분하지 못한다. 승인 흐름을 통째로 사칭할 수 있는 구멍이다.

<b>HMAC-SHA256 공유 시크릿</b> 검증을 붙였다. 발신 측(Jenkins)과 봇이 같은 시크릿으로 본문의 HMAC을 계산하고, 헤더로 넘어온 서명과 상수 시간 비교로 맞춰본다. 안 맞으면 401.

```go
// 공유 시크릿으로 본문 HMAC을 계산해 헤더 서명과 상수 시간 비교한다.
func Verify(secret string, body []byte, providedHex string) bool {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write(body)
	expected := m.Sum(nil)
	provided, err := hex.DecodeString(providedHex)
	if err != nil {
		return false
	}
	return hmac.Equal(expected, provided)  // 타이밍 공격 방지
}
```

`hmac.Equal`을 쓰는 이유는 일반 바이트 비교가 앞에서부터 다른 지점까지 걸리는 시간으로 서명을 조금씩 추측당할 수 있어서다. 서버 쪽에선 이 검증을 통과 못 하면 본문을 파싱조차 하지 않는다.

```go
sig := r.Header.Get("X-Webhook-Signature")
if !Verify(secret, body, sig) {
    http.Error(w, "invalid signature", http.StatusUnauthorized)
    return
}
```

## 6. admin이 기본값, TLS 검증은 꺼짐

나머지 하나는 기본값 위생 문제였다. `JENKINS_USER` 기본값이 `admin`이었고, ArgoCD `VERIFY_TLS` 기본값이 `false`였다.

```yaml
- JENKINS_USER=${JENKINS_USER:-admin}          # 기본이 admin
- ARGOCD_VERIFY_TLS=${ARGOCD_VERIFY_TLS:-false} # 기본이 검증 생략
```

둘 다 "일단 편하게 굴러가게" 하려다 남은 기본값이다. Jenkins를 admin으로 붙는 건 앞의 blast-radius를 그대로 키우는 얘기고, TLS 검증을 끄면 봇↔ArgoCD 구간이 중간자 공격에 열린다. 원칙은 단순하다. 기본값은 안전한 쪽이어야 한다. Jenkins는 필요한 권한만 가진 스코프 서비스계정으로, TLS 검증은 기본 on(자체 서명 인증서면 CA 번들을 넣어서). 편의 기본값이 곧 취약점 기본값이 되지 않게.

## 7. 스코프 서비스계정으로 자격증명 분리

여기까지가 급한 불을 끄는 작업이었다면, 다음은 <b>봇이 admin을 아예 안 쥐게</b> 만드는 일이다. 위협 모델에서 blast-radius가 컸던 이유는 권한이 합집합으로 한곳에 모여 있어서였다. 권한을 쪼개서, 각 작업을 그 작업 권한만 가진 실행자에게 위임하면 된다. UX는 그대로다 — 사용자는 여전히 Slack 버튼만 누른다.

- merge / 브랜치 삭제: admin GitHub 토큰 대신 gitops 리포 한정 fine-grained PAT. 봇은 트리거만.
- ArgoCD sync: `admin:apiKey`가 아니라 프로젝트 스코프 + 필요한 액션만 가진 계정. 실제로 새 봇의 ArgoCD 토큰은 `applications, get` 정도의 읽기 스코프로 잡았다.
- Jenkins: admin 금지, 잡 단위로 스코프된 서비스계정.

여기까지 오면 봇 컨테이너 하나가 털려도 새는 건 "그 스코프만큼"이다. prod가 통째로 넘어가던 게, 특정 리포 PR을 건드리거나 특정 앱 상태를 읽는 정도로 줄어든다.

평문 `.env`를 secret manager(SOPS / Vault / External Secrets 중 택1)로 옮기는 건 아직 결정을 안 했다. 팀 규모 대비 어디까지 갈지는 더 봐야 해서, 여기선 "정했다"고 못 쓰겠다.

## 참고

- [ArgoCD RBAC Configuration](https://argo-cd.readthedocs.io/en/stable/operator-manual/rbac/)
- [Removing sensitive data from a repository (GitHub)](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)
- [Managing personal access tokens (GitHub)](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
- [Verifying requests from Slack (HMAC)](https://api.slack.com/authentication/verifying-requests-from-slack)
- [OWASP Threat Modeling](https://owasp.org/www-community/Threat_Modeling)
- [[Jenkins·GitOps·ArgoCD 배포를 Slack 봇 하나로 묶기|이 자격증명이 몰려 있던 배포 봇 이야기]]
