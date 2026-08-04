---
title: 클러스터 전체 파드의 실제 실행 UID/GID를 긁어모으는 도구
date: 2025-10-13
draft: false
tags:
  - kubernetes
  - security
  - bash
  - tooling
  - audit
banner: 
cssclasses: 
description: securityContext에 적어둔 값과 실제로 프로세스가 돌아가는 UID/GID가 다를 수 있어서, 클러스터 전체를 훑어 실행 권한 현황을 뽑는 Bash 도구를 두 가지 방식으로 만든 기록.
permalink: 
aliases: 
completed: true
type:
  - note
---

## 요약

> [!SUMMARY]
> 파드 매니페스트의 `securityContext`에 적어둔 `runAsUser`/`runAsGroup`은 "이렇게 돌아라"는 요청일 뿐, 실제 프로세스가 그 UID로 도는지는 별개다. 컨테이너 안 PID 1의 `/proc/1/status`를 읽어 실제 실행 UID/GID를 클러스터 전역으로 긁어모으는 Bash 도구를 만들었다. `kubectl exec`로 직접 읽는 방식과 노드마다 DaemonSet을 띄워 호스트 `/proc`를 읽는 방식 두 가지를 두고, 수집 결과를 jq로 JSON 집계해 보안 감사에 썼다.

## 1. 도입 배경

시작은 단순한 의심이었다. "우리 클러스터 파드들, 진짜로 root로 안 도는 게 맞나?"

파드에 `securityContext.runAsUser`를 박아두면 끝난 줄 알기 쉽다. 그런데 그 값은 "이 UID로 실행해달라"는 요청이고, 실제 실행 UID는 여러 이유로 어긋날 수 있다.

- `securityContext`를 아예 안 잡은 파드는 이미지의 `USER` 지시문을 그대로 따른다. `USER`도 없으면 root(0)다.
- 엔트리포인트 스크립트가 `gosu`나 `su-exec`으로 중간에 UID를 바꿔치기하는 경우가 있다.
- 매니페스트엔 비root라 적혀 있는데 실제로는 root로 도는, 정반대 상황도 나온다.

결국 매니페스트만 봐서는 실제 실행 권한 현황을 알 수 없다는 뜻이다. 확인하려면 <b>돌고 있는 프로세스</b>를 직접 들여다봐야 했다. 파드 몇 개면 손으로 하겠는데, 네임스페이스 수십 개에 컨테이너 300개짜리 클러스터를 손으로 훑을 생각을 하니 답이 없었다. 그래서 도구를 만들었다.

## 2. UID/GID를 어디서 읽는가

리눅스에서 프로세스의 실제 UID/GID는 `/proc/<pid>/status`에 다 적혀 있다. 컨테이너 안에서 메인 프로세스는 보통 PID 1이니, 컨테이너의 `/proc/1/status`를 읽으면 된다.

```bash
# 컨테이너 PID 1의 UID/GID를 확인한다.
cat /proc/1/status | grep -E "^(Uid|Gid):"

# 출력:
# Uid:    1000    1000    1000    1000
# Gid:    1000    1000    1000    1000
#         (Real) (Effective) (Saved) (Filesystem)
```

네 개 숫자가 각각 Real·Effective·Saved·Filesystem UID다. 감사 목적에선 첫 번째 Real UID면 충분해서 `awk '{print $2}'`로 첫 칸만 집었다. 나머지는 대부분 같은 값이라 굳이 다 기록할 이유가 없었다.

읽는 소스는 이걸로 확정됐다. 남은 문제는 "300개 컨테이너의 `/proc/1/status`에 어떻게 다 접근하느냐"였고, 여기서 방식이 둘로 갈렸다.

## 3. 방법 1: kubectl exec로 직접 읽기

제일 먼저 떠오른 건 그냥 `kubectl exec`로 컨테이너에 들어가 읽는 방식이다. 추가로 배포할 것도 없고 직관적이다.

Running 상태 파드를 전부 훑고, 파드 안 컨테이너마다 `exec`로 `/proc/1/status`를 읽어 JSON으로 쌓는다. 문제는 컨테이너마다 쉘이 있을 수도 없을 수도 있다는 것. 그래서 `sh` → `bash` → 쉘 없이 `cat` 직접 호출 순으로 세 번 시도하게 했다.

```bash
# sh로 먼저 시도하고, 실패하면 bash, 그것도 안 되면 cat을 직접 호출한다.
UID_GID=$(kubectl exec -n "$NAMESPACE" "$POD" -c "$CONTAINER" -- \
  sh -c 'cat /proc/1/status 2>/dev/null | grep -E "^(Uid|Gid):" | awk "{print \$2}"' 2>/dev/null || echo "")

if [ -z "$UID_GID" ]; then
  UID_GID=$(kubectl exec -n "$NAMESPACE" "$POD" -c "$CONTAINER" -- \
    bash -c 'cat /proc/1/status 2>/dev/null | grep -E "^(Uid|Gid):" | awk "{print \$2}"' 2>/dev/null || echo "")
fi
# (세 번째로 쉘 없이 cat /proc/1/status 직접 시도)
```

