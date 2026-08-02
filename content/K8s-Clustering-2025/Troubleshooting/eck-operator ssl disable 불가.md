---
title: ECK에서 SSL을 마음대로 못 끄는 이유
date: 2025-07-16
draft: false
tags:
  - eck-operator
  - elasticsearch
  - ssl
  - troubleshooting
banner: 
cssclasses: 
description: ECK로 띄운 Elasticsearch에서 standalone처럼 TLS·보안을 꺼보려다 막힌 기록. HTTP 계층 자체서명 인증서는 끌 수 있지만 transport TLS와 보안은 ECK가 관리해 임의로 못 끈다.
permalink: 
aliases: 
completed: true
type:
  - issue
---

## 요약

> [!SUMMARY]
> ECK(Elastic Cloud on Kubernetes) operator로 띄운 Elasticsearch에서, standalone처럼 `elasticsearch.yml`에 `xpack.security.*`를 넣어 TLS·인증을 끄려 했는데 안 먹었다. ECK가 관리하는 설정은 <b>사용자가 덮어써도 operator가 되돌리기</b> 때문이다. 끌 수 있는 건 <b>HTTP 계층의 자체서명 인증서</b>(`spec.http.tls.selfSignedCertificate.disabled: true`)까지고, <b>노드 간 transport TLS와 보안 자체</b>는 ECK가 강제한다.

"standalone에서 되던 걸 ECK에서도 되겠지"가 안 통하는 대표적인 지점이었다.

## 1. 무엇을 하려다 막혔나

개발·내부용이라 인증서·인증 없이 평문 HTTP로 간단히 붙고 싶었다. standalone Elasticsearch라면 `elasticsearch.yml`에 이렇게 쓰면 된다.

```yaml
xpack.security.enabled: false
xpack.security.http.ssl.enabled: false
xpack.security.transport.ssl.enabled: false
```

그런데 ECK로 만든 `Elasticsearch` 리소스의 `spec.config`에 같은 걸 넣어도 반영이 안 되거나, 클러스터가 안 뜬다. operator가 자기가 관리하는 설정을 <b>다시 자기 값으로 덮기</b> 때문이다.

## 2. ECK는 일부 설정을 "관리 대상"으로 잡고 되돌린다

ECK 문서의 [settings managed by ECK](https://www.elastic.co/docs/deploy-manage/deploy/cloud-on-k8s/settings-managed-by-eck)에 명시돼 있듯, operator는 클러스터 형성·보안·TLS에 필요한 키들을 <b>자신이 소유</b>한다. 사용자가 `spec.config`로 그 키를 건드리면 무시되거나 operator가 원복한다. 특히 <b>노드 간 transport TLS</b>와 <b>보안(security)</b>은 ECK가 클러스터를 안전하게 운영하기 위한 전제라, 끄는 걸 열어두지 않았다. ([discuss 스레드](https://discuss.elastic.co/t/how-to-disable-security-authentication-in-eck/334057)에서도 결론은 "그건 못 끈다"였다.)

## 3. 끌 수 있는 건 여기까지: HTTP 자체서명 인증서

완전히 평문으로는 못 가도, <b>HTTP 엔드포인트의 자체서명 인증서 발급</b>은 끌 수 있다. 그러면 HTTPS 대신 HTTP로 서빙하거나, 자체서명 대신 내가 준 인증서를 쓰게 된다.

```yaml
apiVersion: elasticsearch.k8s.elastic.co/v1
kind: Elasticsearch
spec:
  http:
    tls:
      selfSignedCertificate:
        disabled: true      # ECK가 만드는 HTTP 자체서명 인증서를 끔
```

`selfSignedCertificate.disabled: true`면 ECK가 HTTP 계층에 자체서명 TLS를 안 씌운다. 사설 CA 인증서를 붙이고 싶으면 이 자리에 `certificate`(시크릿 참조)로 내 인증서를 넣는다. 다만 이건 <b>HTTP 계층 한정</b>이고, transport TLS는 그대로 남는다.

## 4. 정리

- <b>가능</b>: HTTP 계층 자체서명 인증서 비활성화(`spec.http.tls.selfSignedCertificate.disabled`), 또는 내 인증서로 교체.
- <b>불가</b>: 노드 간 transport TLS 끄기, 보안(인증) 자체 끄기 — ECK가 관리·강제.
- <b>교훈</b>: ECK를 쓰기로 했으면 "operator가 관리하는 영역"을 먼저 확인해야 한다. standalone 감각으로 `elasticsearch.yml`을 덮으려다 시간을 버렸다. 평문·무인증이 꼭 필요하면 ECK가 아니라 standalone 배포를 골랐어야 하는 문제다.

## 참고

- [ECK — Settings managed by ECK](https://www.elastic.co/docs/deploy-manage/deploy/cloud-on-k8s/settings-managed-by-eck)
- [discuss.elastic — disable security in ECK](https://discuss.elastic.co/t/how-to-disable-security-authentication-in-eck/334057)
