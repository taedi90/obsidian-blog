---
title: 외부 애플리케이션 ingress 와 service 연결
date: 2023-01-30
draft: false
tags:
  - k8s
banner: 
cssclasses: 
description: 셀렉터가 없는 서비스를 생성하고 endpoints 를 수동으로 생성하여 클러스터 외부의 애플리케이션을 등록하는 방법을 알아본다.
permalink: 
aliases: 
completed:
---
## 이슈

서버를 구축하다 보니 쿠버네티스 클러스터 내부가 아닌 호스트 커널에서 개별적으로 실행되는 애플리케이션이 생겨났다. 클러스터 구성 외에 다른 프로세스가 커널에서 실행되는 부분은 쿠버네티스에서 지향하는 방식은 아니지만, 임시로 사용 될 애플리케이션을 위해서 helm 차트를 생성하고 설정하는 것 또한 공수가 드는 일이라는 핑계로 하나둘 생성하다보니 여기까지 와버렸다.

  

호스트에 바로 실행 된 애플리케이션을 쓰다보니 외부에서 접근해야하는 경우가 생겼는데, 개별 포트를 부여하는 방식은 왠지 깔끔하지 않았고 서브 도메인을 부여하려하니 nginx 나 haproxy 같은 프록시 서버가 필요한데다가 인증서 또한 추가로 관리해야 하는 불편함이 생겼다. 그래서 쿠버네티스 `ingress` 를 통해서 호스트의 커널에서 실행되고 있는 쿠버네티스 외부의 애플리케이션에 접근이 가능한 방법을 알아보게 되었다.

  

## 해결

쿠버네티스 서비스는 아래 예시의 `[app.kubernetes.io/name](http://app.kubernetes.io/name=MyApp)` 처럼 셀렉터를 가지고 있으면, 해당 레이블을 가지고 있는 파드를 찾아 `endpoints` 오브젝트를 자동으로 생성한다. 그리고 `my-service:80` 요청에 `endpoints` 에 리스트 된 파드 중 하나의 9376 포트로 전달되게 된다. (iptables 나 IPVS 의 방식으로)

  

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