---
title: "GitOps 비밀 관리 도입기: SOPS + age 값 단위 암호화"
date: 2026-06-23
draft: false
featured: true
tags:
  - sops
  - age
  - gitops
  - helmfile
  - secrets-management
  - air-gapped
banner: 
cssclasses: 
description: 폐쇄망 멀티사이트에서 비밀을 평문 없이 Git에 담기 위해, SOPS + age 값 단위 암호화를 helmfile 렌더에 통합하고 키 회전·분실 복구 절차까지 만든 도입 기록.
permalink: 
aliases: 
completed: true
type:
  - tooling
---

## 요약

> [!SUMMARY]
> 폐쇄망 멀티사이트에 배포하는 Helm values 안에 DB 비밀번호 같은 비밀이 평문으로 섞여 있던 걸 <b>SOPS + age 값 단위 암호화</b>로 없앴다. common은 비밀 자리를 센티넬 더미로만 두고 적용 사이트만 `secrets.yaml`을 암호화하며, helmfile이 렌더할 때 `sops -d`로 <b>메모리에서만 복호화</b>해 디스크에 평문이 안 떨어지게 했다.

## 1. 도입 배경

우리 배포는 helmfile로 여러 사이트(현장)에 같은 차트를 값만 바꿔가며 올린다. 문제는 그 값 파일 안에 DB 비밀번호, 오브젝트 스토리지 루트 비밀번호 같은 게 <b>평문으로</b> 들어 있었다는 거다. Git에 그대로 올라간다는 뜻이다.

폐쇄망이므로 밖으로 샐 일이 없다고 자위할 수도 있지만, 그것은 방어가 아니라 그냥 운이다. 사이트가 늘수록 사이트마다 다른 비밀이 리포에 평문으로 쌓이고, 누가 언제 뭘 바꿨는지도 흐려진다. 클라우드였다면 Vault든 KMS든 붙였겠지만 현장은 대개 인터넷이 없다. 외부 시크릿 매니저를 상시 호출하는 구조는 애초에 쓸 수 없었다.

그래서 조건은 다음과 같이 좁혀졌다.

- 비밀은 <b>Git 안에</b> 두되 평문이면 안 된다(GitOps를 포기하고 싶진 않았다).
- 복호화에 외부 네트워크가 필요하면 안 된다(폐쇄망).
- 사이트마다 키가 격리돼서, 한 현장 키가 새도 다른 현장 비밀은 안전해야 한다.
- 값 전체가 아니라 <b>비밀 값만</b> 암호화되면 좋겠다. YAML 통암호화는 diff에서 변경 내용이 보이지 않아서 코드 리뷰가 무의미해진다.

## 2. 값 단위 암호화와 SOPS + age

마지막 조건 때문에 SOPS를 선택했다. SOPS는 YAML의 <b>값만</b> 암호화하고 키는 평문으로 남긴다. `MONGO_PASSWORD: ENC[...]` 처럼 되니 어떤 키가 있는지, 구조가 어떻게 바뀌었는지는 diff로 그대로 읽힌다. 값만 보이지 않을 뿐이다.

암호화 백엔드로는 age를 선택했다. GPG는 폐쇄망에서 keyring 관리가 번거롭고, KMS류는 네트워크가 필요하다. age는 공개키/개인키 한 쌍이면 충분하고 바이너리 하나로 끝난다. 폐쇄망에 반입하기에 이보다 나은 도구가 없었다.

`sops` 3.13.1, `age`/`age-keygen` 1.3.1로 버전을 고정하고 GitHub Releases에서 바이너리를 받아 반입했다. helm-secrets 플러그인은 사용하지 않았다. helmfile이 sops를 직접 부르고 age 복호화는 sops에 내장돼 있어서, 플러그인이라는 층을 하나 더 둘 이유가 없었다. `age-keygen`은 키 생성 때만 쓴다.

```bash
# 배포 호스트에 바이너리 반입 (폐쇄망: Releases에서 받아 USB 등으로 옮김)
chmod +x sops-v3.13.1.linux.amd64
sudo mv sops-v3.13.1.linux.amd64 /usr/local/bin/sops

tar xzf age-v1.3.1-linux-amd64.tar.gz
sudo mv age/age age/age-keygen /usr/local/bin/

sops --version
age-keygen --version
```

