---
title: govulncheck와 린트로 Go 프로젝트 기본기 잡기
date: 2026-01-22
draft: false
tags:
  - go
  - security
  - lint
  - govulncheck
  - deck
banner: 
cssclasses: 
description: Deck을 Go로 시작하며 포맷·린트·보안·취약점 스캔·민감정보 마스킹을 make 타깃과 CI에 박아둔 기록. golangci-lint(gosec 포함), gofumpt/gci, govulncheck, secretmask, 그리고 보안 예외를 "검토된 경계 파일 하나"에만 국소화한 방식.
permalink: 
aliases: 
completed: true
type:
  - note
---

## 요약

> [!SUMMARY]
> [[폐쇄망 전용 싱글 바이너리 워크플로우 도구 Deck 만들기|Deck]]을 Go로 시작하면서 프로젝트 기반 검사를 먼저 갖추었다. 포맷·린트·보안 린트(gosec)·취약점 스캔(govulncheck)·민감정보 마스킹을 모두 `make` 타깃으로 두고 CI에서 상시 실행한다. 핵심 결정은 두 가지다. 보안 린트 예외는 무작정 `nolint`로 끄지 않고 "위험이 실제로 존재하는 경계 파일 하나"에만 국소화했고, 취약점은 도달 가능성까지 확인하는 govulncheck로 노이즈를 줄였다.

기능을 추가하기 전에, 기능이 어떤 문제를 일으키더라도 걸러지는 검증 체계부터 갖추었다.

## 1. 기본기를 make 타깃 하나로

로컬에서 수행하는 검사와 CI의 결과가 어긋나는 상황을 피하고자, 검사 종류를 모두 `make` 타깃으로 두었다.

```text
make build            # 빌드 (버전 ldflags 주입)
make test             # go test ./...
make lint             # golangci-lint run
make vuln             # govulncheck ./...
make generate         # 스키마·CLI 문서 생성
make verify-generated # 생성물이 최신인지 (git diff --exit-code)
```

[[GitHub Actions 입문기|GitHub Actions]]에서는 이것을 그대로 호출만 한다(`run: make lint` 식). 그래서 "CI에서만 실패하는" 상황이 거의 발생하지 않는다. 내 노트북에서 `make lint && make vuln`을 통과하면 CI도 같은 결과를 낸다.

## 2. 포맷과 린트: golangci-lint