돌려보니 절반 조금 넘게만 성공했다(테스트 클러스터 기준 308개 중 179개, 58%쯤). 나머지가 왜 실패하냐면, <b>distroless 이미지</b>처럼 쉘도 `cat` 바이너리도 없는 컨테이너엔 `exec`로 읽을 수단 자체가 없기 때문이다. 요즘 잘 만든 이미지일수록 이런 경우가 많다. 보안을 위해 최소 이미지를 쓴 파드가 정작 보안 감사에선 안 잡히는 웃픈 상황이었다.

장점은 명확하다. 배포할 게 없고, `exec` 권한만 있으면 당장 돌아간다. 소규모 클러스터에서 빠르게 확인할 땐 이걸로 충분하다.

## 4. 방법 2: 노드 DaemonSet으로 읽기

distroless를 잡으려면 컨테이너 안이 아니라 <b>노드 쪽</b>에서 봐야 한다. 컨테이너 프로세스도 결국 호스트 커널의 프로세스니, 노드의 `/proc`에는 그 프로세스가 다 보인다. 컨테이너 안에 쉘이 있든 없든 상관없다.

그래서 노드마다 DaemonSet을 하나씩 띄우고, `hostPID: true`로 호스트 프로세스 네임스페이스를 공유하게 했다. 인스펙터 컨테이너는 호스트 `/proc`를 읽기 전용으로 마운트한 busybox다.

```yaml
# 각 노드에서 호스트 /proc에 접근하는 인스펙터 DaemonSet (핵심 부분)
spec:
  hostPID: true                 # 호스트의 모든 프로세스를 본다
  containers:
  - name: inspector
    image: busybox:latest
    securityContext:
      privileged: true          # 다른 컨테이너의 /proc/<pid>를 읽으려면 필요
    volumeMounts:
    - name: host-proc
      mountPath: /host/proc
      readOnly: true            # 읽기만 한다
  volumes:
  - name: host-proc
    hostPath:
      path: /proc
```

수집 흐름은 이렇다. 파드의 컨테이너 ID를 `kubectl get pod`에서 뽑고, 인스펙터 안에서 `/host/proc/<pid>/cgroup`을 뒤져 그 컨테이너 ID가 들어간 PID를 찾는다. 컨테이너 프로세스의 cgroup 경로엔 컨테이너 ID가 박혀 있어서, 이걸로 "이 컨테이너의 메인 PID가 몇 번인지"를 역으로 매핑할 수 있다.

```bash
# 인스펙터 파드 안에서, cgroup에 컨테이너 ID가 들어간 PID를 찾는다.
MAIN_PID=$(kubectl exec -n kube-system "$INSPECTOR_POD" -- sh -c "
  for pid in /host/proc/[0-9]*; do
    if grep -q '$CONTAINER_ID' \"\$pid/cgroup\" 2>/dev/null; then
      basename \"\$pid\"; break
    fi
  done
")
# 그 PID의 /host/proc/<pid>/status에서 UID/GID를 읽는다.
```

이 방식은 앱 컨테이너 안으로 들어가지 않고 노드의 인스펙터 하나만 두드리면 되니, 컨테이너에 쉘이 있든 없든 상관없다. 그래서 distroless도 잡힌다. `exec` 호출 수 자체가 확 줄지는 않는다(컨테이너마다 PID 찾기 한 번, status 읽기 한 번으로 두 번씩 두드린다). 다만 그 호출이 전부 kube-system의 인스펙터로만 가고, 실제 앱 컨테이너에는 붙지 않는다는 게 다르다. 같은 클러스터에서 308개 중 303개(98%)를 수집했다. 방법 1과 비교하면 커버리지 차이가 꽤 크다.

## 5. 두 수집 방식의 트레이드오프

정리하면 둘의 성격이 이렇게 갈린다.

| 항목 | 방법 1: exec 직접 | 방법 2: 노드 DaemonSet |
|------|------------------|----------------------|
| 접근 경로 | 컨테이너 내부 `/proc/1` | 노드 호스트 `/proc/<pid>` |
| exec 호출 | 컨테이너당 1~3회 | 컨테이너당 2회(인스펙터로) |
| 추가 배포 | 없음 | DaemonSet 필요 |
| 권한 | `exec` 권한 | privileged, hostPID |
| distroless | 못 읽음 | 읽음 |
| 커버리지(테스트) | 58% | 98% |
| 적합 | 소규모, 빠른 확인 | 대규모, 정확한 감사 |

방법 2가 커버리지는 압도적이지만 공짜는 아니다. privileged에 hostPID까지 켠 특권 컨테이너를 클러스터 전체 노드에 뿌리는 거라, 감사 도구가 감사 대상보다 위험해지는 자기모순이 생긴다. 그래서 나는 평소엔 방법 1로 대충 보고, 제대로 된 감사가 필요할 때만 방법 2를 잠깐 띄웠다 지우는 식으로 나눠 썼다.

