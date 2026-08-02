---
title: Helmfile로 dev·stg·prod 멀티환경 부트스트랩하기
date: 2026-02-24
draft: false
tags:
  - kubernetes
  - helmfile
  - helm
  - gitops
  - iac
banner: 
cssclasses: 
description: 환경마다 클러스터 기반 컴포넌트를 복붙하던 걸, 공통 값과 환경 값을 딥머지하고 needs로 설치 순서를 묶어 TARGET_ENV 하나로 재현하게 만든 기록.
permalink: 
aliases: 
completed: true
type:
  - tooling
---

## 요약

> [!SUMMARY]
> 클러스터를 새로 깔 때마다 istio·gpu-operator·nfs 같은 기반 컴포넌트를 환경별로 복붙하던 걸 정리했다. `values/common`에 공통 값을 두고 환경 디렉토리에서 덮어쓰는 딥머지(deep merge) 구조를 `gotmpl`로 짜고, 설치 순서는 helmfile `needs`로 선언했다. 이제 `TARGET_ENV=prod helmfile sync` 한 줄이면 그 환경이 통째로 올라온다. istio를 helm으로 업그레이드할 때 나던 field conflict는 필요한 순간에만 server-side apply로 눌렀다.

## 1. 환경마다 컴포넌트를 다시 정의하던 문제

클러스터 위에 애플리케이션을 올리기 전에 항상 깔아야 하는 기반 컴포넌트가 있다. 서비스 메시(istio-base / istiod / gateway), GPU 스케줄링을 위한 gpu-operator, 스토리지를 위한 nfs-server와 프로비저너. 이걸 dev, stg, prod 클러스터마다 helm으로 하나씩 설치하고 있었다.

문제는 이 컴포넌트들이 환경별로 <b>조금씩만</b> 다르다는 거였다. istiod pilot 리소스나 gateway NodePort 매핑, mesh 설정은 사실상 모든 환경이 같다. 정작 갈리는 건 GPU가 있는 환경이냐(prod), 이미지를 사내 레지스트리에서 당겨오냐, NFS를 어느 노드에 핀(pin)하냐 정도다. 그런데 관리 방식은 환경마다 values 파일을 통째로 복사해두고 다른 부분만 손으로 고치는 식이었다.

이러면 뻔한 사고가 난다. 공통이어야 할 gateway 포트 하나를 stg에서만 고치고 prod에는 반영을 잊는다. 새 환경을 하나 추가하려면 수백 줄짜리 values를 복붙한 뒤 무엇이 공통이고 무엇이 환경 고유인지 다시 눈으로 훑어야 한다. "이 클러스터 기반 컴포넌트를 어떻게 깔았더라"가 사람 머릿속에만 있고 코드에 없었다.

그래서 두 가지를 코드로 옮기고 싶었다. 하나는 <b>공통 값과 환경 값의 분리</b>, 다른 하나는 <b>컴포넌트 사이의 설치 순서</b>다.

## 2. 공통 값과 환경 값 딥머지

디렉토리는 이렇게 잡았다. 공통 값 하나에 환경별 디렉토리를 나란히 둔다.

```text
cluster-base/
  helmfile.yaml
  env.gotmpl          # 환경 스코프 값 (release 조건 판단용)
  values.gotmpl       # release 스코프 값 (차트에 넘길 values)
  charts/             # istio-base, istiod, gateway, gpu-operator, nfs-* ...
  values/
    common/values.yaml   # 모든 환경 공통
    dev/values.yaml      # 환경별 override
    stg/values.yaml
    prod/values.yaml
```

`common`을 베이스로 깔고 환경 값으로 <b>덮어쓰는</b> 딥머지로 만들었다. Helm 자체는 여러 values 파일을 순서대로 오버레이해주지만, 나는 파일을 나열하는 것보다 "공통 트리 위에 환경 트리를 재귀적으로 병합"하는 규칙 하나로 통일하고 싶었다. 그래서 sprig의 `mergeOverwrite`(재귀 딥머지)를 쓰는 `gotmpl`을 직접 짰다.

