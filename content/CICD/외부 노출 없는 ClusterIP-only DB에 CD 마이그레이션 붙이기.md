---
title: 외부 노출 없는 ClusterIP-only DB에 스키마 마이그레이션 붙이기
date: 2026-07-02
draft: false
tags:
  - kubernetes
  - rbac
  - cicd
  - jenkins
  - port-forward
  - database-migration
banner: 
cssclasses: 
description: 밖으로 열려 있지 않은 DB에 CD 파이프라인의 마이그레이션을 어떻게 붙였는지, 접근 경로와 권한 모델을 다시 설계한 기록.
permalink: 
aliases: 
completed: true
type:
  - architecture
---

## 🚀 요약

> [!SUMMARY]
> 오퍼레이터가 관리하는 DB가 <b>ClusterIP로만</b> 떠 있어 외부 CI 에이전트에서 스키마 마이그레이션 경로가 끊겼다. DB를 밖으로 여는 대신, 에이전트가 kube-apiserver 터널(`kubectl port-forward`)로만 붙고 비밀번호는 런타임에 Secret에서 취득하도록 재설계했다. 권한은 <b>ClusterRole(재사용 권한셋) + 네임스페이스별 RoleBinding</b>으로 짜서 비만료 SA 토큰 하나가 바인딩된 네임스페이스에만 닿게 제한했다.

## 1. 상황

원래 CD 파이프라인의 스키마 마이그레이션은 단순했다. 외부 Jenkins 에이전트가 DB의 외부 NodePort로 직접 붙어서 마이그레이션 도구를 돌리고, 접속 정보는 파이프라인 설정 파일에 <b>평문 root 크레덴셜</b>로 박혀 있었다. 부끄럽지만 그게 v1이었다. (지금 와서 보면 평문이 박혀 있던 것부터가 숙제였다.)

그런데 환경이 바뀌었다. 새 환경의 DB는 오퍼레이터가 관리하는 Galera 클러스터인데, <b>ClusterIP-only</b>로만 노출된다. 즉 클러스터 안에서 `db-primary.<namespace>.svc.cluster.local:3306`으로만 닿을 수 있고, NodePort도 LoadBalancer도 없다. 밖에서 붙을 방법이 원천적으로 없다는 뜻이다.

외부에 있는 CI 에이전트 입장에서는 마이그레이션 경로가 통째로 끊긴 셈이다. 그리고 이 에이전트는 평소 클러스터에 GitOps(ArgoCD)를 통해서만 관여하지, kubeconfig도 SA도 apiserver 경로도 갖고 있지 않았다.

선택지는 대충 세 가지였다.

- <b>A. 에이전트에서 `kubectl port-forward`로 터널을 뚫어 붙는다.</b>
- B. 클러스터 안에 마이그레이션 Job을 던져 넣고 결과만 회수한다.
- C. Helm/ArgoCD의 PreSync hook으로 배포 파이프라인 안에 녹인다.

B와 C가 더 "쿠버네티스스럽다"는 건 안다. 그런데 기존 파이프라인에는 지켜야 할 계약이 있었다. dry-run으로 변경분을 먼저 뽑아 보여주고, 그걸 사람이 눈으로 확인한 뒤 승인 버튼(`input`)을 눌러야 실제 적용이 나가는 <b>동기식 승인 게이트</b>다. 이 승인은 이미 사내 배포 봇의 슬랙 버튼에 매핑돼 있었다. B·C로 가면 로그 스트리밍과 승인 시점의 "이번에 바뀌는 대상 목록"을 그대로 살리기가 까다로웠다.

결국 <b>기존 계약을 가장 덜 깨는</b> A를 골랐다.

> [!NOTE]
> `port-forward`는 로컬 포트로 들어온 트래픽을 <b>apiserver를 경유해</b> 대상 파드로 터널링한다. 그래서 에이전트에 파드/ClusterIP 네트워크 접근이 없어도, apiserver 하나만 닿으면 ClusterIP-only DB에 붙을 수 있다. 이번 설계에서 A를 성립시킨 핵심 성질이다.

## 2. 접근 경로

파이프라인이 실제로 하는 일은 이렇게 정리된다. 아래는 CI 스텝이 여는 임시 포워드와 접속 URL 구성의 뼈대다. (`ATLAS_*`는 스텝이 주입하는 환경변수다.)

