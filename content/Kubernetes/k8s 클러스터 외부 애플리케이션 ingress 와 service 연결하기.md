---
title: K8s 외부 애플리케이션 ingress 와 service 연결
date: 2023-01-30
draft: false
tags:
  - k8s
banner: 
cssclasses: 
description: 셀렉터 없는 서비스와 수동 endpoints로 클러스터 외부 애플리케이션 등록.
permalink: 
aliases:
completed:
---
## 1. 이슈

서버를 구축하다 보니 쿠버네티스 클러스터 내부가 아닌 호스트 커널에서 개별적으로 실행되는 애플리케이션이 늘어났다. 클러스터 외부의 프로세스를 커널에서 실행하는 것은 쿠버네티스가 지향하는 방식은 아니지만, 임시로 사용할 애플리케이션을 위해 helm 차트를 생성하고 설정하는 데도 공수가 드는 일이라는 핑계로 하나둘 생성하다 보니 지금 상태에 이르렀다.

  

호스트에서 직접 실행 중인 애플리케이션을 사용하다 보니 외부에서 접근해야 하는 경우가 생겼다. 개별 포트를 부여하는 방식은 정리되지 않은 느낌이었고, 서브 도메인을 부여하려면 nginx나 haproxy 같은 프록시 서버가 필요한 데다 인증서까지 추가로 관리해야 하는 불편함이 따랐다. 그래서 쿠버네티스 `ingress`를 통해 호스트의 커널에서 실행 중인 쿠버네티스 외부 애플리케이션에 접근하는 방법을 알아보게 되었다.

  

## 2. 해결

쿠버네티스 서비스는 아래 예시의 `app.kubernetes.io/name: MyApp`처럼 셀렉터를 가지고 있으면, 해당 레이블을 가진 파드를 찾아 `endpoints` 오브젝트를 자동으로 생성한다. 그리고 `my-service:80` 요청은 iptables나 IPVS 방식으로 `endpoints`에 등록된 파드 중 하나의 9376 포트로 전달된다.

  

```yaml
apiVersion: v1
kind: Service
metadata:
  name: my-service
spec:
  selector:
    app.kubernetes.io/name: MyApp
  ports:
    - protocol: TCP
      port: 80
      targetPort: 9376
```

  

서비스에서 셀렉터를 명세하지 않으면 `endpoints` 오브젝트가 자동으로 생성되지 않으며, 수동으로 `endpoints` 를 생성해 줌으로써 클러스터 외부에서 실행되는 애플리케이션도 서비스 FQDN (my-service.default.svc.cluster.local 과 같은) 같은 형태로 클러스터 내부에서 호출이 가능하고 ingress 를 설정하여 외부에서도 호출할 수 있게된다.

  

```yaml
kind: Ingress
apiVersion: networking.k8s.io/v1
metadata:
  name: host-app
  namespace: default
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /$2
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - example.com
      secretName: example-tls
  rules:
    - host: example.com
      http:
        paths:
          - path: /host-app(/|$)(.*)
            pathType: Prefix
            backend:
              service:
                name: host-app
                port: 
                  name: http
---
kind: Service
apiVersion: v1
metadata:
  name: host-app
  namespace: default
spec:
  ports:
  - protocol: TCP
    name: http
    port: 18080
    targetPort: 18080
---
kind: Endpoints
apiVersion: v1
metadata:
  name: host-app
  namespace: default
subsets:
  - addresses:
      - ip: 10.10.10.10 \#host-ip
    ports:
      - port: 18080 \#application-port
        name: http
        protocol: TCP
```

  

이 방식을 활용하면 서버 내부의 애플리케이션 뿐만 아니라 외부의 백엔드로도 요청이 가능하다.

## 참고

- [https://kubernetes.io/ko/docs/concepts/services-networking/service/#셀렉터가-없는-서비스](https://kubernetes.io/ko/docs/concepts/services-networking/service/#%EC%85%80%EB%A0%89%ED%84%B0%EA%B0%80-%EC%97%86%EB%8A%94-%EC%84%9C%EB%B9%84%EC%8A%A4)