## 6. jq로 집계 리포트 만들기

수집 결과는 이런 JSON 배열로 떨어진다. 필요한 필드만 담백하게 넣었다.

```json
[
  { "namespace": "app-api", "pod": "app-api-7d9c8c6b8f-abcde", "container": "api", "uid": 0, "gid": 0 },
  { "namespace": "data", "pod": "redis-0", "container": "redis", "uid": 999, "gid": 1000 }
]
```

JSON이면 나머지는 jq로 다 된다. 리포트 생성 스크립트가 전체 컨테이너 수, root(UID 0) 비율, UID/GID 분포, 네임스페이스별 테이블을 뽑아 Markdown으로 정리해준다. 급하면 스크립트 없이 한 줄로도 충분하다.

```bash
# root로 도는 컨테이너만 추린다.
jq '[.[] | select(.uid == 0)]' cluster-pod-uids.json

# UID별로 몇 개씩 도는지 많은 순으로 집계한다.
jq 'group_by(.uid) | map({uid: .[0].uid, count: length}) | sort_by(-.count)' cluster-pod-uids.json
```

실제로 돌려보니 root로 도는 컨테이너가 생각보다 많았다. CNI(Cilium), GPU 드라이버, 스토리지(Longhorn) 같은 시스템 컴포넌트야 노드 자원을 직접 만져야 하니 root가 당연하다. 문제는 그 틈에 <b>일반 웹 API·프론트엔드 애플리케이션</b>이 몇 개 섞여 있었다는 것. 네트워크나 하드웨어를 만질 이유가 없는데 root로 도는 파드들이라, 아래 정도를 붙여 비root로 내리도록 정리했다.

```yaml
# root가 필요 없는 애플리케이션에 권장한 securityContext
securityContext:
  runAsNonRoot: true
  runAsUser: 10000
  runAsGroup: 10000
  fsGroup: 10000
  allowPrivilegeEscalation: false
  capabilities:
    drop: ["ALL"]
```

> [!NOTE]
> 리포트 스크립트를 짜면서 비율 계산에 자잘한 버그를 하나 심었다가 나중에 발견했다(비root 비율이 항상 100%로 찍혔다). 수치를 곧이곧대로 믿지 말고 원본 JSON을 jq로 다시 확인하는 습관이 결국 도움이 됐다. 도구를 만든 사람이 그 도구 출력을 제일 안 믿는 게 맞다.

## 7. 특권 컨테이너를 쓴다는 것

방법 2는 편한 만큼 뒷맛이 개운치 않은 도구다. 만들고 나서 스스로 보안 점검을 한 번 돌렸는데, 예상대로 몇 가지가 걸렸다.

- `privileged: true` + `hostPID: true`: 노드의 모든 프로세스에 접근 가능. 진단 목적이라 정당화되지만, 상시 띄워둘 물건은 아니다.
- `kubectl exec` 문자열에 쿼팅 안 된 변수가 섞여 커맨드 인젝션 여지가 있었다. 파드 이름 같은 값이 신뢰 가능한 소스에서 오긴 하지만 걷어내는 게 맞다.
- `hostIPC`, `hostNetwork`는 애초에 필요도 없는데 켜져 있었다. 껐다.
- busybox 이미지 태그가 `latest`였다. 버전 고정하는 게 맞다.

그래서 방법 2는 <b>쓰고 즉시 지운다</b>를 원칙으로 삼았다. 수집이 끝나면 DaemonSet을 바로 내린다.

```bash
# 감사 끝나면 반드시 정리한다. 특권 파드를 클러스터에 방치하지 않는다.
kubectl delete -f manifests/node-process-inspector-daemonset.yaml
```

한 번은 지우는 걸 깜빡하고 며칠 방치한 적이 있다. 별일은 없었지만, 특권 컨테이너를 잊고 놔둔다는 건 그 자체로 감사에서 지적당할 일이다. 수집 스크립트 끝에 삭제 안내를 출력하게 해둔 것도 이래서다. 미래의 내가 까먹을 걸 아니까.

수집한 JSON에는 네임스페이스·파드명·UID가 다 들어 있어 클러스터 구조가 그대로 드러난다. 민감한 비밀은 아니어도 밖에 내놓을 물건은 아니라, 출력 파일은 `chmod 0600`으로 잠그고 리포지토리엔 커밋하지 않았다.

## 참고

- [Configure a Security Context for a Pod or Container](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/)
- [Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/)
- [proc(5) — Linux manual page](https://man7.org/linux/man-pages/man5/proc.5.html)
- [[컨테이너 이미지 재빌드 없이 임의 UID로 실행하기|이 UID/GID 종속을 이미지 차원에서 없앤 이야기]]