```bash
# 1) DB 비밀번호를 클러스터 Secret에서 런타임에 꺼내 DB_URL로만 넣는다.
#    (평문 비밀번호가 명령 인자나 콘솔에 절대 남지 않도록, argv가 아닌 env로만 전달)
DB_PW=$(kubectl --context "$ATLAS_CTX" -n "$ATLAS_NS" \
  get secret "$ATLAS_SECRET" -o jsonpath="{.data.$ATLAS_ROOTKEY}" | base64 -d)
export DB_URL="mysql://root:<REDACTED>@127.0.0.1:${ATLAS_PORT}/appdb"

# 2) apiserver를 경유하는 포워드를 백그라운드로 열고, 종료 시 반드시 정리(trap).
kubectl --context "$ATLAS_CTX" -n "$ATLAS_NS" \
  port-forward "svc/$ATLAS_SVC" "${ATLAS_PORT}:3306" >/tmp/pf.log 2>&1 &
PF_PID=$!
trap 'kill "$PF_PID" 2>/dev/null || true' EXIT

# 3) 고정 sleep 대신 로컬 포트가 열릴 때까지 폴링해 레이스를 없앤다.
for _ in $(seq 1 30); do
  (exec 3<>"/dev/tcp/127.0.0.1/${ATLAS_PORT}") 2>/dev/null && { exec 3>&- 3<&-; break; }
  sleep 1
done
```

여기서 신경 쓴 지점 두 가지.

<b>첫째, 비밀번호는 런타임에만 존재한다.</b> 기존처럼 설정 파일에 평문으로 두지 않고, `db-client-secret`에서 그때그때 꺼내 `DB_URL` 환경변수 안으로만 넣는다. 마이그레이션 도구는 `getenv("DB_URL")`로 접속 정보를 읽으므로, 비밀번호가 명령 인자(argv)나 Jenkins 콘솔 로그에 찍히지 않는다. (root 비밀번호 자체는 이 글에서도 다루지 않는다. Secret 참조로 충분하다.)

<b>둘째, 포워드는 짧게 열고 확실히 닫는다.</b> `trap ... EXIT`로 스텝이 끝나면 포워드 프로세스를 반드시 죽인다. 그리고 사람이 승인 버튼을 누르기를 기다리는 구간에서는 포워드를 열어두지 않는다. dry-run(변경분 확인)과 apply(실제 적용)를 <b>각각 별도 스텝</b>으로 두어, 사람이 고민하는 동안 터널이 계속 살아 있는 상황을 피했다. 승인 게이트가 터널을 붙잡고 있으면 안 된다.

접속 대상은 파이프라인이 배포 대상의 설정에서 kube-context를 골라 `kubectl --context <ctx>`로 고정한다. 이 context는 배포 STAGE(dev/stg/prod)와 <b>독립</b>이라, 엉뚱한 클러스터를 건드릴 여지를 줄였다.

> [!INFO]
> dry-run은 비정상 종료 코드를 "변경분 있음"으로 오해하면 안 된다. 잘못된 설정이나 접속 실패로 인한 non-zero exit은 <b>진짜 에러</b>이므로 스텝을 실패시켜야 하고, "적용할 변경이 있는지"는 stdout 마커로 따로 판정한다. 종료 코드와 변경 유무를 섞지 않아야 한다. 계약을 옮길 때 놓치기 쉬운 부분이었다.

## 3. 권한 모델

접근 경로를 뚫었으니, 이제 <b>이 에이전트가 클러스터에서 무엇까지 할 수 있는가</b>를 정할 차례다.

에이전트가 필요로 하는 건 딱 이만큼이다.

- 대상 Service/Pod를 찾기 위한 `pods, services` 의 `get/list`
- 터널을 열기 위한 `pods/portforward` 의 `create`
- DB 비밀번호를 읽기 위한, <b>특정 Secret 하나</b>에 한정된 `secrets get`

이 권한셋을 <b>ClusterRole</b>로 정의했다. 이름만 보면 "클러스터 전역 권한" 같지만, ClusterRole은 그 자체로는 아무것도 허가하지 않는다. 어떻게 바인딩하느냐가 실제 범위를 결정한다.

