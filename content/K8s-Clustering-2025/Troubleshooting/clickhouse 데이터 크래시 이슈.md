---
title: ClickHouse 데이터 파손(Crash) 이슈 해결 기록
date: 2025-06-27
draft: false
tags:
  - clickhouse
  - database
  - crash
  - troubleshooting
  - kubernetes
  - signoz
description: ClickHouse가 비정상 종료된 뒤 max_suspicious_broken_parts 오류로 재시작에 실패했다. 강제 복구로 급한 불은 껐지만 근본 원인은 아직 못 찾았다.
permalink: 
aliases:
completed: 
type:
  - issue
---

> [!SUMMARY]
> ClickHouse 파드가 비정상 종료된 후 `max_suspicious_broken_parts` 오류로 재시작에 실패했다. 임시방편으로 파드를 강제 삭제하고 `force_restore_data` 플래그 파일을 만들어 강제 복구를 진행했지만, 근본 해결책은 아니라서 원인은 나중에 다시 파야 한다.

## 1. 이슈

모니터링 시스템 SigNoz의 데이터 저장소로 사용하는 ClickHouse 파드(Pod)가 비정상적으로 종료되는 일이 발생했다. 이후 파드가 다시 시작되는 과정에서 `max_suspicious_broken_parts` 라는 오류 메시지를 남기며 실행에 계속 실패하는 `CrashLoopBackOff` 상태에 빠졌다.

## 2. 해결

우선 급한 대로 서비스부터 살리려고 강제 복구 절차를 밟았다. 데이터 정합성을 해칠 수 있는 방법이라 썩 내키진 않았지만, 마침 다른 일의 우선순위가 높아 근본 원인은 뒤로 미루고 아래 임시 조치로 넘어갔다.

```bash
# 1. 문제가 발생한 파드를 강제로 삭제한다.
# --force 옵션을 사용하여 기다리지 않고 즉시 삭제한다.
kubectl delete pod -n monitoring chi-signoz-clickhouse-cluster-0-0-0 --force 

# 2. 파드가 재시작되면, 컨테이너 안에 force_restore_data 플래그 파일을 만들어 강제 복구를 유도한다.
kubectl exec -it -n monitoring chi-signoz-clickhouse-cluster-0-0-0 -- touch /var/lib/clickhouse/flags/force_restore_data
```

> [!IMPORTANT]
> 이 방법은 데이터가 유실될 가능성이 있다.

나중에 아래는 꼭 다시 봐야 한다.

- ClickHouse 고가용성(High Availability) 구성 후에도 같은 문제가 재현되는지
- 애초에 데이터 파트가 손상되는 근본 원인 (스토리지 이슈, 불완전한 종료 등)

## 3. 확인

위 명령어 실행 후 ClickHouse 파드가 `Running`으로 돌아왔고 SigNoz UI에서 데이터도 다시 조회됐다. 다만 일부 데이터가 유실됐을 가능성은 배제할 수 없다.

## 참고

- [Can't recover clickhouse from crash loop · Issue #1641 · SigNoz/signoz](https://github.com/SigNoz/signoz/issues/1641)
