---
title: Galera 앞단에 MaxScale read/write-split 프록시를 두고 Helm이 관리하던 Service를 재지정하기
date: 2026-02-24
draft: false
tags:
  - kubernetes
  - mariadb
  - galera
  - maxscale
  - helm
  - database
  - high-availability
banner: 
cssclasses: 
description: Galera 3노드를 기동해 두었지만 읽기/쓰기 분산과 노드 상태 감지가 없던 상황을, MaxScale 프록시를 앞에 배치하고 Helm이 소유한 Service의 selector만 교체하여 소유권을 유지하면서 연결한 기록.
permalink: 
aliases: 
completed: true
type:
  - architecture
---

## 요약

> [!SUMMARY]
> Helm 차트로 MariaDB Galera 3노드를 기동해 두었지만, 애플리케이션은 Service 하나를 통해 아무 노드에나 연결되었다. 읽기/쓰기 분산도 없었고 어느 노드가 동기화 상태인지 감지하는 기능도 없었다. 그래서 `galeramon` 모니터와 `readwritesplit` 라우터를 구성한 <b>MaxScale</b>을 앞단에 배치하고, 노드마다 primary/secondary 랭크를 부여했다. 애플리케이션이 이미 바라보던 Service는 Helm이 소유한 리소스이므로 새로 만들지 않고 <b>selector만 MaxScale로 patch</b>하여 Helm 소유권을 유지한 채 트래픽 경로를 교체했다.

## 1. 환경

- Kubernetes, `app-db` 네임스페이스
- MariaDB Galera: Bitnami `mariadb-galera-9.0.5` 차트, 3노드 StatefulSet
- MaxScale: 24.02.4 (사내 레지스트리 이미지)

## 2. 현황

Galera로 MariaDB를 3노드로 묶어 두면 어느 노드에 쓰든 클러스터 전체에 복제되는 동기식 멀티마스터 구성이 된다. 문제는 그 위에 있었다. 애플리케이션들은 Helm 차트가 만들어 준 Service(`app-mariadb-service`) 하나로 DB에 연결하는데, 이 Service의 selector가 가리키는 파드로 커넥션이 그대로 흘러갔다. 세 노드를 기동해 두고도 실제로 얻은 것은 다음 정도였다.

- 읽기든 쓰기든 구분 없이 한 경로로 나갔다. 읽기 부하를 secondary로 보낼 방법이 없었다.
- 어느 노드가 `Synced` 상태인지, 방금 클러스터에 복귀한 노드가 아직 SST 중인지 아무도 확인하지 않았다. Service 입장에서는 파드가 `Ready`이면 충분하다. 그런데 파드 Readiness와 Galera 멤버십 상태는 같은 개념이 아니다.
- 쓰기를 여러 노드에 분산하면 Galera에서는 오히려 인증 충돌(certification conflict, 사실상 데드락)이 늘어날 수 있다. 쓰기를 한 노드로 집중하는 편이 안전한데, 이것을 강제하는 계층이 없었다.

아무 노드에나 무분별하게 연결하면 안 되는데, 연결을 담당하는 계층이 그 사실을 알지 못했다. 그래서 노드 상태를 이해하고 읽기/쓰기를 분배하는 프록시를 앞에 하나 배치하기로 했다.

## 3. 전체 그림

MariaDB 진영의 공식 프록시가 <b>MaxScale</b>이다. Galera를 감시하는 전용 모니터(`galeramon`)와 읽기/쓰기를 분리하는 라우터(`readwritesplit`)를 모듈로 갖추고 있어서, 지금 필요한 두 가지가 그대로 있었다. 굳이 HAProxy로 TCP만 전달하거나 ProxySQL을 새로 학습할 이유가 없었다.

바뀐 경로는 이렇다.

- 앱 → `app-mariadb-service`(Service) → MaxScale 파드 → Galera 3노드
- MaxScale이 `galeramon`으로 세 노드의 Galera 상태를 2초마다 확인하고, `readwritesplit`으로 쓰기는 primary 랭크 노드로, 읽기는 나머지 노드로 분산한다.

여기서 수정 부담이 가장 적고 사고 위험도 낮은 지점은 Service였다. 애플리케이션들은 이미 `app-mariadb-service`라는 이름을 설정 파일 곳곳에 명시해 두고 사용하고 있었다. 이 이름을 바꾸면 애플리케이션 설정을 전부 함께 수정해야 한다. 그러므로 이름은 그대로 두고, 그 Service가 가리키는 대상(selector)만 Galera 파드에서 MaxScale 파드로 바꾸면 애플리케이션은 변경 사실을 인지하지 못한 채 프록시를 경유하게 된다.

## 4. MaxScale 설정: galeramon + readwritesplit + 랭크