린트는 [golangci-lint](https://golangci-lint.run/)로 실행한다. 방침은 <b>`default: none` + 활성화할 항목만 명시</b>다. 기본값에 의존하지 않으며, 어떤 린터를 켰는지 설정만 보아도 알 수 있다.

```yaml
linters:
  default: none
  enable:
    - gosec          # 보안
    - errcheck       # 에러 무시 금지
    - govet
    - staticcheck
    - bodyclose      # HTTP body 안 닫는 것
    - nilerr         # nil 인데 err 반환 같은 실수
    - ineffassign
    - misspell
    - gocritic
    - gochecknoinits # init() 남용 금지
    # ...
formatters:
  enable: [gci, gofumpt]   # 임포트 정렬 + 엄격 포맷
```

포맷은 `gofumpt`(gofmt보다 엄격함)와 `gci`(임포트를 표준 → 서드파티 → 자기 모듈 순으로 정렬)로 강제한다. 포맷 논쟁이 사라진다는 점은 [[Java 하던 사람의 Go 적응기|Go의 gofmt 문화]]와 같은 맥락이다.

## 3. gosec 예외설정: 위험을 경계 하나에 가둔다

보안 린터 `gosec`가 잡아내는 항목을 다루는 방식이 이 프로젝트에서 가장 신경 쓴 부분이다. 흔한 실수는 경고가 발생할 때마다 해당 줄에 `//nolint`를 붙이는 것인데, 그러면 위험한 패턴이 코드 전체에 흩어지고 예외 설정도 함께 흩어진다.

그래서 반대 방향을 선택했다. <b>위험한 동작을 한 곳(검토된 경계 파일)에 집중시키고, gosec 예외도 그 파일에만</b> 둔다. `.golangci.yml`의 exclusions가 위험 지점 목록 역할을 한다.

- <b>외부 명령 실행(G204)</b> → `internal/executil`에서만 허용한다. 명령을 실행하는 코드가 feature 코드 여기저기 흩어지지 않고 executil을 거치도록 강제된다.
- <b>동적 파일 접근(G304)</b> → `internal/fsutil/safe_paths.go` 등 저수준 헬퍼에서만 허용한다. 경로를 받아 파일을 여는 위험은 이 지점으로 모인다.
- <b>호스트 경로 변경(G703)</b> → `internal/hostfs/host_path.go`에서만 허용한다. 호스트를 실제로 변경하는 신뢰 경계가 한 파일로 정해진다.
- 템플릿 응답 sink(G705), 디렉토리 순회(G122)도 같은 식으로 리뷰된 헬퍼 하나에만 예외.

효과가 좋았다. 예외 목록이 곧 <b>"이 프로젝트가 위험한 작업을 수행하는 지점 목록"</b>이 된다. 새 feature 코드에서 gosec 경고가 발생하면 "그 위험을 경계 헬퍼로 옮겨야 한다"는 신호로 해석한다. (테스트 파일에서는 shell-out과 임시 픽스처 생성이 정상적인 동작이므로 `G(122|204|301|302|304|306|703)`를 테스트 경계에서만 제외한다.)

## 4. govulncheck: 도달성까지 보는 취약점 스캔

의존성 취약점은 [govulncheck](https://pkg.go.dev/golang.org/x/vuln/cmd/govulncheck)로 확인한다(`make vuln` = `govulncheck ./...`). 일반 스캐너와 다른 점은 <b>"취약한 의존성이 존재하는지"가 아니라 "그 취약 함수를 실제로 호출하는 경로가 있는지"</b>까지 확인한다는 것이다. import만 하고 호출하지 않는 함수의 CVE는 걸러지므로, 대응해야 할 목록이 짧고 실질적이다. CI의 상시 보안 검사로 실행해서, 취약한 의존성이 PR 단계에서 차단된다.

(컨테이너 이미지 쪽 CVE는 성격이 다른 문제라 [[OSS 이미지 CVE 대응 프로세스 잡기|따로]] 정리했다. 여기서는 직접 작성한 Go 코드와 그 의존성만 다룬다.)

## 5. 민감정보 노출 막기: secretmask

폐쇄망용 도구이므로 로그나 출력에 자격증명이 섞여 나가면 그 자체가 사고가 된다. 그래서 출력 스트림에서 <b>알려진 시크릿 문자열을 `***`로 가리는 계층</b>(`internal/secretmask`)을 두었다. 문자열이 쓰기 청크 경계에 걸쳐 잘리더라도(`token=super-` + `secret`) 이어 붙여 탐지하도록 만들었다.

이 장치는 [[워크플로우 생성 AI 파이프라인 구성기|AI 보조 기능(ask)]]에서 특히 중요했다. 모델에 컨텍스트를 넘기는 과정에서 시크릿 토큰이 함께 유출되는 것을 막는 최종 방어선이기 때문이다.

## 6. 한계

이 검증 체계(포맷·린트·gosec·govulncheck·마스킹)를 CI 게이트로 갖추어 두니, 기능을 추가할 때 사람이 매번 "이 변경이 무엇을 망가뜨릴지"를 확인하지 않아도 된다. 특히 gosec 예외를 경계 파일에 한정한 방식 덕분에, 프로젝트가 커져도 위험 지점 목록이 흩어지지 않는다. 다음 숙제는 릴리스 아티팩트에 SBOM과 서명을 붙여 공급망 검증까지 확장하는 것이다.

## 참고

- [[폐쇄망 전용 싱글 바이너리 워크플로우 도구 Deck 만들기]]
- [[GitHub Actions 입문기]]
- [[OSS 이미지 CVE 대응 프로세스 잡기]]
- [golangci-lint](https://golangci-lint.run/)
- [govulncheck](https://pkg.go.dev/golang.org/x/vuln/cmd/govulncheck)
- [gosec](https://github.com/securego/gosec)
