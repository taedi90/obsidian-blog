---
title: 사내 쿠버네티스 클러스터 도입기
date: 2025-07-10
draft: false
tags:
  - kubernetes
  - on-premise
  - devops
  - cluster
banner:
cssclasses:
description: 4개월간 혼자 온프레미스 쿠버네티스 클러스터를 구축하며 남긴 기록. 시리즈 인덱스다.
permalink:
aliases:
completed: true
type:
featured: true
---
## 1. 서론

드디어 사내 개발 환경을 도커(Docker) 기반에서 <b>온프레미스 쿠버네티스(On-premise Kubernetes)</b> 클러스터로 전환할 기회를 얻었다. 지난 몇 년간 [[도입 배경|쿠버네티스 전환의 필요성과 근거]]를 제시해왔고, 드디어 승인을 받아냈기에 내게는 아주 의미가 컸다.

어렵게 얻은 기회인 만큼, 구성원 모두가 만족할 수 있는 쉽고 안정적인 클러스터 환경을 구축해 쿠버네티스를 성공적으로 도입하겠다고 다짐했다. 주어진 시간은 단 4개월, 혼자서 모든 것을 완수해야 했다.

### 과거 경험과 새로운 목표

사실 쿠버네티스 클러스터링은 이번이 처음은 아니었다. 3년 전에도, 그 이후에도 몇 차례 구축해본 경험이 있었다. 그때마다 시간적인 촉박함이나 지식의 한계 등으로 매번 아쉬운 점이 남았는데, 이번엔 그 아쉬움을 덜어볼 기회이기도 했다. 

그동안 제대로 다루지 못했던 기술 스택과 구조를 마음껏 적용해볼 수 있는 기회였다.
### 이 시리즈에 대하여

이 시리즈는 그 4개월간의 여정을 담은 기록이다. 클러스터를 설계하며 했던 깊은 고민의 흔적, 예상치 못한 문제들을 해결했던 과정, 기술을 선택하며 내렸던 결정의 이유들을 정리했다. 

이 기록이 비슷한 도전을 하는 다른 누군가에게 작은 도움이 되기를 바란다. 아마 미래의 내가 될 가능성이 높겠지만 말이다.


## 2. 목차
### 1. 사전조사
<!-- QueryToSerialize: TABLE WITHOUT ID dateformat(date, "yyyy년 MM월 dd일") AS 작성일,  link(file.link, title) AS 제목 FROM "Publish/K8s-Clustering-2025/Research" WHERE draft = false SORT date ASC -->
<!-- SerializedQuery: TABLE WITHOUT ID dateformat(date, "yyyy년 MM월 dd일") AS 작성일,  link(file.link, title) AS 제목 FROM "Publish/K8s-Clustering-2025/Research" WHERE draft = false SORT date ASC -->

| 작성일           | 제목                                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------------------- |
| 2025년 03월 16일 | [[CRI 구현체 선정|Kubernetes CRI 선정]]                                        |
| 2025년 03월 30일 | [[클러스터링 도구 선정]]                                             |
| 2025년 04월 01일 | [[CNI 구현체 선정]]                                               |
| 2025년 04월 03일 | [[CSI 구현체 선정]]                                               |
| 2025년 04월 03일 | [[컨테이너 레지스트리 선정]]                                         |
| 2025년 04월 05일 | [[Ingress VS Gateway-API|Ingress VS Gateway API]]                       |
| 2025년 04월 07일 | [[배포 도구 선정]]                                                   |
| 2025년 04월 09일 | [[Ansible 알아보기|Ansible 기본 알아보기]]                                        |
| 2025년 04월 16일 | [[CI 도구 선정]]                                                   |
| 2025년 04월 25일 | [[Helm 차트 템플릿 선정]]                                       |
| 2025년 04월 25일 | [[오퍼레이터 패턴|오퍼레이터 패턴 알아보기]]                                              |
| 2025년 05월 13일 | [[Opentelemetry Collector 도입 여부 결정|Opentelemetry Collector 를 도입해야 할까?]] |
| 2025년 06월 25일 | [[Agpl-3.0 라이선스 검토]]                                   |
| 2025년 06월 30일 | [[관측가능성 스택 선정]]                                             |
<!-- SerializedQuery END -->
### 2. 클러스터링
<!-- QueryToSerialize: TABLE WITHOUT ID dateformat(date, "yyyy년 MM월 dd일") AS 작성일,  link(file.link, title) AS 제목 FROM "Publish/K8s-Clustering-2025/Clustering" WHERE draft = false SORT date ASC -->
<!-- SerializedQuery: TABLE WITHOUT ID dateformat(date, "yyyy년 MM월 dd일") AS 작성일,  link(file.link, title) AS 제목 FROM "Publish/K8s-Clustering-2025/Clustering" WHERE draft = false SORT date ASC -->