```yaml
# 재사용 가능한 "권한셋". 이 오브젝트 자체는 아무 권한도 부여하지 않는다.
# 바인딩 방식이 실제 접근 범위를 정한다. secrets get은 DB 클라이언트 시크릿
# 하나로 resourceNames를 좁혔다.
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: db-migrator
rules:
  - apiGroups: [""]
    resources: ["pods", "services"]
    verbs: ["get", "list"]
  - apiGroups: [""]
    resources: ["pods/portforward"]
    verbs: ["create"]
  - apiGroups: [""]
    resources: ["secrets"]
    verbs: ["get"]
    resourceNames: ["db-client-secret"]   # 이 시크릿에만 get 허용
```

바인딩은 <b>ClusterRoleBinding이 아니라 네임스페이스 RoleBinding</b>으로 했다.

- ClusterRoleBinding으로 묶으면 이 권한이 <b>모든 네임스페이스</b>에 적용된다. 그러면 SA 토큰 하나가 클러스터 전체의 (같은 이름) 시크릿을 읽고 어디서든 포워드를 열 수 있게 된다.
- 반면 네임스페이스 RoleBinding이 ClusterRole을 참조하면, 그 권한은 <b>해당 네임스페이스 안에서만</b> 유효하다. ClusterRole은 "권한셋 정의"로 재사용하고, 실제 허가 범위는 바인딩한 네임스페이스로 좁혀지는 것이다.

```yaml
# 권한셋(ClusterRole)을 "이 네임스페이스 안에서만" SA에 부여한다.
# ClusterRoleBinding이었다면 모든 네임스페이스에 적용됐을 것이다.
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: db-migrator
  namespace: <NS>            # 대상 네임스페이스마다 하나씩 적용
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: db-migrator
subjects:
  - kind: ServiceAccount
    name: db-migrator
    namespace: ci-migrator   # SA가 사는 홈 네임스페이스
```

덕분에 <b>클러스터당 SA 하나(=토큰 하나)</b>로 여러 테넌트 네임스페이스를 다루면서도, 접근은 정확히 바인딩한 네임스페이스로만 제한된다. 새 테넌트 네임스페이스를 온보딩할 때는 RoleBinding 하나만 더 얹으면 된다. 블라스트 반경(blast radius)은 "바인딩한 네임스페이스에서, DB 시크릿 하나를 읽고 포워드를 여는 것"으로 딱 묶인다.

SA 토큰은 만료 없는(long-lived) 토큰으로 뽑았다. 쿠버네티스 1.24+에서는 SA를 만들어도 토큰 Secret이 자동 생성되지 않으므로, `kubernetes.io/service-account-token` 타입 Secret을 명시적으로 만들어 얻는다. 토큰 값 자체는 kubeconfig에 임베드해 Jenkins에 시크릿 파일로 마운트하고, 저장소에는 커밋하지 않는다(`.gitignore`).

> [!IMPORTANT]
> 비만료 토큰은 편하지만 그만큼 관리 책임이 따라온다. 이 토큰은 SA/Secret을 지우거나 클러스터의 SA 서명 키가 로테이션되기 전까지 계속 유효하다. 그래서 <b>주기적으로 로테이션</b>(토큰 Secret 삭제 후 재생성)하는 걸 운영 절차에 넣었다. "만료가 없다"는 건 "내가 직접 갈아줘야 한다"는 뜻이다.

## 4. roleRef 불변과 orphan

여기서 마이그레이션의 진짜 함정을 하나 밟았다. 초기 버전에서는 권한 모델을 다르게 짰었다. 대상 네임스페이스마다 `Role + SA + 토큰`을 각각 심는 방식이었다. 클러스터당 SA 하나로 정리하면서 이걸 걷어내야 했는데, RoleBinding을 그냥 덮어쓰기(`apply`)로 갈아끼우려다 막혔다.

문제는 <b>`roleRef`가 불변(immutable)</b>이라는 점이다. RoleBinding의 `roleRef`(어떤 Role/ClusterRole을 가리키는지)는 한번 만들면 바꿀 수 없다. 기존 바인딩이 옛 `Role`을 가리키고 있으면, 새 `ClusterRole`을 가리키도록 `apply`로 수정할 수 없고 에러가 난다. 그래서 재적용 전에 <b>기존 바인딩을 먼저 지워야</b> 한다.

