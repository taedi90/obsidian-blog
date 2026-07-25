---
title: MariaDB Operator(Galera) 자가유발 강제복구 장애 분석
date: 2026-07-24
draft: false
tags:
  - mariadb
  - galera
  - kubernetes
  - mariadb-operator
  - incident
  - readiness-probe
  - troubleshooting
banner: 
cssclasses: 
description: 오퍼레이터의 galera 자동복구가 프로브 타임아웃을 Galera 불건강으로 오판하면서 강제 bootstrap을 내리고, 50분간 스스로 장애를 만든 과정을 분해한 기록.
permalink: 
aliases: 
completed: true
type:
  - issue
---

## 🚀 요약

> [!SUMMARY]
> mariadb-operator의 galera 자동복구가 readiness 프로브의 K8s API 타임아웃을 Galera 불건강으로 해석하고 강제 bootstrap을 내렸다. 클러스터는 멀쩡했는데 오퍼레이터가 스스로 끊어죽인 셈이다. 게다가 `imagePullPolicy: Always`로 매번 130MB 이미지를 다시 받고 gcache가 128M라 짧은 다운타임도 전체 SST로 번지면서 복구에 50분이 걸렸다. 결국 데이터 손실은 없었지만, 장애를 만든 건 오퍼레이터 본인이었다.

## ⚙️ 환경

- Kubernetes + mariadb-operator
- MariaDB Galera 3노드 (StatefulSet)
- 스토리지: 자체호스팅 NFS 백엔드, PVC 100Gi/노드
- 배포: Helm 차트 → Helmfile → ArgoCD (GitOps)
- 네임스페이스·호스트명 등은 전부 가상값으로 바꿔 적는다.

## 💬 이슈

백업 체계를 구축하던 중이었다. 물리 복원·PITR·논리 백업 리허설을 한 번에 돌리느라 짧은 시간에 kubectl, Pod 생성·삭제, helm sync 15회, immediate 백업 CR 발화까지 한꺼번에 밀어 넣은 상태였다. 말하자면 클러스터에 버스트 부하를 주는 테스트를 하고 있었다.

그러다 operator 로그에 이런 게 찍혔다.

```
galera.health "Galera cluster is not healthy"
```

그로부터 약 50분. `app-mariadb-0`이 SST로 재조인을 마친 뒤에야 안정화됐다. 데이터 손실은 없었다(Galera SST로 보존됨). 운영 환경은 무관했고 테스트 환경 한정이었다.

## 🧗 해결

### 1. 타임라인: 무슨 일이 일어났나

operator 로그를 시간순으로 펼치면 이렇다.

```
T+0     "Switching primary"
T+6s    Reconciler error 다발
T+36s   "Galera cluster is not healthy" → 강제 bootstrap
T+11m   "bootstrap timed out, resetting" → 재시도
T+50m   수렴
```

Pod 재생성 시각도 찍어봤다. 강제 bootstrap이 내려지고, 노드들이 차례로 재생성되면서 리셋·재시도를 반복한 흔적이다.

처음엔 "백업 리허설이 DB를 직접 건드렸나" 싶었는데, 로그를 깊이 보니 아예 다른 쪽이었다. 오퍼레이터가 <b>스스로</b> 장애를 만들고 있었다.

### 2. 직접 원인: 프로브 타임아웃을 Galera 탓으로 돌리다

오퍼레이터 agent의 readiness 프로브는 Galera 상태를 확인하기 위해 K8s API에 `GET MariaDB CR` 호출을 보낸다. 그런데 버스트 부하 탓에 API가 느려지면서 이 호출이 `context deadline exceeded`로 타임아웃이 났다.

여기서 오퍼레이터의 판단이 꼬였다. API 호출이 타임아웃난 걸 Galera가 unhealthy한 걸로 해석한 것이다.

- 프로브 타임아웃 → primary를 unhealthy로 오판 → autoFailover 트리거 → "Galera cluster is not healthy" → <b>강제 bootstrap(=클러스터 재시작)</b>

Galera는 멀쩡했다. 3노드 중 2노드가 Primary/Synced로 살아 있었고 quorum도 유지되고 있었다. (이 부분은 [[MariaDB Galera 한 노드가 깨졌을 때 무손실로 되살리기]]에서 정리한 것과 같은 전제다. 과반만 살아 있으면 클러스터는 멀쩡하다.) 그런데 오퍼레이터가 Galera가 죽었다고 단정하고 강제 bootstrap을 내린 거다.

> [!IMPORTANT]
> 이건 Galera가 실패한 게 아니라, 오퍼레이터가 <b>관측에 실패해서</b> 회복을 시도한 것이다. 회복 대상이 애초에 고장 나지 않았으니, 회복 동작 자체가 장애가 됐다. 자가유발(self-induced) 장애라는 건 이런 거다.

### 3. 복구 지연: 왜 50분이나 걸렸나