`env.gotmpl`은 환경 스코프에서 동작한다. `TARGET_ENV`로 어떤 환경인지 받아 common과 해당 환경 values를 읽고, 통째로 딥머지한 결과를 helmfile의 환경 값으로 내놓는다. 이 값이 `condition:` 판단(어떤 release를 설치할지)에 쓰인다.

```gotmpl
{{/* env.gotmpl — common + 환경 values를 통째로 딥머지해 환경 값으로 노출 */}}
{{- $env := requiredEnv "TARGET_ENV" -}}

{{- $commonValues := dict -}}
{{- if isFile "values/common/values.yaml" -}}
{{-   $commonValues = readFile "values/common/values.yaml" | fromYaml -}}
{{- end -}}

{{- $envPath := printf "values/%s/values.yaml" $env -}}
{{- $envValues := dict -}}
{{- if isFile $envPath -}}
{{-   $envValues = readFile $envPath | fromYaml -}}
{{- end -}}

{{/* 환경 값이 공통 값을 재귀적으로 덮어쓴다 */}}
{{- mergeOverwrite $commonValues $envValues | toYaml -}}
```

`values.gotmpl`은 한 단계 더 좁은 <b>release 스코프</b>에서 동작한다. 각 차트에 넘길 values를 만들 때, common과 환경 values에서 `.Release.Name` 키에 해당하는 서브트리만 뽑아 딥머지한다. 예를 들어 `istio-istiod` release를 렌더할 땐 두 파일의 `istio-istiod:` 아래만 병합한다.

```gotmpl
{{/* values.gotmpl — 지금 렌더 중인 release의 서브트리만 골라 딥머지 */}}
{{- $env := requiredEnv "TARGET_ENV" -}}
{{- $common := readFile "values/common/values.yaml" | fromYaml -}}
{{- $envVals := readFile (printf "values/%s/values.yaml" $env) | fromYaml -}}

{{- $name := .Release.Name -}}
{{- $commonRelease := dict -}}
{{- if hasKey $common $name }}{{ $commonRelease = index $common $name }}{{ end -}}
{{- $envRelease := dict -}}
{{- if hasKey $envVals $name }}{{ $envRelease = index $envVals $name }}{{ end -}}

{{- $merged := mergeOverwrite $commonRelease $envRelease -}}
{{/* enabled는 helmfile condition이 관리하므로 차트 values에서는 뺀다 */}}
{{- $_ := unset $merged "enabled" -}}
{{- if ne (len $merged) 0 }}{{ $merged | toYaml }}{{ end -}}
```

여기서 조금 헷갈렸던 게 `enabled` 필드다. 나는 `enabled`를 두 용도로 쓰고 싶었다. helmfile 레벨에선 "이 release를 아예 설치할지 말지"의 스위치(`condition`)로, 하지만 그 값을 차트 values에까지 그대로 흘려보내면 차트에 따라 의미가 겹치거나 스키마에서 걸린다. 그래서 release 스코프 병합 결과에서 `enabled`를 `unset`으로 걷어냈다. 스위치는 환경 스코프에만 남기고, 차트에는 설정 값만 넘긴다는 뜻이다.

common의 `values.yaml`은 이렇게 생겼다. 기본은 다 꺼두고(`enabled: false`) 공통 설정만 담아둔다.

```yaml
# values/common/values.yaml — 공통값. 켜는 건 환경 값의 몫
istio-base:
  enabled: true
  defaultRevision: default

istio-istiod:
  enabled: false            # 기본은 꺼둠
  pilot:
    replicaCount: 2         # 켜지면 모든 환경이 이 값을 물려받음
    resources:
      requests: { cpu: 500m, memory: 2Gi }

gpu-operator:
  enabled: false            # GPU 있는 환경에서만 켠다
nfs-server:
  enabled: false
```