```bash
# roleRef는 불변이므로, (재)적용 전에 기존 바인딩을 먼저 삭제한다.
kubectl --context "$ADMIN_CTX" -n "$NS" \
  delete rolebinding db-migrator --ignore-not-found
sed "s/<NS>/$NS/g" rolebinding.yaml | kubectl --context "$ADMIN_CTX" apply -f -
```

그리고 옛 모델이 네임스페이스마다 심어 놨던 `Role`, `ServiceAccount`, 토큰 `Secret`은 새 모델에서는 쓰이지 않는 <b>orphan</b>으로 남는다. 자동으로 사라지지 않으니 한 번은 손으로 청소해야 한다. 이 정리 절차를 README에 못박아 뒀다.

```bash
# 구 모델의 잔재(네임스페이스별 Role/SA/토큰) 일회성 정리.
echo "$NAMESPACES" | tr ',' '\n' | while read -r NS; do
  [ -n "$NS" ] || continue
  kubectl --context "$ADMIN_CTX" -n "$NS" \
    delete role,serviceaccount db-migrator --ignore-not-found
  kubectl --context "$ADMIN_CTX" -n "$NS" \
    delete secret db-migrator-token --ignore-not-found
done
```

> [!INFO]- 콤마 리스트를 `tr`로 쪼갠 이유
> 위에서 네임스페이스 목록을 `tr ',' '\n' | while read`로 순회하는데, 이건 bash·zsh 양쪽에서 동작하게 하려는 것이다. zsh는 따옴표 없는 변수를 단어 분리하지 않아서 `for NS in $NAMESPACES` 같은 게 의도대로 안 갈라진다. 사소하지만 스크립트가 어느 셸에서 돌지 모를 때 밟는 함정이다.

## 5. 계약 보존

경로와 권한을 바꾸는 동안에도, 사용자(=승인하는 사람) 입장에서 파이프라인의 <b>동작</b>은 그대로여야 했다. 재설계에서 지켜낸 계약을 정리하면 이렇다.

- <b>dry-run 게이트</b>: 항상 dry-run으로 변경분을 먼저 뽑고, 적용은 대기 중인 대상이 있을 때만 나간다. 승인 메시지에는 "이번에 바뀌는 대상 목록"이 반드시 표시된다.
- <b>승인은 사람이</b>: 실제 적용은 승인 `input`을 통과해야 하고, 타임아웃(1시간)이 걸려 있다. 이 승인 하나가 배포 봇의 슬랙 버튼과 연결된다.
- <b>멱등성(Idempotency)</b>: 마이그레이션은 버전 기반이고 클러스터별 baseline이 있어, 같은 걸 여러 번 돌려도 안전하다.
- <b>온보딩 안 된 대상은 건너뛴다</b>: 아직 설정에 등록되지 않은 (stage, namespace) 조합은 마이그레이션 단계를 통째로 스킵한다. 에러도 아니고, 기존 동작 변화도 없다.

바뀐 건 "어디로 어떻게 붙느냐"와 "권한을 어떻게 최소화하느냐"이지, "무엇을 언제 적용하느냐"의 계약은 건드리지 않았다.

남은 숙제도 솔직히 적어둔다. v1 설정 파일에 남아 있는 평문 크레덴셜과 외부 NodePort 접속 정의는 이번엔 그대로 두고, 파이프라인이 런타임 `DB_URL`로 덮어쓰는 방식으로 우회했다. 평문 제거는 후속 작업이다. (아마 미래의 내가 하게 되겠지만.)

## 🔗 참고

- [kubectl port-forward](https://kubernetes.io/docs/reference/generated/kubectl/kubectl-commands#port-forward)
- [Using RBAC Authorization](https://kubernetes.io/docs/reference/access-authn-authz/rbac/)
- [Restrictions on RoleBinding — roleRef immutability](https://kubernetes.io/docs/reference/access-authn-authz/rbac/#restrictions-on-role-binding-creation-or-update)
- [ServiceAccounts](https://kubernetes.io/docs/concepts/security/service-accounts/)
- [Manually create a long-lived API token for a ServiceAccount](https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/#manually-create-a-long-lived-api-token-for-a-serviceaccount)
- [Atlas — Applying Migrations](https://atlasgo.io/versioned/apply)
- [[수작업 SQL 관리를 Atlas 버전드 마이그레이션으로 전환하기|이 마이그레이션을 돌리는 Atlas 도입 전체 이야기]]