## 3. common 센티넬과 env secrets 병합

우리 values는 원래 3층 구조다. `common`에는 공통 기본값이 있고 `<env>`(사이트)에는 사이트별 오버라이드가 있다. 여기에 비밀만 담는 층을 하나 더 얹었다.

```
values/common/values.yaml   ← 비밀 키 "구조"만. 값은 센티넬. 평문·무암호화.
values/<사이트>/values.yaml  ← 사이트 설정(비밀 아님)
values/<사이트>/secrets.yaml ← 그 사이트의 실 비밀. SOPS+age로 암호화.
```

common에는 비밀 값을 절대 두지 않는다. common은 "이 자리에 비밀이 온다"는 것을 알리는 <b>센티넬(sentinel)</b> 더미만 담는다. 값은 전부 `__OVERRIDE_REQUIRED__`다.

```yaml
# values/common/values.yaml (발췌 — 구조만 있고 값은 더미)
shared-resources:
  secrets:
    app-mongodb-client-secret:
      stringData:
        MONGO_PASSWORD: __OVERRIDE_REQUIRED__
postgresql:
  secret:
    postgresPassword: __OVERRIDE_REQUIRED__
```

이 더미가 두 가지 일을 한다. 하나는 "이 사이트에서 채워야 할 비밀 목록"을 그 자체로 보여준다는 것(센티넬을 grep하면 채울 목록이 나온다). 다른 하나는 안전장치다. 어떤 사이트가 비밀을 덜 채우면 렌더 결과에 `__OVERRIDE_REQUIRED__`가 그대로 남고, 그게 비밀번호로 쓰여 배포 후 인증이 깨진다. 즉 <b>깜빡한 비밀은 조용히 넘어가지 않고 반드시 티가 난다</b>. 이 점은 뒤(7절)에서 검증 게이트로 다시 쓴다.

병합 순서는 다음과 같이 잡았다.

```
common(더미)  <  env values  <  env secrets(있으면, 메모리 복호화)
```

secrets.yaml이 있는 사이트만 마지막 단계에서 실 비밀이 더미를 덮어쓴다. secrets.yaml이 아직 없는 사이트는 복호화 단계 없이 기존대로 렌더된다. 그래서 전면 전환이 아니라 <b>사이트별로 하나씩</b> 켤 수 있었다. 도입기에는 이게 제일 중요했다. 한 방에 다 바꾸는 마이그레이션은 겁이 나니까.

## 4. recipient 규칙과 사이트 키 격리

암호화할 때 "누구 키로 열 수 있게 할지"를 recipient로 지정한다. 이걸 파일마다 손으로 적으면 실수하기 딱 좋아서, `charts/.sops.yaml`에 경로 규칙으로 박아뒀다. 경로 패턴에 맞는 파일은 자동으로 정해진 recipient 목록으로 암호화된다.

```yaml
# charts/.sops.yaml — 경로별 recipient 규칙 (age 공개키는 마스킹함)
creation_rules:
  - path_regex: .*values/site-a[^/]*/secrets\.yaml$
    key_groups:
      - age:
          - age1master...   # master (복구·재키잉, 오프라인 보관)
          - age1sitea...    # site-a 사이트 키
  - path_regex: .*values/stg[^/]*/secrets\.yaml$
    key_groups:
      - age:
          - age1master...   # master
          - age1stg...      # stg 사이트 키
```

규칙은 두 가지다.

- <b>사이트 키 격리</b>: 각 사이트 secrets는 그 사이트 키로만 열린다. site-a 키는 site-a 비밀만, stg 키는 stg 비밀만. 현장 배포 호스트에는 그 사이트 키 하나만 배치하고 다른 사이트 키는 두지 않는다. 한 현장 키가 유출돼도 반경이 그 사이트에 갇힌다.
- <b>master 키</b>는 모든 사이트 secrets의 공동 recipient다. 복구·재키잉·CI 검증을 이 키 하나로 다 한다. 대신 배포 호스트엔 절대 두지 않고 오프라인에 custody한다.

