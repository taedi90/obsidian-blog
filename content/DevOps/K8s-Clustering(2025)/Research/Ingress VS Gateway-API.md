---
title: Ingress VS Gateway API
date: 2025-04-05
draft: false
tags:
  - kubernetes
  - ingress
  - gateway-api
banner: 
cssclasses: 
description: 쿠버네티스 환경에서 Ingress-nginx와 Cilium Gateway API의 특징, 장단점을 비교하고 실제 도입 경험을 바탕으로 어떤 상황에 어떤 기술을 선택하는 것이 유리한지 알아봅니다.
permalink: 
aliases: 
completed: 
type:
  - comparison
---

> [!SUMMARY]
> Gateway API는 표준적이고 선언적인 방식으로 TCP/UDP 라우팅을 지원하며 확장성이 뛰어나지만, 아직 생태계 지원이 부족하다. 반면 Ingress-nginx는 성숙하고 안정적이며 대부분의 Helm 차트에서 지원하지만, TCP/UDP 설정이 다소 번거롭다는 단점이 있다.

## 💡 개요
기존 쿠버네티스 클러스터에서는 트래픽을 외부로 노출시키기 위해 주로 인그레스(Ingress)를 사용해왔다. 하지만 새로운 표준으로 게이트웨이 API(Gateway API)가 등장하면서, 두 기술 사이의 장단점을 비교하고 어떤 것을 선택할지 고민하게 되었다. 

이 글에서는 `ingress-nginx`와 `Cilium Gateway API`를 중심으로 두 방식의 특징을 비교하고, 사내 클러스터에 도입한 경험을 공유한다.

## 📋 선정 배경
과거 클러스터를 구성할 때는 당연하게 `ingress-nginx`를 표준으로 도입했다. 사실 `ingress-nginx`를 사용하면서 아주 큰 불편함이 있었던 것은 아니다. 다만, <b>TCP/UDP 같은 L4 프로토콜을 노출해야 할 때 아쉬운 점</b>이 있었다. 설정을 변경하려면 `ConfigMap`을 직접 수정하고, 컨트롤러를 재기동해야 하는 과정이 번거롭다고 느꼈다.

하지만 솔직히 말하면, 이러한 기술적인 아쉬움보다는 <b>Gateway API가 쿠버네티스의 새로운 표준이라는 점</b> 때문에 사용해보고 싶었던 마음이 가장 컸다. 새로운 기술에 대한 호기심과 표준을 따라가고 싶은 마음이 이번 기술 검토의 주된 동기였다고 할 수 있다.

## 📊 비교
| 기능          | Ingress (ingress-nginx)     | Gateway API (Cilium)                     |
| :---------- | :-------------------------- | :--------------------------------------- |
| **표준 여부**   | 사실상 표준                      | 공식 표준 (차세대)                              |
| **라우팅**     | HTTP/HTTPS 중심               | HTTP, HTTPS, TCP, UDP, gRPC 등            |
| **설정 방식**   | Annotation, ConfigMap       | 선언적 API (Gateway, HTTPRoute, TCPRoute 등) |
| **TCP/UDP** | ConfigMap 수정 및 컨트롤러 재기동 필요  | `TCPRoute`, `UDPRoute` 리소스로 선언적 관리       |
| **역할 분리**   | 어려움 (클러스터 관리자와 앱 개발자 권한 혼재) | 명확함 (Gateway, Route 리소스 분리)              |
| **생태계 지원**  | 매우 높음 (대부분의 Helm 차트 지원)     | 성장 중 (아직 지원하지 않는 경우 많음)                  |
| **관측성**     | 제한적                         | Cilium Hubble 연동 시 L4-L7 가시성 확보          |

## ✅ 선정 사유
사내 클러스터에는 <b>Cilium Gateway API</b>를 도입하기로 결정했다. 가장 큰 이유는 Gateway API가 쿠버네티스의 새로운 표준이라는 점과, `TCPRoute`와 `UDPRoute`를 통해 L4 트래픽을 선언적으로 관리할 수 있다는 편리함 때문이었다. 또한, CNI로 Cilium을 사용하고 있었기에, Gateway API를 함께 사용하면 Hubble UI에서 L7 트래픽까지 관측할 수 있다는 점도 큰 장점으로 다가왔다. 현재까지 특별한 이슈 없이 안정적으로 사용하고 있다.

하지만 만약 실제 프로덕션 환경에서 기술을 선택해야 한다면, 현재 시점에서는 <b>Ingress-nginx</b>를 선택할 가능성이 높다고 판단했다. 이유는 다음과 같다.

- <b>생태계 성숙도</b>: 대부분의 Helm 차트가 Ingress 리소스를 기본적으로 지원하지만, Gateway API는 아직 지원하지 않는 경우가 많다.
- <b>운영 경험</b>: `ingress-nginx`를 오랫동안 사용해오면서 트래픽 제한, 타임아웃 설정 등 다양한 운영 노하우와 문제 해결 경험이 축적되어 있다.

## 🔗 참고
- https://github.com/kubernetes/ingress-nginx/blob/main/docs/user-guide/exposing-tcp-udp-services.md