MaxScale 설정은 ConfigMap으로 넣고 컨테이너의 `/etc/maxscale.cnf`에 마운트했다. 설정은 네 블록으로 구성된다. 모니터, 서비스(라우터), 리스너, 그리고 서버 정의이다.

```ini
# maxscale.cnf — ConfigMap으로 주입
[maxscale]
threads=auto
substitute_variables=true          # 아래 $환경변수를 파드 env로 치환

[Galera-Monitor]
type=monitor
module=galeramon                    # Galera 전용 상태 감시 모듈
servers=galera-0,galera-1,galera-2
user=monitor_user
password=$MARIADB_PASSWORD          # 평문 금지 — secretKeyRef로 주입된 env 참조
monitor_interval=2000ms

[Read-Write-Service]
type=service
router=readwritesplit              # 쓰기는 한 노드, 읽기는 분산
servers=galera-0,galera-1,galera-2
user=root
password=$MARIADB_ROOT_PASSWORD    # 위와 동일하게 env 치환
enable_root_user=true              # 라우터가 root 계정으로 붙는 걸 허용

[Read-Write-Listener]
type=listener
service=Read-Write-Service
protocol=MariaDBClient
port=3306
```

`substitute_variables=true`를 켜두면 설정 파일의 `$MARIADB_PASSWORD` 같은 토큰을 파드 환경변수 값으로 치환한다. 덕분에 비밀번호를 ConfigMap에 평문으로 기록하지 않고, 뒤에 나올 `secretKeyRef`로 주입한 env를 참조하게 된다. (초기 버전에서는 설정에 root 비밀번호를 그대로 적어 두었는데, ConfigMap은 평문으로 남으므로 좋지 않은 습관이었다. env 치환 방식으로 제거했다.)

서버 블록에서 랭크를 부여했다. `readwritesplit`은 `rank=primary`인 서버를 우선 쓰기 대상으로 지정하고, `secondary`는 후순위·읽기 용도로 운용한다. Galera는 어디에 써도 동작하지만 쓰기를 한 노드로 모아야 인증 충돌이 줄어들므로, primary를 하나만 둔다.

```ini
[galera-0]
type=server
address=mariadb-galera-0.mariadb-galera-headless.app-db.svc.cluster.local
port=3306
rank=primary                       # 쓰기를 여기로 몰아준다

[galera-1]
type=server
address=mariadb-galera-1.mariadb-galera-headless.app-db.svc.cluster.local
port=3306
rank=secondary

[galera-2]
type=server
address=mariadb-galera-2.mariadb-galera-headless.app-db.svc.cluster.local
port=3306
rank=secondary
```

주소는 StatefulSet 파드의 안정적인 DNS 이름(headless Service를 통한 `pod-N.headless.ns.svc...`)을 그대로 사용했다. 파드가 재기동되어도 이름이 유지되므로 프록시가 특정 멤버를 안정적으로 지목할 수 있다. primary 노드가 죽으면 `galeramon`이 상태 변화를 감지하고, MaxScale은 남은 secondary 중 하나로 쓰기 경로를 넘긴다.

## 5. Helm이 관리하던 Service를 깨지 않고 재지정

여기가 이번 작업에서 특히 신경을 쓴 부분이다. 애플리케이션이 바라보는 `app-mariadb-service`는 <b>Helm이 소유한 리소스</b>이다. 라벨에 `app.kubernetes.io/managed-by: Helm`과 `helm.sh/chart: mariadb-galera-9.0.5`가 붙어 있고, Helm은 이런 라벨과 애노테이션으로 "이것은 내가 만든 릴리스의 것"이라고 소유권을 표시한다.

그러므로 같은 이름으로 Service 매니페스트를 통째로 다시 `kubectl apply` 하면 문제가 생긴다. Helm이 붙여 둔 소유권 메타데이터와 충돌하거나, 다음 `helm upgrade` 때 selector가 원래대로 되돌려질 수 있다. 리소스를 새로 만들어 교체하는 방식도 애플리케이션 설정을 함께 바꿔야 하므로 제외했다.

그래서 리소스를 다시 만들지 않고 <b>selector 필드 하나만 patch</b>했다. 소유권 라벨과 애노테이션은 손대지 않았으므로 Helm은 여전히 자신의 리소스로 인식하고, 바뀐 것은 "이 Service가 어느 파드로 트래픽을 보내는가"뿐이다.

```bash
# Service의 selector만 MaxScale 파드로 갈아끼운다.
# managed-by: Helm 등 소유권 메타데이터는 그대로 두므로 Helm이 계속 자기 것으로 인식한다.
kubectl -n app-db patch service app-mariadb-service \
  --type merge \
  -p '{"spec":{"selector":{"app":"maxscale"}}}'
```