recipient가 2개면 SOPS는 데이터 암호화 키(DEK)를 각 공개키로 각각 봉인해 둔다. 그래서 사이트 키로도, master로도 같은 파일을 열 수 있다. 비밀 값 자체가 두 번 암호화되는 게 아니라 DEK만 두 벌 포장되는 것뿐이라, recipient를 늘려도 암호문 본문은 그대로다.

> [!NOTE]
> sops는 현재 디렉토리에서 상위로 `.sops.yaml`을 찾는다. 우리 `.sops.yaml`은 리포 루트가 아니라 `charts/` 안에 있어서(차트 디렉토리가 반입 단위라 그 안에 뒀다), 리포 루트에서 그냥 `sops`를 쓰면 "config not found"가 난다. 그래서 암호화·편집·`updatekeys`에는 `--config charts/.sops.yaml`을 붙인다. 반면 복호화·렌더는 `.sops.yaml`이 필요 없어서 cwd와 무관하다 — 고객사 현장 배포는 차트만으로 돌아간다. 이 비대칭이 처음엔 헷갈렸다.

평문으로 초안을 쓰고 마지막에 암호화하는 것이 원칙이다. `sops:` 블록은 손으로 쓰지 않는다.

```bash
# 평문 secrets.yaml 초안을 만든 뒤 in-place 암호화
sops --config charts/.sops.yaml -e -i charts/2.app-data/values/site-a-app-2/secrets.yaml

# 값만 ENC[...] 로 바뀌고 키(MONGO_PASSWORD 등)는 평문으로 남았는지 눈으로 확인
grep -E 'MONGO_PASSWORD|ENC\[|recipient:' charts/2.app-data/values/site-a-app-2/secrets.yaml | head
```

## 5. helmfile 렌더 시 메모리 복호화

복호화를 언제, 어디서 할 것인지가 이 설계의 관심사였다. 파일로 한 번 복호화해두고 helmfile을 돌리면 그 순간 평문이 디스크에 떨어진다. 그건 원점 회귀다.

그래서 복호화를 helmfile 렌더 파이프라인 안으로 밀어넣었다. `charts/_shared/values.gotmpl`이 값을 병합할 때, secrets.yaml이 있으면 그 자리에서 `sops -d`를 호출해 <b>메모리에서만</b> 복호화한다.

```gotmpl
{{- /* 암호화된 env secrets 를 메모리에서 복호화. common 은 더미라 복호화 불요 */ -}}
{{- $envSecrets := dict -}}
{{- $envSecretsPath := printf "values/%s/secrets.yaml" $env -}}
{{- if isFile $envSecretsPath -}}
{{-   $envSecrets = exec "sops" (list "-d" $envSecretsPath) | fromYaml -}}
{{- end -}}
{{- $envSecretRelease := $envSecrets | dig $releaseKey dict -}}

{{- /* 병합: common(더미) < env values < env secrets(실값) */ -}}
{{- $merged := mergeOverwrite $commonRelease $envRelease -}}
{{- $merged = mergeOverwrite $merged $envSecretRelease -}}
```

`exec "sops" (list "-d" ...)`가 sops를 자식 프로세스로 띄워 복호화 결과를 stdout으로 받고, 그걸 `fromYaml`로 파싱해 병합에만 쓴다. 파일로 새는 경로가 없다. secrets.yaml이 없는 사이트는 `isFile`이 false라 이 블록을 통째로 건너뛰므로, 미적용 사이트가 깨지지도 않는다.

배포 쪽에서 보면 별도 복호화 단계가 없다. 그냥 평소처럼 돌린다.

```bash
# <사이트> 자리에 실제 환경명. 키가 없거나 틀리면 렌더가 즉시 실패한다.
TARGET_ENV=<사이트> helmfile sync
```

키가 있어야 렌더가 되고, 없으면 그 자리에서 멈춘다. "복호화가 됐나 안 됐나"를 따로 확인할 필요 없이, 배포가 성공했다는 게 곧 복호화가 됐다는 뜻이다. age 키는 sops가 OS 기본 경로(`~/.config/sops/age/keys.txt` 등)에서 자동으로 찾으므로 환경변수도 대개 필요 없다.

