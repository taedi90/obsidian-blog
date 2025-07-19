---
title: ClickHouse 데이터 파손(Crash) 이슈 해결 기록
date: 2025-07-16
draft: false
tags:
  - clickhouse
  - database
  - crash
  - troubleshooting
  - kubernetes
  - signoz
description: "ClickHouse가 비정상 종료 후 'max_suspicious_broken_parts' 오류를 내며 재시작에 실패하는 이슈에 대한 임시 해결 과정과 근본적인 원인 파악의 필요성을 기록한다."
permalink: 
aliases: 
completed: 
type:
  - issue
---

> [!SUMMARY]
> ClickHouse 파드가 비정상 종료된 후 `max_suspicious_broken_parts` 오류로 재시작에 실패했다. 임시방편으로 파드를 강제 삭제하고 `force_restore_data` 플래그를 생성하여 강제 복구를 진행했지만, 이는 근본적인 해결책이 아니므로 추후 원인 파악이 필요하다.

## 💬 이슈

모니터링 시스템 SigNoz의 데이터 저장소로 사용하는 ClickHouse 파드(Pod)가 비정상적으로 종료되는 일이 발생했다. 이후 파드가 다시 시작되는 과정에서 `max_suspicious_broken_parts` 라는 오류 메시지를 남기며 실행에 계속 실패하는 `CrashLoopBackOff` 상태에 빠졌다.

## 🧗 해결

우선 급한 대로 서비스를 복구하기 위해 강제 복구 절차를 진행했다. 하지만 이는 데이터 정합성을 해칠 수 있는 올바른 방법은 아니라고 판단했다. 현재 다른 업무의 우선순위가 높아 당장은 근본적인 해결책을 찾기보다는, 아래와 같은 임시 조치로 문제를 해결했다.

```bash
# 1. 문제가 발생한 파드를 강제로 삭제한다.
# --force 옵션을 사용하여 기다리지 않고 즉시 삭제한다.
kubectl delete pod -n monitoring chi-signoz-clickhouse-cluster-0-0-0 --force 

# 2. 파드가 재시작되면, 컨테이너 내부에 force_restore_data 파일을 실행하여 강제 복구를 시도한다.
kubectl exec -it -n monitoring chi-signoz-clickhouse-cluster-0-0-0 -- touch /var/lib/clickhouse/flags/force_restore_data
```

> [!IMPORTANT]
> 이 방법은 데이터가 유실될 가능성이 있어보인다.

추후 아래와 같은 사항들을 반드시 확인해봐야 한다고 생각한다.

- ClickHouse 고가용성(High Availability) 구성 후에도 동일한 문제가 발생하는지 확인
- 애초에 데이터 파트가 손상되는 근본적인 원인 파악 (e.g., 스토리지 이슈, 불완전한 종료 등)

## ✅ 확인

위 명령어를 실행한 후, ClickHouse 파드가 정상적으로 `Running` 상태로 전환되고 SigNoz UI에서 데이터가 다시 조회되는 것을 확인했다. 하지만 일부 데이터가 유실되었을 가능성은 배제할 수 없다.

## 🔗 참고

- [Can't recover clickhouse from crash loop · Issue #1641 · SigNoz/signoz](https://github.com/SigNoz/signoz/issues/1641)
