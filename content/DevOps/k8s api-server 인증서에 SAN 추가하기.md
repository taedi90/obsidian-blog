---
title: k8s api-server 인증서에 SAN 추가
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
## 이슈

개발용 쿠버네티스 클러스터의 도메인을 변경하는 일이 생겼다. 변경 후 kubectl cli 를 이용하려했더니 apiserver 에서 다음과 같은 오류가 발생했다.

> E0721 16:15:04.405990 22725 memcache.go:238] couldn't get current server API group list: Get "https://example.com:6443/api?timeout=32s": tls: failed to verify certificate: x509: certificate is valid for test-cluster, old-domain.com, kubernetes, kubernetes.default, kubernetes.default.svc, kubernetes.default.svc.cluster.local, localhost, not new-domain.com

인증서의 SANs(**Subject Alternate Name, 주제대체이름) 으로 등록 된 아이피나 도메인 목록 중에 새로 생성한 도메인이 포함되어있지 않기 때문에 발생한 문제다.**

## 해결

- 임시로 kubectl 을 사용할 수 있도록 구성하기  
    /etc/hosts 에 master 서버의 주소에 기존에 등록된 SAN 을 설정하여 사용하는 방법이 있다. 또는 kubectl 명령어에  
    `--insecure-skip-tls-verify` 를 추가하여 tls 검증을 무력화할 수 있다.

  

- 기존 인증서 백업하기  
    기존 인증서가 존재하면 새로운 인증서가 생성되지 않는다고 한다. 하지만 문제가 발생했을 때 원상복구를 할 수 있도록 기존 인증서는 삭제하지 말고 잘 보관하자.  
    

```bash
cd /etc/kubernetes/pki/
mv apiserver.crt apiserver.crt.bak.20230721
mv apiserver.key apiserver.key.bak.20230721
```

  

- kubeadm 설정 가져오기  
      
    `kubeadm-config` 컨피그 맵에서 data.ClusterConfiguration 하위의 데이터를 kubeadm.yaml 파일로 가져오자.

```bash
kubectl -n kube-system get configmaps kubeadm-config -o jsonpath='{.data.ClusterConfiguration}' --insecure-skip-tls-verify > kubeadm.yaml
```

  

- 데이터 수정하기  
    바로 전 단계에서 생성 된 kubeadm.yaml 파일을 vim 등의 에디터로 실행해  
    `certSANs` 를 찾고 새로운 도메인을 추가해준다. 더이상 사용하지 않는 도메인은 삭제해도 된다.

```bash
apiServer:
  certSANs:
  - old-domain.com # 요건 삭제
  - new-domain.com # 요건 추가
```

  

- kubeadm 반영

```bash
kubeadm init phase certs apiserver --config kubeadm.yaml
```

  

- apiserver 재시작  
    마스터 노드에서 kube-apiserver 컨테이너를 찾아 종료해준다. (이후 자동으로 다시 생성된다.)  
    

```bash
docker ps | grep kube-apiserver | grep -v pause
docker kill containerId
```

  

- 정상 동작 확인 후 kubeadm 구성 업로드  
    변경 된 도메인으로 정상적으로 apiserver 호출이 되는 것을 확인한 후에 최종적으로 kubeadm 구성을 업로드 해준다.  
    

```bash
kubeadm init phase upload-config kubeadm --config kubeadm.yaml
```

  

## 참고

- [https://kloudle.com/academy/how-to-add-new-hostname-ipaddress-to-kubernetes-api-server/](https://kloudle.com/academy/how-to-add-new-hostname-ipaddress-to-kubernetes-api-server/)