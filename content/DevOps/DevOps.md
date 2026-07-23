<!-- QueryToSerialize: TABLE WITHOUT ID file.link AS Name, regexreplace(file.folder, ".*\/([^\/]+)$", "$1") as Category, dateformat(date, "yyyy-MM-dd") as Date FROM "Publish/DevOps" WHERE draft = false SORT date DESC, file.folder ASC -->
<!-- SerializedQuery: TABLE WITHOUT ID file.link AS Name, regexreplace(file.folder, ".*\/([^\/]+)$", "$1") as Category, dateformat(date, "yyyy-MM-dd") as Date FROM "Publish/DevOps" WHERE draft = false SORT date DESC, file.folder ASC -->

| Name                                                                                                                                                                                                 | Category            | Date       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ---------- |
| [[간헐적 Docker Hub 장애로 배포가 죽던 문제 missing과 indeterminate 분리]]                                                            | CICD                | 2026-07-21 |
| [[오퍼레이터 DB 백업 통일 설계와 검증 CronJob]]                                                                                                          | Database            | 2026-07-21 |
| [[Weaviate 클러스터 간 증분 동기화 스크립트로 컷오버 다운타임 줄이기]]                                                                                 | Migration           | 2026-07-15 |
| [[레거시 K8s 배포를 Helmfile 3계층 형상으로 이관하기]]                                                                                               | Migration           | 2026-07-15 |
| [[멀티사이트 Helm 차트 배포 형상을 타겟 브랜치와 불변 태그로 관리하기]]                                                                                   | Migration           | 2026-07-08 |
| [[외부 노출 없는 ClusterIP-only DB에 CD 마이그레이션 붙이기]]                                                                                      | CICD                | 2026-07-02 |
| [[레거시 Python 배포 봇을 Go로 재작성해 CICD를 Slack 한 창구로 일원화하기]]                                                                      | CICD                | 2026-07-01 |
| [[GitOps 비밀 관리 도입기 SOPS와 age 값 단위 암호화]]                                                                                             | Migration           | 2026-06-23 |
| [[Jenkins 체크아웃에서 git-lfs가 SCM 토큰을 못 받아 LFS pull이 멈추던 문제]]                                                              | CICD                | 2026-06-18 |
| [[배포 봇에 몰린 admin 자격증명을 위협 모델로 정리하기]]                                                                                                        | CICD                | 2026-06-11 |
| [[비대해진 Jenkinsfile을 공유 라이브러리 v2로 리팩토링하기]]                                                                                              | CICD                | 2026-06-11 |
| [[OSS 차트 버전업 후 ArgoCD sync가 멈췄을 때 CRD 스키마 지연과 server-side apply]]                                              | CICD                | 2026-06-09 |
| [[MariaDB Galera 한 노드가 깨졌을 때 무손실로 되살리기]]                                                                                            | Database            | 2026-06-09 |
| [[LLM 관측성 Langfuse 아키텍처 설계 OTLP 한계와 Media API ClickHouse 분리]]                                                   | Tooling             | 2026-05-12 |
| [[CI 빌드 캐시가 디스크를 잠식하지 않게 전용 buildx 빌더와 buildkitd GC 정책]]                                                                | CICD                | 2026-05-04 |
| [[LLM이 유지관리하는 개인 지식·커리어 위키 만들기]]                                                                                                             | Tooling             | 2026-04-12 |
| [[GitHub Issues 기반 DevOps 작업 관리 체계 설계]]                                                                                               | Tooling             | 2026-03-31 |
| [[IaC 도구에 LLM 붙여 자연어를 워크플로우로 바꾸고 환각을 lint로 검증하기]]                                                                           | Tooling             | 2026-03-16 |
| [[단일 Python 컨테이너에서 라이브러리 다중 버전 공존시키기]]                                                                                                 | Tooling             | 2026-03-12 |
| [[폐쇄망 전용 싱글 바이너리 워크플로우 도구 Deck 만들기]]                                                                                                     | Tooling             | 2026-02-28 |
| [[GitOps 배포 봇의 ArgoCD 헬스 게이트 - stale-Healthy 오탐 제거]]                                                                        | CICD                | 2026-02-25 |
| [[self-hosted 레지스트리 디스크 회수 매니페스트 일괄 삭제와 GC 스크립트]]                                                                              | CICD                | 2026-02-24 |
| [[Galera 앞단에 MaxScale read-write-split 프록시를 두고 Helm 관리 Service를 재지정하기]]                              | Database            | 2026-02-24 |
| [[GPU 클러스터에 맞춘 Botkube 이벤트 알람 튜닝]]                                                                                                      | Kubernetes          | 2026-02-24 |
| [[Helmfile 멀티환경 부트스트랩과 공통·환경 값 딥머지]]                                                                                                   | Migration           | 2026-02-24 |
| [[운영 클러스터의 Pod CIDR 바꾸기 (Calico 무중단 지향 절차)]]                                                                                  | Kubernetes          | 2026-02-09 |
| [[특정 노드의 특정 GPU만 쿠버네티스에서 숨기기]]                                                                                                                   | Infra               | 2026-02-03 |
| [[NFS에 DB를 얹었다가 터진 이야기]]                                                                                                                               | Infra               | 2026-01-26 |
| [[신형 Blackwell GPU 드라이버가 안 잡힐 때 OS·드라이버 조합 매트릭스로 뚫기]]                                                                     | Infra               | 2026-01-26 |
| [[마스터 노드 IP 변경 후 etcd 무손실 복구]]                                                                                                              | Kubernetes          | 2026-01-26 |
| [[GPU 8장 서버를 VFIO 패스스루로 4분할해 클러스터에 나눠 붙이기]]                                                                                         | Infra               | 2026-01-23 |
| [[모노레포 증분 빌드 파이프라인 - 커밋 해시 태깅과 git diff 선별 빌드]]                                                                                  | CICD                | 2026-01-09 |
| [[Disk Pressure 대응과 NFS 경로 이전 자동화]]                                                                                                         | Infra               | 2026-01-08 |
| [[Weaviate가 클러스터 전체 다운 후 안 뜬다 Raft 부트스트랩 타임아웃 튜닝]]                                                                        | Database            | 2025-12-10 |
| [[폐쇄망 RHEL에서 드라이버 호환 커널로 되돌리기]]                                                                                                                 | Infra               | 2025-11-17 |
| [[Harbor 레지스트리 데이터 손실과 노드 캐시 이미지 역push 복구의 한계]]                                                                                  | CICD                | 2025-10-28 |
| [[VXLAN 세컨더리 네트워크 VM의 외부망 접근 설계와 비대칭 라우팅]]                                                                                      | Kubernetes          | 2025-10-21 |
| [[RabbitMQ 3파드 동시 CrashLoopBackOff와 Operator 보안 강화]]                                                                    | Database            | 2025-10-20 |
| [[고밀도 노드에서 신규 파드 네트워크 설정 실패 Multus 데몬 OOMKilled]]                                                                        | Kubernetes          | 2025-10-20 |
| [[흩어진 KubeVirt·Multus 매니페스트를 기능별 단일 트리로 통합]]                                                                                  | Kubernetes          | 2025-10-17 |
| [[NFS 장애가 부른 Elasticsearch Lucene 인덱스 손상 복구]]                                                                                  | Database            | 2025-10-16 |
| [[NFS 쓰기 병목 잡기 - sync→async 전환과 nfsd·마운트 옵션 튜닝]]                                                                               | Infra               | 2025-10-16 |
| [[kubectl 응답 지연 Control Plane 성능 진단]]                                                                                                | Kubernetes          | 2025-10-16 |
| [[재기동·노드 이동에도 유지되는 KubeVirt VM 고정 IP]]                                                                                              | Kubernetes          | 2025-10-16 |
| [[한 노드에서만 파드가 ContainerCreating에 멈추는 문제와 좀비 multus-shim]]                                                        | Kubernetes          | 2025-10-15 |
| [[클러스터 전체 파드의 실제 실행 UID GID 수집 도구 만들기]]                                                                                               | Tooling             | 2025-10-13 |
| [[흩어진 Ansible 역할 변수를 단일 defaults로 통합하기 (SSOT 리팩토링)]]                                                                   | Migration           | 2025-10-10 |
| [[이슈 드리븐 인프라 운영 자동화 LLM 멀티에이전트 오케스트레이션 시스템 자작]]                                                                               | Tooling             | 2025-10-10 |
| [[Cilium crash 뒤 CIDR 중복 경보가 진짜 IP 충돌인지 규명하기]]                                                                              | Kubernetes          | 2025-10-02 |
| [[MariaDB Operator(Galera) 물리 백업과 PITR 실전]]                                                                                      | Database            | 2025-09-26 |
| [[신형 GPU에서 MIG 활성화의 숨은 전제 vBIOS 버전과 디스플레이 모드]]                                                                                   | Infra               | 2025-07-29 |
| [[클러스터 구조]]                                                                                                                                | Clustering          | 2025-07-22 |
| [[HPA 와 VPA]]                                                                                                                                                | Kubernetes          | 2025-07-17 |
| [[쿠버네티스 서비스]]                                                                                                                                                | Kubernetes          | 2025-07-17 |
| [[CICD 구성]]                                                                                                                                      | CICD                | 2025-07-16 |
| [[관측가능성 시스템 구조]]                                                                                                                   | Observability       | 2025-07-16 |
| [[kubevirt-setting]]                                                                                                         | Offline-Install     | 2025-07-14 |
| [[KubeVirt DataVolume clone OOMKilled 해결]]                                                                                      | Kubernetes          | 2025-07-14 |
| [[도입 배경]]                                                                                                                                               | K8s-Clustering-2025 | 2025-07-12 |
| [[internal-kubernetes-cluster]]                                                                                                   | K8s-Clustering-2025 | 2025-07-10 |
| [[nfs-subdir-provisioner pvc 삭제 불가 이슈]]                                                                   | Troubleshooting     | 2025-07-01 |
| [[관측가능성 스택 선정]]                                                                                                                          | Research            | 2025-06-30 |
| [[clickhouse 데이터 크래시 이슈]]                                                                                               | Troubleshooting     | 2025-06-27 |
| [[longhorn 볼륨 용량이 줄어들지 않는 이슈]]                                                                                     | Troubleshooting     | 2025-06-23 |
| [[자바 로그 설정]]                                                                                                                      | Logs                | 2025-04-29 |
| [[Helm 차트 템플릿 선정]]                                                                                                                    | Research            | 2025-04-25 |
| [[오퍼레이터 패턴]]                                                                                                                                | Research            | 2025-04-25 |
| [[Fortigate로 SSH 포트포워딩 브루트포스 차단하기]]                                                                                                         | Infra               | 2025-04-18 |
| [[CI 도구 선정]]                                                                                                                                | Research            | 2025-04-16 |
| [[etcd 백업 설정]]                                                                                                                     | Troubleshooting     | 2025-04-12 |
| [[BGP 라우팅 설정]]                                                                                                                             | Network             | 2025-04-09 |
| [[Ansible 알아보기]]                                                                                                                        | Research            | 2025-04-09 |
| [[e1000e NIC 드라이버 detected hardware unit hang 오류]]                                             | Troubleshooting     | 2025-04-08 |
| [[배포 도구 선정]]                                                                                                                                | Research            | 2025-04-07 |
| [[Ingress VS Gateway-API]]                                                                                                    | Research            | 2025-04-05 |
| [[CSI 구현체 선정]]                                                                                                                            | Research            | 2025-04-03 |
| [[컨테이너 레지스트리 선정]]                                                                                                                      | Research            | 2025-04-03 |
| [[CNI 구현체 선정]]                                                                                                                            | Research            | 2025-04-01 |
| [[클러스터링 도구 선정]]                                                                                                                          | Research            | 2025-03-30 |
| [[lvm 설정]]                                                                                                                                     | Storage             | 2025-03-30 |
| [[CRI 구현체 선정]]                                                                                                                            | Research            | 2025-03-16 |
| [[유휴 서버를 K8s 자원 풀로 재편하고 클라우드 워크로드를 역이전한 비용 최적화기]]                                                                             | Infra               | 2025-02-14 |
| [[maven 빌드 속도 최적화]]                                                                                                                                           | ETC                 | 2024-12-12 |
| [[Docker Healthcheck 실패 시 컨테이너 재기동 설정]]                                                                                             | Container           | 2024-12-10 |
| [[L4 스위치 Hairpinning 무중단 수정 Active 먼저 고치고 Standby로 확장]]                                                                 | Infra               | 2024-11-24 |
| [[Galera Arbitrator 사용해보기]]                                                                                                                      | Database            | 2024-10-10 |
| [[pessimisticwrite-and-deadlock]]                                                                                                          | Database            | 2024-09-28 |
| [[MariaDB 데드락 로그 확인]]                                                                                                                                  | Database            | 2024-09-27 |
| [[관리 대시보드 응답 지연 진단 Hibernate 다중 조인과 인덱스 부재]]                                                                                    | Database            | 2024-09-23 |
| [[RabbitMQ 미러 큐 클러스터 스플릿브레인과 autoheal 전환]]                                                                                        | Database            | 2023-12-21 |
| [[온프레미스 3서버 납품 환경의 HA·Failover 대안 검토 - Restart Policy·Healthcheck의 한계와 Docker Swarm]] | Container           | 2023-12-05 |
| [[Redis 마스터 쏠림 자동 재분배 - Sentinel vs API 스케줄러 vs 쉘 스크립트]]                                                            | Database            | 2023-11-22 |
| [[git bad object 오류 해결하기]]                                                                                                                             | ETC                 | 2023-07-21 |
| [[linux 서버에 열려있는 포트 확인하기]]                                                                                                                           | Linux               | 2023-07-19 |
| [[쿠버네티스와 도커의 리소스 관리 방식 차이]]                                                                                                                    | Kubernetes          | 2023-03-10 |
| [[ES 인덱스 복제본 수 기본 설정 방법]]                                                                                                                          | Database            | 2023-02-09 |
| [[Npm 오프라인 환경에서 프로젝트를 빌드하는 방법]]                                                                                                                   | ETC                 | 2023-02-09 |
| [[ES 자동 스냅샷 설정]]                                                                                                                                            | Database            | 2023-02-08 |
| [[K8s CUDAFailed to initialize NVML- Unknown Error 오류]]                                                            | Kubernetes          | 2023-02-08 |
| [[git 여러 리모트에 한번에 push 하기]]                                                                                                                           | ETC                 | 2023-02-07 |
| [[Publish/DevOps/Kubernetes/쿠버네티스.md|쿠버네티스]]                                                                                                                                                        | Kubernetes          | 2023-02-07 |
| [[haproxy 로 한 포트에서 ssh 와 https 사용하기]]                                                                                                       | ETC                 | 2023-02-02 |
| [[fluentd 여러줄 로그 합치기 & 로그 내용으로 필터링하기]]                                                                                                     | ETC                 | 2023-02-02 |
| [[k8s api-server 인증서에 SAN 추가하기]]                                                                                                          | Kubernetes          | 2023-01-30 |
| [[k8s 네임스페이스 강제 삭제 방법]]                                                                                                                            | Kubernetes          | 2023-01-30 |
| [[k8s 데몬셋(daemonset) 파드를 scale 하는 방법]]                                                                                              | Kubernetes          | 2023-01-30 |
| [[k8s 클러스터 외부 애플리케이션 ingress 와 service 연결하기]]                                                                                | Kubernetes          | 2023-01-30 |
| [[kubernetes Statefulset 에서 storageClassName 업데이트 하기]]                                                              | Kubernetes          | 2023-01-30 |
| [[gitlab container registry API 인증 없이 사용하기]]                                                                                         | ETC                 | 2023-01-09 |
| [[linux 특정 소유자 폴더 찾기]]                                                                                                                                   | Linux               | 2022-12-19 |
| [[Ubuntu 22.04 에 microk8s 설치하기]]                                                                                                                 | ETC                 | 2022-11-28 |
| [[linux 사용자 비밀번호 변경]]                                                                                                                                     | Linux               | 2022-11-28 |
| [[2node-cluster-ha-and-failover]]                                                                                                        | Kubernetes          | 2022-11-23 |
| [[노드 장애 감지 6분을 1분으로 줄인 파라미터 튜닝]]                                                                                                          | Kubernetes          | 2022-11-23 |
| [[컨테이너 타임존 설정]]                                                                                                                                             | Container           | 2022-11-22 |
| [[maven 외부 라이브러리 추가 (systemPath)]]                                                                                                             | ETC                 | 2022-11-22 |
| [[oracle cloud CentOS 8 설치 및 세팅하기]]                                                                                                           | ETC                 | 2021-12-01 |
| [[파이썬 가상환경 설정(pyenv, pipenv)]]                                                                                                                     | ETC                 | 2021-09-18 |
<!-- SerializedQuery END -->
