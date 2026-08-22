---
title: K8s API 서버 인증서에 SAN 추가
date: 2023-01-30
draft: false
tags:
  - k8s
banner: 
cssclasses: 
description: 
permalink: 
aliases:
completed:
---

## 요약

이 문서는 Kubernetes API 서버 인증서의 SAN(Subject Alternative Name)에 새로운 도메인 또는 IP 주소를 추가하는 방법을 설명한다. 이는 API 서버 도메인 변경 등으로 인해 `x509: certificate is valid for ... not new-domain.com`과 같은 인증서 오류가 발생할 때 필요하다. 기존 인증서 백업, `kubeadm` 설정 수정, 인증서 재생성 및 API 서버 재시작 과정을 다룬다.

## 1. 이슈

개발용 Kubernetes 클러스터의 도메인을 변경하는 일이 생겼다. 변경 후에 `kubectl CLI`를 이용하려 했더니 API 서버에서 다음과 같은 오류가 발생했다.

> E0721 16:15:04.405990 22725 memcache.go:238] couldn't get current server API group list: Get "https://example.com:6443/api?timeout=32s": tls: failed to verify certificate: x509: certificate is valid for test-cluster, old-domain.com, kubernetes, kubernetes.default, kubernetes.default.svc, kubernetes.default.svc.cluster.local, localhost, not new-domain.com

인증서의 SAN(Subject Alternative Name)으로 등록된 IP 주소와 도메인 목록에 새로 생성한 도메인이 포함되어 있지 않기 때문에 발생한 문제다.

<b>SAN(Subject Alternative Name)이란?</b>
SAN은 X.509 인증서의 확장 필드로, 하나의 인증서에 여러 개의 호스트 이름(도메인 이름, IP 주소 등)을 연결할 수 있도록 한다. Kubernetes API 서버는 클라이언트가 접속할 때 이 SAN 목록을 확인하여, 접속하려는 도메인 또는 IP가 인증서에 유효하게 등록되어 있는지 검증한다. 따라서 API 서버의 접근 도메인이나 IP가 변경되었는데 해당 정보가 인증서의 SAN에 포함되어 있지 않으면 인증서 유효성 검사 오류가 발생한다.

## 2. 해결

-   <b>임시로 `kubectl`을 사용할 수 있도록 구성하기</b>  
    `/etc/hosts`에 마스터 서버의 주소에 기존에 등록된 SAN을 설정하여 사용하는 방법이 있다. 또는 `kubectl` 명령어에 `--insecure-skip-tls-verify`를 추가하여 TLS 검증을 무력화할 수 있다. (보안상 권장되지 않는 방법이다.)

-   <b>기존 인증서 백업하기</b>  
    기존 인증서가 존재하면 새로운 인증서가 생성되지 않는다고 한다. 하지만 문제가 발생했을 때 원상 복구를 할 수 있도록, 기존 인증서는 삭제하지 말고 잘 보관하자.  
    
    ```bash
    cd /etc/kubernetes/pki/
    mv apiserver.crt apiserver.crt.bak.20230721
    mv apiserver.key apiserver.key.bak.20230721
    ```

-   <b>`kubeadm` 설정 가져오기</b>  
    `kubeadm-config` ConfigMap에서 `data.ClusterConfiguration` 하위의 데이터를 `kubeadm.yaml` 파일로 가져오자.

    ```bash
    kubectl -n kube-system get configmaps kubeadm-config -o jsonpath='{.data.ClusterConfiguration}' --insecure-skip-tls-verify > kubeadm.yaml
    ```

-   <b>데이터 수정하기</b>  
    바로 전 단계에서 생성된 `kubeadm.yaml` 파일을 `vim` 같은 에디터로 열어서 `certSANs`를 찾고 새로운 도메인을 추가한다. 더 이상 사용하지 않는 도메인은 삭제해도 된다.

    ```yaml
    apiServer:
      certSANs:
      - old-domain.com # 요건 삭제
      - new-domain.com # 요건 추가
    ```

-   <b>`kubeadm` 반영</b>

    ```bash
    kubeadm init phase certs apiserver --config kubeadm.yaml
    ```

-   <b>API 서버 재시작</b>  
    마스터 노드에서 `kube-apiserver` 컨테이너를 찾아서 종료한다. 이후 컨테이너는 자동으로 다시 생성된다.  
    <b>주의:</b> API 서버가 재시작되는 동안 Kubernetes API에 대한 접근이 일시적으로 중단될 수 있다.

    ```bash
    docker ps | grep kube-apiserver | grep -v pause
    docker kill containerId
    ```

-   <b>정상 동작 확인 후 `kubeadm` 구성 업로드</b>  
    변경된 도메인으로 API 서버 호출이 정상적으로 이루어지는 것을 확인한 후에, 최종적으로 `kubeadm` 구성을 업로드한다. 이 단계는 `kubeadm-config` ConfigMap을 업데이트하여 클러스터 구성 변경 사항을 반영한다.

    ```bash
    kubeadm init phase upload-config kubeadm --config kubeadm.yaml
    ```

## 참고

-   [https://kloudle.com/academy/how-to-add-new-hostname-ipaddress-to-kubernetes-api-server/](https://kloudle.com/academy/how-to-add-new-hostname-ipaddress-to-kubernetes-api-server/)