| 작성일           | 제목                                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| 2025년 07월 16일 | [[Kubernetes 버전 업그레이드|Kubernetes 클러스터 버전 업그레이드]]          |
| 2025년 07월 16일 | [[Kubespray 를 이용한 클러스터링|Kubespray로 온프레미스 클러스터 구축하기]]      |
| 2025년 07월 16일 | [[Nvidia 드라이버 설치|NVIDIA 드라이버와 Container Toolkit 오프라인 설치]] |
| 2025년 07월 22일 | [[인벤토리 구성|Kubespray 인벤토리 구성]]                             |
| 2025년 07월 22일 | [[클러스터 구조]]                                       |
<!-- SerializedQuery END -->

### 3. 네트워크 구성
<!-- QueryToSerialize: TABLE WITHOUT ID dateformat(date, "yyyy년 MM월 dd일") AS 작성일,  link(file.link, title) AS 제목 FROM "Publish/K8s-Clustering-2025/Network" WHERE draft = false SORT date ASC -->
<!-- SerializedQuery: TABLE WITHOUT ID dateformat(date, "yyyy년 MM월 dd일") AS 작성일,  link(file.link, title) AS 제목 FROM "Publish/K8s-Clustering-2025/Network" WHERE draft = false SORT date ASC -->

| 작성일           | 제목                                                                                     |
| ------------- | -------------------------------------------------------------------------------------- |
| 2025년 04월 09일 | [[BGP 라우팅 설정|BGP 라우팅 설정으로 쿠버네티스 네트워크 외부 연동하기]] |
| 2025년 07월 16일 | [[네트워크 정책 구성|CiliumNetworkPolicy로 트래픽 격리하기]]   |
<!-- SerializedQuery END -->

### 4. 스토리지
<!-- QueryToSerialize: TABLE WITHOUT ID dateformat(date, "yyyy년 MM월 dd일") AS 작성일,  link(file.link, title) AS 제목 FROM "Publish/K8s-Clustering-2025/Storage" WHERE draft = false SORT date ASC -->
<!-- SerializedQuery: TABLE WITHOUT ID dateformat(date, "yyyy년 MM월 dd일") AS 작성일,  link(file.link, title) AS 제목 FROM "Publish/K8s-Clustering-2025/Storage" WHERE draft = false SORT date ASC -->

| 작성일           | 제목                                                                            |
| ------------- | ----------------------------------------------------------------------------- |
| 2025년 03월 30일 | [[lvm 설정|쿠버네티스 클러스터를 위한 LVM 스토리지 구성]] |
<!-- SerializedQuery END -->

### 5. 지속적 통합 & 배포
<!-- QueryToSerialize: TABLE WITHOUT ID dateformat(date, "yyyy년 MM월 dd일") AS 작성일,  link(file.link, title) AS 제목 FROM "Publish/K8s-Clustering-2025/CICD" WHERE draft = false SORT date ASC -->
<!-- SerializedQuery: TABLE WITHOUT ID dateformat(date, "yyyy년 MM월 dd일") AS 작성일,  link(file.link, title) AS 제목 FROM "Publish/K8s-Clustering-2025/CICD" WHERE draft = false SORT date ASC -->

| 작성일           | 제목                                                                       |
| ------------- | ------------------------------------------------------------------------ |
| 2025년 07월 16일 | [[CICD 구성|CICD 순서도]]                |
| 2025년 07월 23일 | [[Argo CD|Argo CD 차트 구성과 OIDC 연동]]  |
| 2025년 07월 23일 | [[Drone CI|Drone CI 차트 구성과 k8s 러너]] |
| 2025년 07월 23일 | [[Harbor|Harbor 레지스트리 구성]]          |
<!-- SerializedQuery END -->

### 6. 관측가능성
<!-- QueryToSerialize: TABLE WITHOUT ID dateformat(date, "yyyy년 MM월 dd일") AS 작성일,  link(file.link, title) AS 제목 FROM "Publish/K8s-Clustering-2025/Observability" WHERE draft = false SORT date ASC -->
<!-- SerializedQuery: TABLE WITHOUT ID dateformat(date, "yyyy년 MM월 dd일") AS 작성일,  link(file.link, title) AS 제목 FROM "Publish/K8s-Clustering-2025/Observability" WHERE draft = false SORT date ASC -->

| 작성일           | 제목                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------ |
| 2025년 04월 29일 | [[자바 로그 설정|자바 로그 수집 설정]]                      |
| 2025년 04월 29일 | [[자바 메트릭 설정|자바 메트릭 수집 설정]]                 |
| 2025년 07월 16일 | [[알람 구성|SigNoz 알람 구성]]                       |
| 2025년 07월 16일 | [[Otel pipeline|OpenTelemetry Collector 파이프라인 구성]] |
| 2025년 07월 16일 | [[자바 분산추적 설정|자바 분산 추적 설정]]                  |
| 2025년 07월 16일 | [[관측가능성 시스템 구조]]                      |
<!-- SerializedQuery END -->


