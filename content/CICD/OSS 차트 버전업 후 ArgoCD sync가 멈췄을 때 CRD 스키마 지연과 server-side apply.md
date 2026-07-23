---
title: OSS 차트 버전업 후 ArgoCD sync가 멈춘 이유 — CRD 스키마 지연과 server-side apply
date: 2026-06-09
draft: false
featured: true
tags:
  - argocd
  - gitops
  - kubernetes
  - crd
  - server-side-apply
  - troubleshooting
banner: 
cssclasses: 
description: OSS 차트를 버전업했더니 ArgoCD가 diff 계산 단계에서 멈춰버린 상황을, 원인을 CRD 스키마 지연으로 짚고 새 CRD를 먼저 올려 푼 기록.
permalink: 
aliases: 
completed: true
type:
  - issue
---

## 🚀 요약

> [!SUMMARY]
> OSS 차트를 버전업하자 새 CR은 신규 필드를 렌더하는데 클러스터의 CRD 스키마는 옛 버전 그대로라, ArgoCD가 diff를 계산하는 단계에서 `ComparisonError`로 멈추고 sync가 교착됐다. Helm이 CRD를 자동 업그레이드하지 않는 게 원인이었고, 새 CRD를 `kubectl apply --server-side --force-conflicts`로 먼저 올려 교착을 풀었다.

## ⚙️ 환경

- ArgoCD로 관리하는 클러스터 `prod-01`, Application `platform-base`
- 대상 차트: `kube-prometheus-stack` 80.4.1 → 86.2.0 (prometheus-operator 0.91.0) 버전업

## 💬 이슈

차트 버전만 올렸는데 ArgoCD Application이 sync를 못 하고 앉아 있었다. 상태가 좀 이상했다.

- sync는 `Unknown`
- health는 `Healthy` (이미 떠 있는 워크로드는 멀쩡히 돌고 있었다)
- operation phase는 `Error`

health가 `Healthy`인데 sync가 `Unknown`이라 처음엔 뭐가 문제인지 감이 안 왔다. 실행 중인 파드는 다 정상이니까. conditions 메시지를 까보고서야 상황이 보였다.

```
ComparisonError: Failed to compare desired state to live state: failed to calculate diff:
error calculating structured merge diff: error building typed value from config resource:
.spec.<field>: field not declared in schema
```

여기서 눈여겨봐야 할 건 이게 <b>apply 실패가 아니라는 점</b>이다. apply를 시도하다 거부당한 게 아니라, 그 전 단계인 <b>desired 상태와 live 상태의 diff 계산</b> 자체가 깨졌다. ArgoCD는 매니페스트가 실제로 바뀌었는지 알아야 sync를 진행하는데, 그 판단을 위한 계산이 안 되니 아예 출발선에서 멈춰버린 것이다.

## 🧗 해결

### 1. field not declared in schema가 무슨 뜻인가

에러의 `field not declared in schema`가 핵심 단서였다. 이번엔 `.spec.hostNetwork`가 문제였다.

- 새 차트의 alertmanager 템플릿이 `spec.hostNetwork`를 <b>무조건 렌더</b>한다. prometheus-operator 0.91.0의 Alertmanager에 추가된 필드다.
- 그런데 클러스터에 깔려 있는 Alertmanager CRD는 0.87.1이라 `hostNetwork`를 아직 모른다. 스키마에 없는 필드다.
- 그래서 CR(매니페스트)에는 있는데 CRD(스키마)에는 없는 어긋남이 생겼다.

재밌는 건 같은 버전업인데도 Prometheus CRD는 hostNetwork를 이미 가지고 있어서 Prometheus 쪽은 정상적으로 diff가 됐다는 점이다. 필드가 CRD에 추가되는 시점이 리소스별로 제각각이라 이런 부분 불일치가 난다.

정말 CRD가 뒤처졌는지 직접 확인했다.

```bash
# 1) Application의 conditions에서 에러 메시지 확인
kubectl -n argo-cd get application platform-base \
  -o jsonpath='{.status.conditions[*].message}{"\n"}'

# 2) 문제 필드가 CRD 스키마에 실제로 있는지 (alertmanagers의 hostNetwork)
kubectl get crd alertmanagers.monitoring.coreos.com -o json \
  | jq -r '.spec.versions[].schema.openAPIV3Schema.properties.spec.properties | keys[] | select(test("host";"i"))'
# hostNetwork가 출력되지 않으면 CRD가 뒤처진 것
```

