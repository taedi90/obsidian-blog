---
title: ClickHouse istio mTLS 불일치로 503이 터진 이슈
date: 2026-07-24
draft: false
tags:
  - clickhouse
  - istio
  - mtls
  - service-mesh
  - kubernetes
  - troubleshooting
banner: 
cssclasses: 
description: istio 사이드카가 ClickHouse에 mTLS를 시도하다 평문 응답을 받아 WRONG_VERSION_NUMBER 503을 내뱉은 문제를, 메시에서 ClickHouse를 빼는 것으로 해결한 기록.
permalink: 
aliases: 
completed: true
type:
  - issue
---

## 요약

> [!SUMMARY]
> istio-injection이 켜진 네임스페이스에 ClickHouse 파드가 있으면, 클라이언트 사이드카가 `security.istio.io/tlsMode: istio` 라벨을 보고 자동으로 mTLS를 originate한다. 그런데 ClickHouse는 mTLS를 종단하지 못하고 평문으로 응답한다. 결과는 `WRONG_VERSION_NUMBER` → 503. 해결은 ClickHouse 사이드카 자체를 안 붙이는 거다(`sidecar.istio.io/inject: "false"`). 라벨이 사라지면 클라이언트도 평문으로 붙는다.

## 1. 환경

- Kubernetes + Istio service mesh
- ClickHouse: 서비스명 `app-clickhouse`, HTTP 포트 8123, native 포트 9000/9009
- 클라이언트: trace 조회 API, trace 수집 워커 (이하 "조회 API", "수집 워커")
- 네임스페이스: 앱 네임스페이스 (이하 `app`), `istio-injection: enabled`
- 배포: Helm 차트 → Helmfile → ArgoCD
- 네임스페이스·서비스명 등은 가상값으로 바꿔 적는다.

## 2. 이슈

테스트 환경에서 trace 조회 API가 ClickHouse에 질의하다 503을 받았다. 사용자에게는 500 에러로 노출되고 있었다.

처음엔 조회 API 쪽을 의심했다. 기능 자체가 잘못됐거나, trace 저장 앱에 결함이 있나 싶었다. 근데 로그를 보니 애플리케이션 에러가 아니었다.

```
HTTPDriver for http://app-clickhouse:8123 returned response code 503
```

조회 API가 ClickHouse(`app-clickhouse:8123`)에 질의할 때 503이 돌아오고 있었다. 503이면 ClickHouse 자체가 응답을 안 하는 건가 싶어서 파드 안에서 직접 curl을 날려봤다.

```bash
# 파드 내부에서 ClickHouse HTTP 핑을 날려본다.
curl http://app-clickhouse:8123/ping
# → 503 재현
```

같은 경로를 쓰는 수집 워커도 ClickHouse 쓰기에 실패하고 있었다. trace 레코드를 드랍하고 있으니 관측 데이터가 유실되고 있었다.

ClickHouse 컨테이너 자체는 정상이었다. 데이터도 멀쩡하고, 노드 리소스에도 문제가 없었다. ArgoCD 동기화 상태도 OK. 그러니까 ClickHouse는 살아 있는데, 클라이언트가 못 붙는 상황이었다.

## 3. 해결

### 1. envoy access log: 진짜 원인이 드러나다

조회 API 사이드카(envoy) access log를 보니 답이 있었다.

```
503 UF ... TLS_error: WRONG_VERSION_NUMBER ... app-clickhouse:8123
```

`WRONG_VERSION_NUMBER`. 클라이언트가 TLS 핸드셰이크를 시도했는데, 대상이 평문으로 응답한 것이다. envoy가 ClickHouse에 mTLS를 originate했는데, ClickHouse는 mTLS를 모르니까 그냥 평문 HTTP 응답을 줬다. 핸드셰이크가 아니니까 "버전 번호가 이상하다"고 판단한 거다.

> [!NOTE]
> istio 메시 안에서 클라이언트 사이드카는 목적지 Pod의 `security.istio.io/tlsMode` 라벨을 보고 mTLS를 자동으로 originate할지 말지 결정한다. `tlsMode: istio`면 mTLS, 라벨이 없으면 평문. 즉 이 라벨이 문제의 핵심이다.

### 2. 왜 라벨이 붙었나