장애 자체보다 복구가 오래 걸린 게 더 문제였다. 50분의 원인을 뜯어보면 네 가지가 겹쳤다.

1. <b>`imagePullPolicy: Always`</b> — 노드가 재시작할 때마다 130MB MariaDB 이미지를 다시 받았다. 노드당 약 1.5분. 3노드면 대략 4.5분이 그냥 이미지 풀로 날아간다. 레지스트리가 가까운 온프레미스 환경에서 `Always`는 이득보다 비용이 크다.
2. <b>짧은 SST/bootstrap 타임아웃</b> — 기본값이 5~10분이었다. 130MB 이미지 풀만 해도 1.5분인데, SST까지 합치면 여유가 없다. 타임아웃이 짧으니 중간에 "bootstrap timed out, resetting"이 뜨면서 처음부터 다시.
3. <b>gcache 128M</b> — 이게 가장 뼈아팠다. Galera는 노드가 잠깐 끊겨도 gcache에 Incremental State Transfer(IST)용 데이터를 남겨두면 전체 SST 없이 빠르게 재조인된다. 그런데 기본 gcache가 128M라, 아주 짧은 다운타임에도 gcache가 모자라서 <b>전체 SST</b>로 번졌다. 100Gi PVC를 처음부터 다시 받는 거다.
4. <b>오퍼레이터의 공격적 recovery 정책</b> — 일시적 프로브 실패에도 30초 만에 강제 bootstrap을 내린다. "빠른 복구"가 목표겠지만, 이 빠름이 정상 클러스터를 끊어죽이는 트리거가 됐다.

### 4. 견고화: 어떤 값을 손봤나

장애 원인을 따라가다 보니 대부분이 차트 기본값 문제였다. 배포 차트에서 이렇게 바꿨다.

| 항목 | 이전 | 이후 |
|---|---|---|
| imagePullPolicy | Always | IfNotPresent |
| 프로브 timeout | (기본 짧음) | 15s, threshold 12, startupProbe 4h |
| galera.recovery healthy | 30s | 3m |
| SST/bootstrap/upscale 타임아웃 | 5~10m | 2h |
| podRecovery | (짧음) | 30m |
| gcache | 128M | 5G |

핵심은 세 가지다.

- <b>`imagePullPolicy: IfNotPresent`</b>로 이미지 재풀 비용을 없앴다.
- <b>프로브 내성</b>을 올렸다. API가 잠깐 느려진다고 Galera를 unhealthy로 단정하지 않게, timeout 15s에 threshold 12, startupProbe 4h까지 줬다. 일시적 지연은 노이즈로 처리하고 넘어가는 게 목적이다.
- <b>gcache 5G</b>로 올렸다. 짧은 다운타임에는 IST로 재조인되게 만들어, 전체 SST를 안 받아도 되게 한 거다. 128M와 5G는 하늘과 땅이다.

> [!NOTE]
> gcache 크기는 "노드가 끊긴 동안 발생한 쓰기량"을 커버할 만큼이면 된다. 클러스터 쓰기량에 따라 더 올려야 할 수도 있다. 5G는 우리 환경 기준 "충분히 여유 있는" 값이지 정답이 아니다.

### 5. 재발 방지: 행동 수칙

기술적 견고화만으로는 부족하다. 이번 장애의 트리거는 결국 사람이 만든 버스트 부하였으니까.

- <b>공유 라이브 클러스터에 버스트 대량작업 금지</b> — 백업 리허설, 대량 복원, CR 발화를 한 번에 밀어 넣지 않는다.
- <b>리허설은 격리하거나 저부하 시간대에</b> — 라이브 클러스터에서 굳이 안 해도 될 테스트는 분리된 환경에서.
- <b>immediate 백업 CR 재생성 유발 금지</b> — 백업 CR이 immediate 트리거를 달고 있으면 한 번 잘못 건드렸을 때 부하가 터진다. 스케줄 기반으로만.

## ✅ 확인

 견고화 값은 차트에 반영했다. 다만 라이브 반영은 롤링 재시작을 동반하니, 저부하 시간대에 통제된 deploy 창에서 진행하기로 했다. 정본 경로는 차트 병합 → GitOps → ArgoCD.

 반영 후에는 이런 트리거(API 부하·프로브 지연)가 와도 강제 복구가 재발하지 않는지 관측으로 확인하면 된다. `wsrep_cluster_size=3`, Synced, Primary, `GaleraReady=True`가 유지되면 된다.

> [!IMPORTANT]
> 오퍼레이터가 "다 해줄 것 같은" 편함은, 정확히 그 편함이 장애를 만들 때 역으로 작용한다. 자동복구 회로가 너무 공격적이면, 정상 상태를 오진하고 스스로 클러스터를 끊어버린다. 자동화를 맹신하지 말고, recovery 임계값은 실제 부하 패턴에 맞춰 직접 손봐야 한다.
