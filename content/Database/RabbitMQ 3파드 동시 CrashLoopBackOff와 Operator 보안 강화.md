---
title: "RabbitMQ 3파드 동시 CrashLoopBackOff: Operator 보안 강화와 로그 경로 쓰기 충돌"
date: 2025-10-20
draft: false
tags:
  - rabbitmq
  - kubernetes
  - operator
  - troubleshooting
  - security-context
banner: 
cssclasses: 
description: RabbitMQ 파드 3개가 한꺼번에 erofs 에러로 CrashLoop에 빠진 장애를, Operator 신버전이 켠 readOnlyRootFilesystem과 로그 경로 쓰기 충돌로 규명하고 되살린 기록.
permalink: 
aliases: 
completed: true
type:
  - issue
---

## 요약

> [!SUMMARY]
> RabbitMQ 클러스터 파드 3개가 한꺼번에 `erofs`(읽기 전용 파일 시스템) 에러로 CrashLoopBackOff에 빠졌다. Cluster Operator 신버전이 `readOnlyRootFilesystem`을 기본으로 켜면서 로그 경로 `/var/log/rabbitmq`에 쓰기 가능한 볼륨이 사라진 게 원인이었고, 해당 경로에 emptyDir을 마운트하는 것으로 복구했다.

## 1. 환경

- Kubernetes 클러스터 (검증 환경)
- RabbitMQ Cluster Operator: v2.17.0
- RabbitMQ: 3.9.13 / Erlang 24.3.2
- RabbitmqCluster CR로 관리하는 3노드 클러스터 (StatefulSet)

## 2. 이슈

메시지 큐가 죽었다는 얘기가 들어왔다. 보니 RabbitMQ 파드 3개가 <b>전부</b> CrashLoopBackOff였다. 한두 개가 아니라 셋 다, 재시작 횟수는 어느새 13회까지 올라가 있었고 그 상태로 40분 넘게 돌고 있었다. 파드가 하나만 죽으면 노드 문제나 스케줄링을 의심하는데, 3개가 똑같이 죽으면 원인은 개별 파드 바깥에 있다.

로그를 보니 답이 생각보다 빨리 나왔다.

```text
cannot_log_to_file,"/var/log/rabbitmq/rabbit@...upgrade.log",erofs
```

`erofs`는 read-only file system, 즉 읽기 전용 파일 시스템에 쓰려다 실패했다는 뜻이다. RabbitMQ가 부팅 과정에서 `/var/log/rabbitmq/`에 로그 파일을 만들려는데 그 경로가 읽기 전용이라 못 쓰고, 그대로 시작에 실패해 재시작을 반복하는 상황이었다.

여기서 좀 이상했다. 어제까지 멀쩡히 돌던 클러스터다. 설정을 바꾼 기억도 없다. 그런데 갑자기 로그 경로가 읽기 전용이 됐다? 파일 시스템이 읽기 전용으로 잡히는 건 보통 두 가지다. 디스크가 맛이 가서 커널이 강제로 read-only로 리마운트했거나, 아니면 <b>누군가가 일부러 읽기 전용으로 마운트</b>했거나. 스토리지는 멀쩡했다. 그럼 후자다.

## 3. 해결

### 1. 왜 갑자기 읽기 전용이 됐나

파드의 SecurityContext를 열어보니 컨테이너 레벨에 이게 박혀 있었다.

```yaml
# RabbitMQ 컨테이너의 securityContext
securityContext:
  allowPrivilegeEscalation: false
  capabilities:
    drop: ["ALL"]
  readOnlyRootFilesystem: true   # 루트 파일 시스템을 통째로 읽기 전용으로
  runAsNonRoot: true
```

<b>readOnlyRootFilesystem: true</b>는 컨테이너의 루트 파일 시스템을 읽기 전용으로 마운트한다. 명시적으로 쓰기 볼륨을 붙여준 경로만 쓸 수 있고, 나머지는 전부 읽기 전용이 된다. 보안 관점에선 좋은 설정이다. 침투당해도 파일 시스템을 못 건드리니까. 문제는 이걸 내가 켠 적이 없다는 거였다.