### 7. 인증 & 인가
<!-- QueryToSerialize: TABLE WITHOUT ID dateformat(date, "yyyy년 MM월 dd일") AS 작성일,  link(file.link, title) AS 제목 FROM "Publish/K8s-Clustering-2025/Auth" WHERE draft = false SORT date ASC -->
<!-- SerializedQuery: TABLE WITHOUT ID dateformat(date, "yyyy년 MM월 dd일") AS 작성일,  link(file.link, title) AS 제목 FROM "Publish/K8s-Clustering-2025/Auth" WHERE draft = false SORT date ASC -->

| 작성일           | 제목                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| 2025년 07월 16일 | [[OIDC(EntraID) 를 이용한 개인별 인증인가 구성]] |
| 2025년 07월 16일 | [[oauth2-proxy|oauth2-proxy로 인증 없는 서비스 앞에 SSO 세우기]]                 |
| 2025년 07월 23일 | [[oidc-role 차트 구성|OIDC 사용자 RBAC을 Helmfile 차트로 관리하기]]                |
<!-- SerializedQuery END -->

### 8. 오프라인 설치
<!-- QueryToSerialize: TABLE WITHOUT ID dateformat(date, "yyyy년 MM월 dd일") AS 작성일,  link(file.link, title) AS 제목 FROM "Publish/K8s-Clustering-2025/Offline-Install" WHERE draft = false SORT date ASC -->
<!-- SerializedQuery: TABLE WITHOUT ID dateformat(date, "yyyy년 MM월 dd일") AS 작성일,  link(file.link, title) AS 제목 FROM "Publish/K8s-Clustering-2025/Offline-Install" WHERE draft = false SORT date ASC -->

| 작성일           | 제목                                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------------- |
| 2025년 07월 14일 | [[kubevirt-setting|kubevirt 를 활용한 오프라인 테스트 환경 구성]] |
| 2025년 07월 15일 | [[오프라인 파일 준비|오프라인 설치를 위한 파일 준비 과정]]                |
| 2025년 07월 21일 | [[오프라인 설치 과정|오프라인 클러스터 설치 과정]]                     |
| 2025년 07월 25일 | [[엔비디아 드라이버|폐쇄망 GPU 노드에 NVIDIA 드라이버 오프라인 설치]]      |
<!-- SerializedQuery END -->


### 0. 트러블슈팅
<!-- QueryToSerialize: TABLE WITHOUT ID dateformat(date, "yyyy년 MM월 dd일") AS 작성일,  link(file.link, title) AS 제목 FROM "Publish/K8s-Clustering-2025/Troubleshooting" WHERE draft = false SORT date ASC -->
<!-- SerializedQuery: TABLE WITHOUT ID dateformat(date, "yyyy년 MM월 dd일") AS 작성일,  link(file.link, title) AS 제목 FROM "Publish/K8s-Clustering-2025/Troubleshooting" WHERE draft = false SORT date ASC -->

| 작성일           | 제목                                                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2025년 04월 08일 | [[e1000e NIC 드라이버 detected hardware unit hang 오류|e1000e NIC 드라이버 detected hardware unit hang 오류 해결 과정]] |
| 2025년 04월 12일 | [[etcd 백업 설정]]                                                                               |
| 2025년 06월 23일 | [[longhorn 볼륨 용량이 줄어들지 않는 이슈]]                                               |
| 2025년 06월 27일 | [[clickhouse 데이터 크래시 이슈|ClickHouse 데이터 파손(Crash) 이슈 해결 기록]]                                             |
| 2025년 07월 01일 | [[nfs-subdir-provisioner pvc 삭제 불가 이슈|nfs-subdir-provisioner PVC 삭제시 실제 디렉토리는 그대로 남아있는 이슈]]             |
| 2025년 07월 02일 | [[노드 Fail 이후 파드들의 상태가 이상하다|노드 Failover 이후 남는 Error·Completed 파드 처리]]                                    |
| 2025년 07월 16일 | [[Publish/K8s-Clustering-2025/Troubleshooting/SigNoz infra monitoring 에서 메모리가 높게 뜨는 증상.md|SigNoz infra monitoring에서 메모리가 높게 뜨는 증상]]                    |
| 2025년 07월 16일 | [[eck-operator ssl disable 불가|ECK에서 SSL을 마음대로 못 끄는 이유]]                                                 |
| 2025년 07월 16일 | [[otel-collector 중복 스크래핑 이슈]]                                                 |
| 2025년 07월 16일 | [[오프라인 설치 도커 이미지 이슈]]                                                                 |
| 2025년 07월 18일 | [[dnf module 오프라인|오프라인 미러에서 dnf module이 안 보일 때]]                                                        |
| 2026년 07월 24일 | [[clickhouse istio mTLS 불일치 이슈|ClickHouse istio mTLS 불일치로 503이 터진 이슈]]                                  |
<!-- SerializedQuery END -->