prod 값에서는 GPU와 istiod를 켜고, common에 없던 것만 얹는다. `pilot.replicaCount` 같은 공통 값은 다시 적지 않는다. 딥머지라 알아서 물려받는다.

```yaml
# values/prod/values.yaml — common을 덮어쓰는 부분만
istio-istiod:
  enabled: true             # 여기서 켠다. pilot 설정은 common에서 상속
istio-gateway:
  enabled: true
gpu-operator:
  enabled: true
  operator:
    repository: registry.internal:30500   # 사내 레지스트리에서 이미지 pull
  driver:
    enabled: false          # 호스트에 드라이버가 이미 깔려 있어 끔
```

이걸로 "공통을 한 곳에서 고치면 전 환경에 반영된다"와 "환경 고유값만 그 환경 파일에 있다"가 코드로 강제된다. stg에서 gateway 포트를 고치고 prod에 반영을 잊는 종류의 사고가 구조적으로 안 난다.

## 3. helmfile needs로 엮은 설치 순서

값만 정리해선 부족했다. 이 컴포넌트들엔 순서가 있다. istio-base(CRD)가 먼저 들어가야 istiod가 뜨고, istiod가 있어야 gateway가 의미 있다. nfs 프로비저너는 nfs-server가 떠 있어야 스토리지클래스를 붙인다. 예전엔 이 순서가 설치 스크립트의 명령어 나열 순서, 즉 사람 기억에 있었다.

helmfile `needs`는 이 의존성을 release 사이의 그래프로 선언하게 해준다. 실행 순서를 내가 나열하는 게 아니라, "무엇이 무엇을 필요로 하는지"만 적으면 helmfile이 위상 정렬해서 순서를 정한다.

```yaml
# helmfile.yaml (발췌) — condition으로 설치 여부, needs로 순서를 선언
releases:
  - name: istio-base
    namespace: istio-system
    condition: istio-base.enabled       # 환경 값이 스위치
    inherit: [ { template: app-default } ]

  - name: istio-istiod
    namespace: istio-system
    condition: istio-istiod.enabled
    needs: [ istio-base ]               # base가 먼저

  - name: istio-gateway
    namespace: istio-system
    condition: istio-gateway.enabled
    skipSchemaValidation: true          # gateway 차트 스키마 이슈로 필수
    needs: [ istio-istiod ]             # istiod 다음

  - name: nfs-server
    namespace: platform-system
    condition: nfs-server.enabled

  - name: nfs-subdir-external-provisioner
    namespace: platform-system
    condition: nfs-subdir-external-provisioner.enabled
    needs: [ platform-system/nfs-server ]   # 서버가 뜬 뒤 프로비저너
```

`condition`과 `needs`가 각자 다른 일을 한다. `condition`은 "이 환경에서 이걸 설치하나"를 환경 값(2절의 딥머지 결과)으로 판단하고, `needs`는 "설치한다면 무엇 다음이냐"를 정한다. 그래서 GPU가 없는 dev에선 gpu-operator release가 조건에서 걸러져 아예 계획에 안 들어오고, 켜진 것들만 순서대로 흐른다. `needs`에 네임스페이스를 붙인 `platform-system/nfs-server` 표기는 같은 이름의 release가 여러 네임스페이스에 있을 때를 대비한 helmfile 문법이다.

`inherit` + `templates`로 각 release의 공통 골격(차트 경로, 차트 기본 `values.yaml`, 2절의 `values.gotmpl`)을 한 번만 정의해두고 재사용했다. release마다 같은 경로를 반복해 적지 않아도 된다.

## 4. TARGET_ENV 하나로 프로비저닝

환경을 바꾸는 축이 `TARGET_ENV` 환경변수 하나로 수렴한다.

```bash
# 계획만 렌더해서 눈으로 확인 (아무것도 설치 안 함)
TARGET_ENV=stg helmfile template

# 실제로 그 환경을 통째로 동기화
TARGET_ENV=prod helmfile sync
```