앱 네임스페이스가 `istio-injection: enabled`라, ClickHouse 파드에도 자동으로 사이드카가 붙었다. 사이드카가 붙으면 엔드포인트에 `security.istio.io/tlsMode: istio` 라벨이 달린다. 이 라벨을 본 클라이언트 사이드카가 "이 목적지는 mTLS로 통신해야 한다"고 판단한 것이다.

문제는 ClickHouse가 mTLS를 종단하지 못한다는 거다. istio 사이드카는 inbound에서 mTLS를 풀어주지만, ClickHouse 컨테이너 자체가 그 뒤에서 평문으로 돈다. 그런데 이번엔 아예 클라이언트→ClickHouse 경로에서 mTLS가 제대로 성립하지 않으니, `WRONG_VERSION_NUMBER`가 난 것이다.

### 3. 선행 fix의 한계: excludeInboundPorts로는 부족하다

사실 이 문제를 한 번 손본 적이 있었다. operator 인증 문제를 해결하려고 ClickHouse의 inbound 인터셉트를 끄는 설정(`excludeInboundPorts: 9000,8123,9009`)을 넣었었다. istio가 ClickHouse의 inbound 인터셉트를 안 하게 하는 거다.

근데 이건 destination의 inbound 인터셉트를 끌 뿐, <b>클라이언트의 mTLS origination을 막지는 못한다</b>. `tlsMode: istio` 라벨이 여전히 달려 있으니, 클라이언트는 계속 mTLS를 시도한다. 즉 inbound 포트 제외는 절반만 고친 거다.

### 4. 해결: ClickHouse를 메시에서 뺀다

ClickHouse 사이드카 자체를 안 붙이면 된다.

```yaml
# ClickHouse podTemplate에 사이드카 인젝션을 끈다.
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: app-clickhouse
spec:
  template:
    metadata:
      annotations:
        sidecar.istio.io/inject: "false"
```

`sidecar.istio.io/inject: "false"`를 주면 사이드카가 안 붙고, 당연히 `tlsMode: istio` 라벨도 안 달린다. 라벨이 없으면 클라이언트 사이드카도 평문으로 붙는다. ClickHouse는 원래 평문으로 돌던 애니까, 그게 자연스럽다.

> [!IMPORTANT]
> 이 패턴은 새로운 게 아니다. 같은 클러스터에서 MariaDB, Minio도 동일한 방식으로 메시에서 제외해 두고 있었다. mTLS를 종단하지 못하는 데이터스토어는 사이드카를 안 붙이는 게 정석이다. ClickHouse만 예외로 두고 있었던 게 문제였다.

## 4. 확인

수정 후 helmfile template으로 렌더를 확인하고, 테스트 환경에 적용했다.

```bash
# 사이드카가 안 붙었는지 확인한다.
kubectl get pod -n app -l app.kubernetes.io/name=app-clickhouse \
  -o jsonpath='{.items[*].spec.containers[*].name}'
# → clickhouse 만 있고, istio-proxy 가 없으면 OK.
```

```bash
# 엔드포인트에 tlsMode 라벨이 사라졌는지 확인한다.
kubectl get endpoints -n app app-clickhouse \
  -o jsonpath='{.subsets[*].addresses[*].targetRef}'
# → 해당 엔드포인트 Pod 에 security.istio.io/tlsMode 라벨이 없으면 OK.
```

```bash
# 조회 API 파드에서 ClickHouse 핑을 날려본다.
kubectl exec -n app <api-pod> -- curl -s http://app-clickhouse:8123/ping
# → Ok. 가 돌아오면 해결.
```

적용 후 503이 사라지고, 조회 API의 trace 조회가 정상 복구됐다. 수집 워커의 쓰기도 정상으로 돌아왔다.

> [!NOTE]
> 같은 클러스터에 istio-injection이 켜진 네임스페이스에 ClickHouse처럼 mTLS를 종단하지 못하는 서비스가 있으면, 이 결함은 잠재적으로 어디서든 재현된다. 공통 values 기반이라, istio-injection이 켜진 모든 배포에 동일한 패턴이 적용된다. 새 환경을 띄울 때마다 ClickHouse 사이드카 제외 설정이 들어가 있는지 한 번 더 확인하는 게 좋다.