그런데 이 클러스터는 RabbitmqCluster CR로 관리되고, SecurityContext는 내 매니페스트가 아니라 <b>Operator가 StatefulSet을 만들면서 주입</b>한다. 그러니 내 설정이 안 바뀐 건 당연했다. 바뀐 건 Operator 쪽이었다. 최근에 Operator를 v2.17.0으로 올린 게 걸렸다.

릴리스 노트와 관련 PR을 따라가 보니 딱 나왔다. v2.17.0의 [PR #1961](https://github.com/rabbitmq/cluster-operator/pull/1961)에서 파드 SecurityContext를 강화하면서 `readOnlyRootFilesystem: true`를 <b>기본값</b>으로 넣었다. Operator를 올린 순간, 손 하나 안 댄 내 RabbitMQ 파드의 루트 파일 시스템이 읽기 전용으로 바뀐 것이다. 그리고 RabbitMQ는 로그를 파일로 남기게 설정돼 있었다.

```yaml
# RabbitmqCluster CR의 로그 설정 — 파일에 로그를 쓰도록 되어 있었다
additionalConfig: |
  log.file = rabbit.log
  log.file.level = debug
  log.console = true
```

`log.file`이 켜져 있으니 RabbitMQ는 기본 경로 `/var/log/rabbitmq/rabbit.log`에 로그를 쓰려 한다. 그런데 기존 볼륨 마운트 목록을 보면 `/var/lib/rabbitmq`(데이터·쿠키), `/operator`, `/etc/rabbitmq/...`(설정) 정도만 있고 <b>`/var/log/rabbitmq`에 대한 쓰기 볼륨이 없다.</b> 예전엔 루트 파일 시스템이 쓰기 가능했으니 이 경로도 그냥 써졌는데, 이제 읽기 전용이 되면서 로그 쓰기가 막혔다. 부팅 중에 로그부터 막히니 서버가 뜨질 못하고 CrashLoop에 빠진 거다.

Operator가 보안을 강화한 것 자체는 잘못이 아니다. 다만 "루트 파일 시스템을 읽기 전용으로 만든다"는 변경이, "로그를 파일로 남기는데 그 경로엔 쓰기 볼륨이 없다"는 기존 구성과 만나 회귀 장애가 됐다. 손 하나 안 댄 워크로드를 릴리스 노트 한 줄이 넘어뜨린 셈이다.

### 2. 쓰기 가능한 볼륨을 로그 경로에 붙이기

원인이 "로그 경로에 쓰기 볼륨이 없다"라면 해결은 단순하다. 붙여주면 된다. 선택지는 몇 개 있었다.

- `/var/log/rabbitmq`에 쓰기 볼륨(emptyDir 또는 PVC) 마운트
- 파일 로깅을 끄고 console 로깅(stdout)만 사용
- `readOnlyRootFilesystem`을 도로 꺼버리기

세 번째는 애초에 Operator가 좋은 뜻으로 켠 보안 설정을 되돌리는 거라 제외했다. 로그 하나 때문에 파일 시스템 전체를 다시 열어줄 이유가 없다. console 로깅 전환도 방법이지만 지금 당장 급한 복구엔 설정 변경 폭이 크고 중앙 로깅 스택을 전제로 해서 미뤘다. 로그는 재시작 때 날아가도 그만이라(운영 로그는 어차피 중앙 수집으로 본다) <b>emptyDir</b>을 붙이는 쪽이 제일 간단하고 안전했다.

RabbitmqCluster CR은 `spec.override.statefulSet`으로 Operator가 만드는 StatefulSet의 일부를 덮어쓸 수 있다. 여기에 로그 볼륨과 마운트를 얹었다.

```yaml
# RabbitmqCluster CR — Operator가 만든 StatefulSet에 로그용 쓰기 볼륨을 덮어쓴다
spec:
  # ... 기존 설정 유지 ...
  override:
    statefulSet:
      spec:
        template:
          spec:
            volumes:
              - name: log-volume
                emptyDir:
                  sizeLimit: 5Gi
            containers:
              - name: rabbitmq
                volumeMounts:
                  - name: log-volume
                    mountPath: /var/log/rabbitmq
```

`readOnlyRootFilesystem: true`는 그대로 두되, `/var/log/rabbitmq` 이 한 경로만 쓰기 가능한 emptyDir로 뚫어준 것이다. 보안 설정은 유지하면서 로그 쓰기만 살리는, 원래 Operator가 의도한 그림에 맞는 방식이다.

CR을 적용하면 Operator가 StatefulSet을 갱신하고 파드를 순서대로 다시 만든다.

```bash
# CR 적용 후 롤아웃과 파드 상태를 지켜본다
kubectl apply -f app-rabbitmq.yaml
kubectl rollout status statefulset/app-rabbitmq-server -n app-mq
kubectl get pods -n app-mq -l app.kubernetes.io/name=app-rabbitmq --watch
```

## 4. 확인

파드부터 봤다. 3개 모두 Running에 재시작 0회로 올라왔다.

```text
NAME                    READY   STATUS    RESTARTS   AGE
app-rabbitmq-server-0   1/1     Running   0          5m
app-rabbitmq-server-1   1/1     Running   0          5m
app-rabbitmq-server-2   1/1     Running   0          4m
```

로그에서 `erofs`가 사라졌는지, 파드 안에서 로그 경로가 실제로 쓰기 가능하게 잡혔는지도 확인했다.

```bash
# erofs 에러가 더는 없는지 (출력 없으면 정상)
kubectl logs app-rabbitmq-server-0 -n app-mq | grep -i erofs

# 로그 경로가 rw로 마운트됐는지
kubectl exec app-rabbitmq-server-0 -n app-mq -- mount | grep /var/log/rabbitmq
# → ... on /var/log/rabbitmq type ext4 (rw,relatime,...)
```

`erofs`는 0건이었고 로그 경로는 `rw`로 잡혔다. `rabbitmqctl cluster_status`로 봐도 3노드가 모두 up이고 알람·네트워크 파티션 없이 정상이었다. 40분 넘게 죽어 있던 걸 감안하면 원인만 짚고 나서는 5분 만에 끝난 셈이다.

같은 Operator 버전을 쓰는 다른 RabbitMQ 클러스터가 있으면 시한폭탄이라, `kubectl get rabbitmqcluster -A`로 훑어 로그 볼륨이 없는 CR을 미리 손봐두는 게 낫다. 이후 새로 만드는 클러스터는 처음부터 로그 볼륨을 포함한 템플릿으로 찍어내기로 했다.

> [!NOTE]
> 근본은 "Operator가 보안을 강화했다"가 아니라 "보안 강화로 읽기 전용이 된 경로에, 애플리케이션이 여전히 쓰려 했다"는 미스매치다. `readOnlyRootFilesystem`을 켜는 순간 그 워크로드가 쓰기를 시도하는 모든 경로(로그·캐시·임시 파일)에 볼륨이 붙어 있는지부터 확인해야 한다. Operator 업그레이드에서 보안 관련 기본값 변경은 특히 조용히 회귀를 만든다.

## 참고

- [RabbitMQ Cluster Operator v2.17.0 릴리스](https://github.com/rabbitmq/cluster-operator/releases/tag/v2.17.0)
- [PR #1961: Add security context](https://github.com/rabbitmq/cluster-operator/pull/1961)
- [Using RabbitMQ Cluster Operator (override)](https://www.rabbitmq.com/kubernetes/operator/using-operator)
- [Kubernetes Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/)
- [[RabbitMQ 미러 큐 클러스터 스플릿브레인과 autoheal 전환|미러 큐 시절 스플릿브레인을 겪은 앞선 이야기]]
