<!-- QueryToSerialize: TABLE WITHOUT ID link(file.link, title) AS Name, regexreplace(file.folder, ".*\/([^\/]+)$", "$1") as Category, dateformat(date, "yyyy-MM-dd") as Date FROM "Publish/DevOps" WHERE draft = false SORT date DESC, file.folder ASC -->
<!-- SerializedQuery: TABLE WITHOUT ID link(file.link, title) AS Name, regexreplace(file.folder, ".*\/([^\/]+)$", "$1") as Category, dateformat(date, "yyyy-MM-dd") as Date FROM "Publish/DevOps" WHERE draft = false SORT date DESC, file.folder ASC -->

| Name                                                                                                                                                            | Category             | Date       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------- |
| [[클러스터 구조]]                                                                                          | Clustering           | 2025-07-22 |
| [[CICD 구성|CICD 순서도]]                                                                                               | CICD                 | 2025-07-16 |
| [[관측가능성 시스템 구조]]                                                                             | Observability        | 2025-07-16 |
| [[kubevirt-setting|kubevirt 를 활용한 오프라인 테스트 환경 구성]]                                                      | Offline-Install      | 2025-07-14 |
| [[도입 배경|쿠버네티스가 필요했던 이유]]                                                                                                | K8s-Clustering(2025) | 2025-07-12 |
| [[internal-kubernetes-cluster|사내 쿠버네티스 클러스터 도입기]]                                                                       | K8s-Clustering(2025) | 2025-07-10 |
| [[관측가능성 스택 선정]]                                                                                    | Research             | 2025-06-30 |
| [[clickhouse 데이터 크래시 이슈|ClickHouse 데이터 파손(Crash) 이슈 해결 기록]]                                             | Troubleshooting      | 2025-06-27 |
| [[오퍼레이터 패턴|오퍼레이터 패턴 알아보기]]                                                                                     | Research             | 2025-04-25 |
| [[Helm 차트 템플릿 선정]]                                                                              | Research             | 2025-04-25 |
| [[CI 도구 선정]]                                                                                          | Research             | 2025-04-16 |
| [[BGP 라우팅 설정|BGP 라우팅 설정으로 쿠버네티스 네트워크 외부 연동하기]]                                                                  | Network              | 2025-04-09 |
| [[e1000e NIC 드라이버 detected hardware unit hang 오류|e1000e NIC 드라이버 detected hardware unit hang 오류 해결 과정]] | Troubleshooting      | 2025-04-08 |
| [[배포 도구 선정]]                                                                                          | Research             | 2025-04-07 |
| [[Ingress VS Gateway-API|Ingress VS Gateway API]]                                                              | Research             | 2025-04-05 |
| [[CSI 구현체 선정]]                                                                                      | Research             | 2025-04-03 |
| [[컨테이너 레지스트리 선정]]                                                                                | Research             | 2025-04-03 |
| [[CNI 구현체 선정]]                                                                                      | Research             | 2025-04-01 |
| [[클러스터링 도구 선정]]                                                                                    | Research             | 2025-03-30 |
| [[lvm 설정|쿠버네티스 클러스터를 위한 LVM 스토리지 구성]]                                                                           | Storage              | 2025-03-30 |
| [[CRI 구현체 선정|Kubernetes CRI 선정]]                                                                               | Research             | 2025-03-16 |
| [[maven 빌드 속도 최적화|Maven 빌드 속도 최적화]]                                                                                                      | ETC                  | 2024-12-12 |
| [[Docker Healthcheck 실패 시 컨테이너 재기동 설정]]                                                        | Container            | 2024-12-10 |
| [[Galera Arbitrator 사용해보기|Galera Arbitrator 컨테이너 생성 & failover 테스트]]                                                                     | ETC                  | 2024-10-10 |
| [[pessimisticwrite-and-deadlock|MariaDB PESSIMISTIC_WRITE 와 데드락(feat. Gap lock)]]                                                    | MariaDB              | 2024-09-28 |
| [[MariaDB 데드락 로그 확인|MariaDB 데드락 로그 확인 방법]]                                                                                           | MariaDB              | 2024-09-27 |
| [[c언어 함수 포인터와 gets() 알아보기|C언어 전역 변수와 포인터의 함정 (함수 포인터와 gets 바로 알기)]]                                                                      | ETC                  | 2023-07-22 |
| [[git bad object 오류 해결하기|Git bad object 오류 해결하기]]                                                                                        | ETC                  | 2023-07-21 |
| [[linux 서버에 열려있는 포트 확인하기|Linux 서버에 열려있는 포트 확인하기]]                                                                                      | Linux                | 2023-07-19 |
| [[ES 인덱스 복제본 수 기본 설정 방법|Elasticsearch 인덱스 복제본 수 기본 설정]]                                                                        | Elasticsearch        | 2023-02-09 |
| [[Npm 오프라인 환경에서 프로젝트를 빌드하는 방법|Npm 오프라인에서 프로젝트 빌드하기]]                                                                                     | ETC                  | 2023-02-09 |
| [[K8s CUDAFailed to initialize NVML- Unknown Error 오류|CUDAFailed to initialize NVML 오류]]                                           | Container            | 2023-02-08 |
| [[ES 자동 스냅샷 설정|Elasticsearch 자동 스냅샷 설정]]                                                                                       | Elasticsearch        | 2023-02-08 |
| [[Publish/DevOps/Container/쿠버네티스.md|쿠버네티스란?]]                                                                                                                  | Container            | 2023-02-07 |
| [[git 여러 리모트에 한번에 push 하기|Git 여러 리모트에 한번에 push 하기]]                                                                                      | ETC                  | 2023-02-07 |
| [[fluentd 여러줄 로그 합치기 & 로그 내용으로 필터링하기|Fluentd 로그병합 & 필터링]]                                                                               | ETC                  | 2023-02-02 |
| [[haproxy 로 한 포트에서 ssh 와 https 사용하기|Haproxy 한 포트로 ssh 와 https 동시에 사용하기]]                                                                 | ETC                  | 2023-02-02 |
| [[k8s api-server 인증서에 SAN 추가하기|K8s API 서버 인증서에 SAN 추가]]                                                                            | Container            | 2023-01-30 |
| [[k8s 네임스페이스 강제 삭제 방법|K8s 네임스페이스 강제 삭제]]                                                                                           | Container            | 2023-01-30 |
| [[k8s 클러스터 외부 애플리케이션 ingress 와 service 연결하기|K8s 외부 애플리케이션 ingress 와 service 연결]]                                                   | Container            | 2023-01-30 |
| [[k8s 데몬셋(daemonset) 파드를 scale 하는 방법|K8s 파드 scale]]                                                                                | Container            | 2023-01-30 |
| [[kubernetes Statefulset 에서 storageClassName 업데이트 하기|K8s Statefulset storageClassName 업데이트]]                                       | Container            | 2023-01-30 |
| [[gitlab container registry API 인증 없이 사용하기|Gitlab-ce Container registry API 인증 없이 사용하기]]                                                 | ETC                  | 2023-01-09 |
| [[linux 특정 소유자 폴더 찾기|Linux 특정 소유자 폴더 찾기]]                                                                                              | Linux                | 2022-12-19 |
| [[Ubuntu 22.04 에 microk8s 설치하기|Ubuntu 22.04 에 microk8s 설치]]                                                                              | ETC                  | 2022-11-28 |
| [[linux 사용자 비밀번호 변경|Linux 사용자 비밀번호 변경]]                                                                                                | Linux                | 2022-11-28 |
| [[2node-cluster-ha-and-failover|Kubernetes 2-Node 클러스터에서 고가용성(HA) 및 장애 복구(Failover) 구성하기]]                                         | Container            | 2022-11-23 |
| [[컨테이너 타임존 설정|Container Timezone 설정]]                                                                                              | Container            | 2022-11-22 |
| [[maven 외부 라이브러리 추가 (systemPath)|Maven 외부 라이브러리 추가 (systemPath)]]                                                                        | ETC                  | 2022-11-22 |
| [[Git|Git 기본 개념과 명령어]]                                                                                                                   | ETC                  | 2022-09-05 |
| [[HTML|HTML 기본 구조]]                                                                                                                      | ETC                  | 2022-09-05 |
| [[CSS|CSS 기본 개념 정리 (선택자, 우선순위, Flexbox)]]                                                                                                | ETC                  | 2022-09-05 |
| [[Vanilla JS Ajax 함수 모듈화]]                                                                                        | ETC                  | 2021-12-05 |
| [[Vanilla JS 모달 알림창 만들어보기]]                                                                                      | ETC                  | 2021-12-05 |
| [[oracle cloud CentOS 8 설치 및 세팅하기|Oracle cloud CentOS 8 세팅]]                                                                             | ETC                  | 2021-12-01 |
| [[이클립스(eclipse), Dbeaver 맥에서 한글 짤림문제 해결]]                                                          | ETC                  | 2021-10-16 |
| [[파이썬 가상환경 설정(pyenv, pipenv)]]                                                                                | ETC                  | 2021-09-18 |
<!-- SerializedQuery END -->