`env.gotmpl`의 `requiredEnv "TARGET_ENV"` 덕분에 이 변수를 안 주면 렌더 자체가 실패한다. "어느 환경인지 깜빡하고 그냥 돌렸다"가 원천 차단된다. 새 환경을 추가하는 것도 이제 `values/<이름>/values.yaml`을 만들고 common과 다른 값만 적는 일로 줄었다. helmfile.yaml은 안 건드린다.

`helmfile template`으로 먼저 렌더 결과를 본 뒤 `sync`하는 흐름도 생겼다. 딥머지가 의도대로 됐는지, prod에서 GPU가 켜졌는지를 클러스터에 손대기 전에 텍스트로 확인할 수 있다.

## 5. istio 업그레이드 conflict와 server-side apply

이 구조를 실제로 굴리다 istio를 helm으로 업그레이드할 때 벽에 부딪혔다. `sync`가 istio 리소스에서 field conflict를 뱉으며 멈췄다.

원인은 소유권이었다. istio를 처음 깔 때, 또는 istioctl이나 다른 경로가 한 번이라도 리소스를 만졌으면, 그 리소스의 일부 필드에 <b>다른 field manager가 소유권</b>을 갖게 된다. 이 상태에서 helm이 client-side로 apply하면 "이 필드는 네가 관리하는 게 아닌데 왜 바꾸려 하냐"며 충돌이 난다. istio처럼 CRD와 webhook, 여러 리소스가 얽힌 컴포넌트에서 특히 잘 터진다.

해결은 helm의 apply 방식을 <b>server-side apply</b>로 바꾸고 충돌을 강제로 넘기는 것이다. `--server-side=true`로 필드 소유권을 API 서버가 관리하게 하고, `--force-conflicts`로 충돌하는 필드의 소유권을 지금 이 apply 주체(helm)로 가져온다. "이 필드는 이제 내가 관리한다"고 선언하고 밀어붙이는 것이다.

처음엔 이 두 인자를 helmDefaults의 `args`에 박아 모든 release에 default로 걸어봤다. 그런데 이렇게 두니 `helmfile diff`가 깨졌다. server-side로 켜면 diff 단계에서 오류가 나서, 계획을 텍스트로 먼저 확인하는 흐름(4절)을 못 쓰게 된다. 그래서 helmDefaults에 상시로 두는 건 접고 주석 처리했다.

대신 평소 `sync`는 그대로 두고, 충돌이 나는 업그레이드에서만 sync에 인자를 실어 보내는 쪽으로 갔다.

```bash
# 필드 소유권 충돌이 나는 업그레이드에서만 server-side apply 를 실어 sync
helmfile sync --sync-args "--server-side=true --force-conflicts"
```

`--force-conflicts`는 다른 컨트롤러가 정당하게 관리하던 필드까지 뺏어올 수 있으니 아무 데나 남발할 인자는 아니다. 이 helmfile이 다루는 게 클러스터 기반 컴포넌트라 helm이 유일한 관리 주체인 건 맞지만, diff까지 희생하면서 상시 default로 둘 이유는 없다고 봤다.

## 참고

- [Helmfile documentation](https://helmfile.readthedocs.io/en/latest/)
- [Helmfile — release dependencies (needs)](https://helmfile.readthedocs.io/en/latest/#dependencies)
- [Sprig — dictionary functions (mergeOverwrite)](https://masterminds.github.io/sprig/dicts.html)
- [Kubernetes — Server-Side Apply](https://kubernetes.io/docs/reference/using-api/server-side-apply/)
- [helm upgrade](https://helm.sh/docs/helm/helm_upgrade/)
- [[레거시 K8s 배포를 Helmfile 3계층 형상으로 이관하기|Helmfile 3계층 형상으로 이관한 이야기]]
- [[멀티사이트 Helm 차트 배포 형상을 타겟 브랜치와 불변 태그로 관리하기]]