이 한 줄로 Service의 Endpoints가 Galera 파드에서 MaxScale 파드로 전환된다. 애플리케이션은 여전히 `app-mariadb-service:3306`으로 연결하지만, 그 뒤에서 프록시를 경유하게 된다. 애플리케이션 재배포도, 설정 변경도 없다.

> [!IMPORTANT]
> Helm이 관리하는 리소스를 수정할 때는 "새로 만들기"보다 "필요한 필드만 patch"하는 것이 안전하다. 소유권 라벨을 유지하는 한 Helm은 그 리소스를 계속 자기 관할로 보고, 우리는 그 안에서 원하는 필드만 바꾼 셈이 된다. 다만 다음 `helm upgrade`가 selector를 values 기준으로 되돌릴 여지가 있으므로, 이 patch는 배포 파이프라인에 포함시켜 재현 가능하게 만들어 두었다.

## 6. MaxScale 배포와 비밀번호 주입

MaxScale은 Deployment로 1레플리카를 기동했다. 상태를 파드에 보관하지 않으므로(설정은 ConfigMap, 자격증명은 Secret) 단순한 구성을 선택했다. 비밀번호는 절대 매니페스트에 기록하지 않고, Galera 차트가 만든 Secret을 `secretKeyRef`로 env에 주입하여 3장에서 본 `$MARIADB_PASSWORD` / `$MARIADB_ROOT_PASSWORD` 치환으로 이어지게 했다.

```yaml
# maxscale Deployment (일부)
env:
  - name: MARIADB_PASSWORD
    valueFrom:
      secretKeyRef:
        name: mariadb-galera        # Galera 차트가 만든 Secret 재사용
        key: mariadb-password
  - name: MARIADB_ROOT_PASSWORD
    valueFrom:
      secretKeyRef:
        name: mariadb-galera
        key: mariadb-root-password
image: registry.internal:30500/maxscale:24.02.4
ports:
  - name: mysql
    containerPort: 3306
livenessProbe:
  exec:
    command: ["maxctrl", "list", "servers"]   # 프록시가 서버 목록을 응답하면 살아있는 것
  initialDelaySeconds: 10
  periodSeconds: 30
readinessProbe:
  exec:
    command: ["maxctrl", "list", "servers"]
  initialDelaySeconds: 10
  periodSeconds: 30
```

프로브를 `maxctrl list servers`로 지정한 것은 MaxScale이 실제로 서버 목록을 다룰 만큼 정상인지 확인하려는 의도였다. 프로세스가 기동되어 있는지만 확인하는 것으로는 부족했다. (서비스 메시를 사용하는 클러스터이므로 이 파드에는 사이드카 주입을 꺼 두었다. DB 프로토콜을 프록시 앞단에서 다시 감싸도 이점이 없었다.)

## 7. 확인

배포 후 MaxScale 안에서 서버 목록부터 확인했다. 세 노드가 등록되고, primary/secondary 랭크와 상태가 기대대로 나오는지 점검한다.

```bash
# MaxScale 파드 안에서 모니터가 본 Galera 노드 상태를 조회한다.
kubectl -n app-db exec deploy/maxscale -- maxctrl list servers
```

primary 노드가 쓰기(Master) 역할로, secondary들이 읽기(Slave/Running)로 연결되고 세 노드 모두 정상으로 보이면 프록시 쪽은 완료된 것이다. 그다음은 Service 경로였다. 애플리케이션이 연결하는 `app-mariadb-service`의 Endpoints가 MaxScale 파드 IP로 바뀌었는지 확인했다.

```bash
# Service가 MaxScale 파드를 가리키는지 확인 (Galera 파드가 아니라)
kubectl -n app-db get endpoints app-mariadb-service
```

Endpoints가 MaxScale 파드 하나로 등록되고, 애플리케이션들이 커넥션 오류 없이 평소처럼 DB를 사용하면 경로 교체가 사실상 중단 없이 끝난 것이다. primary 노드를 일부러 중단해 보면 `galeramon`이 상태 변화를 감지하고 쓰기 경로가 secondary로 전환되는 것도 확인할 수 있다.

## 참고

- [MariaDB MaxScale](https://mariadb.com/kb/en/maxscale/)
- [MaxScale 24.02 readwritesplit 라우터](https://mariadb.com/kb/en/mariadb-maxscale-2402-readwritesplit/)
- [MaxScale 24.02 Galera Monitor](https://mariadb.com/kb/en/mariadb-maxscale-2402-galera-monitor/)
- [Bitnami mariadb-galera Helm chart](https://github.com/bitnami/charts/tree/main/bitnami/mariadb-galera)
- [[MariaDB Galera 한 노드가 깨졌을 때 무손실로 되살리기|같은 Galera 클러스터의 노드 복구 이야기]]