### 2. 왜 CRD만 뒤처졌나

원인은 Helm의 CRD 취급 방식이었다. <b>Helm은 차트에 든 CRD를 최초 설치 때만 깔고, 업그레이드 때는 건드리지 않는다.</b> prometheus-operator CRD도 예외가 아니다. 그러니 차트 버전을 올리면 CR을 렌더하는 템플릿은 새것으로 바뀌는데 CRD 스키마만 옛날 상태로 남는다. 이 구조를 몰랐으면 한참 헤맸을 대목이다.

여기에 ArgoCD 쪽 동작이 겹쳤다. ArgoCD는 structured-merge diff를 위해 CRD 스키마를 읽어 typed value를 만드는데, 매니페스트에 스키마에 없는 필드가 섞여 있으면 그 typed value 빌드에 실패한다. 이게 아까 본 `error building typed value`다.

문제는 이 `ComparisonError`가 <b>앱 전체의 diff를 막는다</b>는 것이다. 그래서 "ArgoCD가 알아서 새 CRD를 적용해 스스로 풀면 되지 않나" 싶지만, diff가 안 되니 sync 자체가 못 굴러가고, 결국 자가복구가 안 된다. 사람이 CRD를 먼저 올려서 교착을 끊어줘야 한다.

### 3. 새 CRD를 server-side apply로 먼저 적용

조치는 단순하다. 차트에 번들된 새 CRD를 클러스터에 먼저 올린다. 다만 `--server-side`가 필수다(이유는 아래 확인 섹션에).

```bash
# 차트 번들 CRD 적용 (해당 차트의 crds 경로)
kubectl apply --server-side --force-conflicts \
  -f charts/1.platform-base/charts/kube-prometheus-stack/charts/crds/crds/

# 전체를 건드리기 전에 단건만 먼저 검증하고 싶을 때
kubectl apply --server-side --force-conflicts \
  -f charts/1.platform-base/charts/kube-prometheus-stack/charts/crds/crds/crd-alertmanagers.yaml
```

CRD 업그레이드는 클러스터 전역에 영향을 주는 작업이라, 나는 문제가 된 `crd-alertmanagers.yaml` 하나만 먼저 올려 diff가 풀리는지 본 뒤 전체를 적용했다.

## ✅ 확인

CRD를 올린 뒤 스키마에 `hostNetwork`가 생겼는지부터 다시 봤다. 진단 때 썼던 `jq` 명령을 그대로 다시 돌려 `hostNetwork`가 출력되면 스키마가 따라잡힌 것이다. 그다음 ArgoCD Application의 `ComparisonError`가 사라지고 sync가 다시 도는지 확인했다. diff가 계산되기 시작하니 sync는 자연스럽게 정상으로 돌아왔다.

몇 가지는 겪고 나서 정리해뒀다.

- <b>왜 `--server-side`인가.</b> prometheus-operator CRD는 파일이 매우 크다. 일반 `kubectl apply`(client-side)는 `last-applied-configuration` 어노테이션에 전체 매니페스트를 저장하려다 `metadata.annotations: Too long`(256KB 초과)으로 실패한다. server-side apply는 이 어노테이션을 안 쓰기 때문에 큰 CRD에 맞는다.
- <b>왜 `--force-conflicts`인가.</b> 기존 CRD의 필드 소유권을 다른 매니저(helm, argocd-controller, 예전에 친 kubectl)가 들고 있으면 SSA가 충돌을 보고한다. `--force-conflicts`로 소유권을 가져와 적용한다.
- values로 피하려고 했지만 안 됐다. 템플릿이 필드를 무조건 출력하도록 짜여 있으면 값을 `false`로 둬도 필드 자체는 매니페스트에 남아 같은 에러가 난다. 그때는 결국 CRD 업그레이드가 답이다.

근본적으로는 OSS 차트를 버전업할 때 CRD 동기화를 절차에 넣어두면 이 교착을 안 만난다. Helm이 대신 안 해주는 부분이니 우리가 챙겨야 한다.

## 🔗 참고

- [Server-Side Apply — Kubernetes](https://kubernetes.io/docs/reference/using-api/server-side-apply/)
- [Custom Resource Definitions — Helm Best Practices](https://helm.sh/docs/chart_best_practices/custom_resource_definitions/)
- [Diffing Customization — Argo CD](https://argo-cd.readthedocs.io/en/stable/user-guide/diffing/)