> [!INFO]- 왜 이 방식(helmfile gotmpl에서 exec)을 골랐나
> helmfile 네이티브 `secrets:` per-release 방식도 준비는 해뒀는데, gotmpl에서 `exec`로 sops를 직접 부르는 쪽이 값 병합 로직(common < env < secrets)과 한 군데에 모여서 흐름을 읽기 쉬웠다. 검증 당시 helmfile v1.2.3에서 정상 동작했고, `exec` 템플릿 함수는 이후 버전대에도 유지된다. 다만 버전 올릴 때 한 번씩 재확인하는 게 안전해서, 막힐 경우 네이티브 방식으로 갈아타는 경로를 설계 문서에 적어뒀다. 만능이라 고른 게 아니라, 지금 구조에 붙이기 가장 단순해서 골랐다는 쪽이 정직하다.

## 6. 키 회전, 분실 복구, 새 사이트 추가

암호화를 켜는 것보다 오래가는 문제는 <b>키를 어떻게 관리하느냐</b>다. 담당자가 바뀌고, 키를 잃어버리고, 사이트가 늘어난다. 이걸 매번 즉흥으로 처리하면 언젠가 사고가 난다. 그래서 세 가지 절차를 런북으로 못박았다.

<b>키 회전.</b> 새 키를 만들고, `.sops.yaml`의 recipient를 새 공개키로 바꾼 뒤, 대상 파일들을 `updatekeys`로 다시 봉인한다. 여기서 중요한 건 `updatekeys`가 <b>비밀 값은 건드리지 않고 DEK 포장만 새 키로 다시 한다</b>는 점이다. 값을 다시 입력할 필요가 없다.

```bash
age-keygen -o new-site-a.key            # 새 키 생성, 출력에서 공개키(age1...) 확인
# .sops.yaml 의 site-a recipient 를 새 공개키로 교체 후:
sops --config charts/.sops.yaml updatekeys --yes charts/1.app-base/values/site-a/secrets.yaml
sops --config charts/.sops.yaml updatekeys --yes charts/2.app-data/values/site-a-app-2/secrets.yaml
# 새 개인키를 배포 호스트에 out-of-band 전달, 이전 키는 폐기
```

<b>분실 복구.</b> 여기서 <b>분실과 유출을 구분</b>한 게 핵심이다. 사이트 키를 잃어버린 것(분실)과 남한테 넘어간 것(유출)은 대응이 다르다.

- 분실: master 키로 파일을 다시 열 수 있으니, 새 사이트 키를 만들어 `updatekeys`로 재봉인하면 끝이다. 비밀 값은 안 샜으니 회전할 필요가 없다.
- 유출: 재키잉만으론 부족하다. 노출된 비밀번호 값 자체를 서비스마다 바꿔야 한다. 이건 sops 절차가 아니라 각 서비스 비밀 교체 작업이다.

분실 복구가 성립하는 이유가 바로 4절에서 master를 공동 recipient로 넣어둔 것이다. 사이트 키를 다 잃어도 오프라인 master로 되살릴 여지를 남겨둔 셈이다.

```bash
# 분실 복구: master 키로 임시 작업 (오프라인 custody 에서 꺼냄)
export SOPS_AGE_KEY_FILE=/path/to/master.key
age-keygen -o new-site-a.key            # 새 사이트 키
# .sops.yaml recipient 교체 후 대상 파일 updatekeys → 새 키만 현장 전달 → master 오프라인 복귀
```

<b>새 사이트 추가.</b> 새 키 생성 → `.sops.yaml`에 경로 규칙 추가(master + 새 사이트 키) → common 센티넬을 기준으로 secrets.yaml 작성 → 암호화 → 완전성 확인 → 개인키 현장 전달. 순서를 리스트로 고정해 두니 새 현장 온보딩이 "런북 따라가기" 방식으로 바뀌었다.

## 7. 렌더 평문 유출 방지와 CI 검증

메모리 복호화까지 해 놓았어도 사람이 평문을 흘리는 경로가 하나 남는다. `helmfile template`의 출력에는 복호화된 비밀 평문이 들어 있다. 이걸 파일로 저장하는 순간 원점이다.

```bash
# 금지: 비밀 평문이 output.yaml 로 디스크에 남는다
TARGET_ENV=site-a helmfile template > output.yaml

# 허용: 화면 확인 / 파이프로 흘려보기
TARGET_ENV=site-a helmfile template
TARGET_ENV=site-a helmfile template | grep -A5 'kind: Secret'
```

이건 도구로 막기 애매한 규칙이라 런북에 크게 써두고, 렌더 산출물 경로는 `.gitignore`에 넣어 커밋에 안 들어가게 했다. 완벽한 가드는 아니고 "실수해도 커밋까진 안 간다" 수준의 이중 안전장치다.

검증은 두 겹으로 걸었다.

<b>복호화 게이트(CI).</b> CI가 암호화된 secrets.yaml들이 <b>master 키로 다 열리는지</b>만 검사한다. master가 모든 사이트 secrets의 공동 recipient이므로 키 하나로 전 사이트를 검증한다. 어떤 파일이 깨졌거나 recipient에서 빠졌으면 여기서 걸린다.

```bash
# CI 가 도는 검사 (master 키가 있으면 로컬에서도 동일)
for f in $(find charts -path '*/values/*/secrets.yaml' ! -path '*/common/*'); do
  sops -d "$f" >/dev/null 2>&1 && echo "OK   $f" || echo "FAIL $f"
done
```

<b>완전성 게이트(수동).</b> common 센티넬을 그 사이트가 다 채웠는지는 렌더 결과에 센티넬이 남는지로 본다. 3절에서 더미를 `__OVERRIDE_REQUIRED__`로 둔 게 여기서 값을 한다.

```bash
# 0 이면 완전. 0 이 아니면 그 수만큼 안 채운 비밀이 있다(= 배포 시 그 값이 더미라 인증 실패)
cd charts/<레이어> && TARGET_ENV=<사이트> helmfile template | grep -c __OVERRIDE_REQUIRED__
```

복호화 게이트는 "열리는가"를 검사하고 완전성 게이트는 "다 채웠는가"를 검사한다. 둘은 다른 실수를 잡아서 하나로 합쳐지지 않는다.

## 8. 한계

아직 도입 단계다. 운영으로 넘기기 전에 정리할 게 남아 있다.

- 현재 키는 개발용이다. 운영 전에 master·사이트 키를 실제 키로 재발급하고 master는 하드웨어/비밀번호 관리자에 custody해야 한다. 지금은 편의상 dev에 있다.
- CI 통합. 사내 CI가 별도로 있어서, 비밀 렌더에 필요한 복호화 키를 CI 에이전트에 자격증명으로 주입하는 부분을 정리해야 한다.
- Argo CD로 넘어갈 경우, repo-server가 age 개인키 Secret을 마운트해야 복호화가 된다. 이 Secret이 없으면 repo-server가 아예 안 뜬다. 준비는 해뒀고 실제 연결은 GitOps 리포가 암호화 values를 담기 시작할 때 켠다.
- 전용 CI 키. 지금은 복호화·CI 검증을 다 master로 겸하는데, 나중에 CI 전용 키나 OpenBao 같은 걸 붙이면 master의 역할을 줄일 수 있다. 여유가 생기면 볼 일이다.

전면 적용을 미루고 사이트 단위로 켜는 구조라 이 미완들이 배포를 막지는 않는다. 그게 단계적 적용으로 설계한 이유이기도 하다.

## 참고

- [SOPS](https://github.com/getsops/sops) — 값 단위 암호화, age 백엔드 내장
- [SOPS v3.13.1 릴리스](https://github.com/getsops/sops/releases/tag/v3.13.1)
- [age](https://github.com/FiloSottile/age) — 폐쇄망 친화적인 파일 암호화 도구
- [age v1.3.1 릴리스](https://github.com/FiloSottile/age/releases/tag/v1.3.1)
- [helmfile](https://helmfile.readthedocs.io/en/latest/)
- [[레거시 K8s 배포를 Helmfile 3계층 형상으로 이관하기|SOPS를 얹은 Helmfile 3계층 형상]]
- [[멀티사이트 Helm 차트 배포 형상을 타겟 브랜치와 불변 태그로 관리하기]]
