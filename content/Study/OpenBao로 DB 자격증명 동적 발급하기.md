---
title: OpenBao로 DB 자격증명 동적 발급하기
date: 2026-07-24
draft: false
tags:
  - openbao
  - vault
  - secrets
  - security
  - kubernetes
banner: 
cssclasses: 
description: OCI 단일 노드 k3s에서 OpenBao를 굴려, 앱이 볼트 SDK 한 줄 없이 사이드카가 주입한 파일로 동적 PostgreSQL 자격증명을 받아 쓰는 구성을 만들며 배운 것. seal/unseal, 동적 자격증명 생명주기, 시크릿 관리 생태계에서의 자리까지.
permalink: 
aliases: 
completed: true
type:
  - note
---

## 요약

> [!SUMMARY]
> 시크릿을 앱 코드·설정에서 걷어내려 [OpenBao](https://openbao.org/)를 OCI 단일 노드 k3s에 학습용으로 올려봤다. 앱은 OpenBao를 전혀 모른 채 사이드카가 넣어준 `/vault/secrets/db-creds` 파일만 읽어 DB에 붙고, 그 자격증명은 요청 때마다 새로 만들어졌다 만료되면 사라지는 임시 계정이다. 이걸 굴리며 seal/unseal의 실체, 동적 자격증명의 생명주기, 시크릿 관리 생태계에서 OpenBao가 앉는 자리를 정리했다.

"시크릿을 볼트에 넣는다"는 한마디가 실제로는 꽤 여러 결정의 묶음이었다.

## 1. OpenBao의 두 얼굴부터 가른다

"DB"라는 단어가 OpenBao 문맥에서 완전히 다른 두 가지를 가리켜서, 먼저 이걸 분리해야 헷갈리지 않는다.

- <b>스토리지 백엔드</b> — OpenBao가 <b>자기 상태</b>(정책·토큰·lease·암호문)를 저장하는 곳. `file`(PVC)이나 raft 등. 
- <b>secrets engine</b> — 외부 시스템을 <b>관리</b>하는 플러그인. `database`(→PostgreSQL), KV, Transit, PKI 등.

<b>OpenBao 자체는 DB가 필요 없다</b>. 이 데모에서 PostgreSQL은 OpenBao가 의존하는 저장소가 아니라 <b>관리하는 대상</b>이다. secrets engine은 다시 둘로 갈린다. 요청 시 자격증명을 <b>만들고</b> 만료 시 <b>회수</b>하는 동적 엔진(database·pki 등)과, 넣어둔 값을 <b>보관·전달</b>하는 정적 엔진(KV). 이 글의 주인공은 동적 쪽이다.

(참고로 OpenBao는 HashiCorp Vault의 오픈소스 포크다. Vault가 라이선스를 BUSL로 바꾸자 커뮤니티가 이전 MPL 시절을 이어받아 갈라져 나온 프로젝트라, 개념·API·심지어 사이드카 injector까지 Vault 계열과 거의 그대로 호환된다.)

## 2. seal/unseal 동작

OpenBao가 스토리지에 쓰는 <b>모든 데이터는 항상 암호문</b>이다. 이 암호화 계층을 barrier라 부른다. <b>봉인(sealed) 상태 = barrier를 여는 키가 메모리에 없는 상태</b>고, 이때 API는 `503 sealed`를 뱉는다. 키는 3단으로 겹쳐 있다.

```text
Unseal Keys (Shamir 조각; OpenBao가 저장하지 않음)
   │ threshold개를 모으면
   ▼
Root Key (barrier 최상위 키; 메모리에만 존재)
   │ 복호화
   ▼
Encryption Keyring (실제 데이터 암호화 키)
   │ 복호화
   ▼
Storage의 모든 데이터
```

포인트는 unseal key가 데이터를 <b>직접</b> 여는 게 아니라는 것이다. `unseal key → root key 재조립 → keyring 복호화 → 데이터`의 3단이다. 그래서 봉인/해제는 순수하게 <b>"메모리에 복호화 키가 있느냐"의 토글</b>이다. 디스크는 그대로 두고 메모리의 root key를 버리면 seal, 조각으로 다시 조립해 올리면 unseal. 프로세스가 죽으면 메모리가 날아가니 <b>재시작마다 다시 봉인</b>된다(standalone 기준).

여기서 헷갈렸던 게 하나 있다. unseal key를 이미 k8s Secret에 저장해뒀는데 왜 재시작할 때마다 `unseal.sh`를 또 돌려야 하나? OpenBao에는 <b>"이 Secret을 읽어 스스로 unseal"하는 기능이 없다</b>. Shamir 설계상 <b>외부 행위자</b>가 키를 제출해야 열리고, 그 행위자가 스크립트(또는 부트스트랩 Job)다. 이걸 자동화하는 정답은 in-cluster Secret이 아니라 <b>auto-unseal</b> — root key를 외부 KMS(또는 다른 Bao의 Transit)로 암호화해두고 부팅 시 그쪽에 복호화를 요청해 스스로 여는 방식이다. 신뢰 앵커가 클러스터 밖에 있어야 "클러스터가 뚫려도 암호문과 열쇠를 동시에 얻지는 못한다"가 성립한다.

## 3. 동적 DB 자격증명: 앱은 볼트를 모른다

이 데모의 핵심이다. OpenBao는 PostgreSQL로 <b>관리자 커넥션 하나(`bao_admin`)만</b> 들고 있다가, 자격증명 요청이 올 때마다 임시 계정을 찍어낸다.

```text
read database/creds/app-ro 요청
   │ bao_admin 으로 실행
   ▼ creation_statements
   CREATE ROLE "v-...-app-ro-xxxx" LOGIN PASSWORD '랜덤' VALID UNTIL '만료';   ← 임시 계정 생성
   │ lease(TTL) 부여
   ▼ lease 만료·회수 시 revocation_statements
   DROP ROLE "v-...-app-ro-xxxx";                                            ← 계정 삭제
```

자격증명의 생명주기를 실제로 관찰해봤다.

1. <b>발급</b> — 사이드카가 로그인하면 임시 롤이 생기고 자격증명이 파일로 렌더된다.
2. <b>갱신(renew)</b> — 사이드카가 lease를 `max_ttl`까지 갱신하며 그동안 <b>같은</b> 유저를 유지한다.
3. <b>재발급</b> — `max_ttl`에 도달해 더 못 늘리면 <b>새</b> 자격증명을 받아 파일을 다시 쓴다(유저명이 바뀐다).
4. <b>회수(revoke)</b> — lease가 만료되면 OpenBao가 그 임시 롤을 PostgreSQL에서 `DROP`한다.

백엔드 Pod를 재시작하니 동적 유저명이 `v-...-app-ro-Ylqk…`에서 `v-...-app-ro-vPIc…`로 갈렸고, `pg_user`에서 임시 유저가 생겼다 만료·소멸하는 걸 눈으로 확인했다. 중요한 건 <b>앱 코드엔 OpenBao SDK가 한 줄도 없다</b>는 것이다. 사이드카(vault-agent)가 k8s ServiceAccount 토큰으로 로그인해 자격증명을 받아 파일로 떨궈두면, 앱은 그 파일만 읽어 psycopg로 접속한다.

이게 바꾸는 그림은 이렇다. <b>여기저기 흩어진 장수(長壽) 정적 크리덴셜을, 한 곳(OpenBao)에 집중된 admin 하나로</b> 바꾼 것이다. 앱이 받는 건 계속 회전하는 단명 계정이고, 사람이 넣은 비밀번호는 어디에도 안 박힌다. admin(`bao_admin`)은 회전을 안 해도 앱 설정·코드가 아니라 OpenBao 내부에만 있어 노출면이 작고, 최소 권한(superuser가 아니라 CREATEROLE + 필요한 GRANT만)으로 더 줄인다.

## 4. 정적 admin과 쓰기 권한: 동적의 트레이드오프

동적 시크릿은 "흩어진 정적 크리덴셜 다수"를 "집중된 admin 하나"로 바꾼다. 그 대가로 `bao_admin`은 기본적으로 회전하지 않는 장수 계정이 되니, 여기에 위험이 몰린다. 완화 장치는 중요도 순으로 이렇다.

- <b>최소 권한.</b> 이 데모의 `bao_admin`은 superuser가 아니다. `CREATEROLE`과 필요한 테이블 `GRANT`만 준다.
- <b>rotate-root.</b> `database/rotate-root/pg`를 실행하면 admin 비밀번호를 랜덤으로 바꿔 <b>OpenBao만 알게</b> 한다. 사람이 부트스트랩에 넣은 비번이 그 순간 무효화된다(on-demand 1회성).
- <b>자동 회전.</b> 버전에 따라 커넥션에 `rotation_period`/`rotation_schedule`을 줘 admin 비번을 주기적으로 돌릴 수 있다.

쓰기 권한을 줄 때도 함정이 있다. 이 데모는 읽기전용(`GRANT SELECT`)만 발급했는데, INSERT/UPDATE/DELETE(DML)까지 주는 건 동적 롤과 잘 맞는다. PostgreSQL에서 <b>행(row)에는 소유자가 없고 객체(테이블)에만</b> 있어서, 단명 유저가 써넣은 데이터는 그 유저가 `DROP`돼도 남기 때문이다. 반대로 `CREATE TABLE` 같은 DDL은 단명 유저가 객체 소유자가 돼 `DROP ROLE`이 의존성으로 실패한다. 이땐 revocation에 `REASSIGN OWNED`/`DROP OWNED`가 필요하거나, 아예 유저명이 고정되는 <b>static role</b>(계정은 그대로 두고 비번만 주기 회전)이 낫다. 마이그레이션·객체 소유가 필요한 앱은 static role 쪽이다.

(한 가지 실수를 짚어두면, `GRANT SELECT ... TO bao_admin`에 `WITH GRANT OPTION`이 빠지면 admin이 동적 유저에게 권한을 재부여하는 게 <b>조용히 no-op</b>이 된다. 나중에 "permission denied"로 터진다.)

## 5. 회전하지 않는 시크릿도 같은 틀로: KV·Transit·PKI

동적 발급이 안 되는(발급 API가 없는) 값도 같은 전달 틀로 관리된다. DB 계정만 OpenBao로 옮기는 게 아니다.

- <b>KV v2</b> — 서드파티 API 키·라이선스·토큰 같은 정적 시크릿. 사이드카로 파일에 똑같이 전달한다(`kv/data/...`). 자동 회전은 없지만 중앙 저장 + 경로별 정책 + 접근 감사 + 버전/롤백 + 암호화를 얻는다. (그냥 k8s Secret은 기본적으로 etcd에 base64로만, 즉 비암호로 들어가고 세밀한 감사도 없다.)
- <b>Transit</b> — 암호화 서비스(EaaS). 키를 밖으로 안 내보내고 encrypt/decrypt/sign만 대행한다. 위에서 말한 "다른 Bao의 Transit으로 auto-unseal"이 바로 이 엔진을 셀프호스트로 쓴 것이다.
- <b>PKI</b> — 단명 인증서 발급.

차이는 "OpenBao가 값을 만들어주느냐(dynamic) vs 넣은 값을 지켜주느냐(KV)"일 뿐, 전달·정책·감사 틀은 동일하다. 회전이 필요한데 동적이 불가능하면 static role이나 "KV + 외부 자동화(CronJob이 새 버전 put)"로 우회한다.

## 6. 사이드카 주입은 어떻게 되나 (Istio와 같은 뿌리)

앱 파드에 사이드카가 어떻게 끼어드는가? 이건 OpenBao 고유 기능이 아니라 순수 쿠버네티스의 <b>Mutating Admission Webhook</b>이다.

```text
Pod 생성 요청 → apiserver: 인증→인가→[Mutating Admission]→검증→etcd 저장→스케줄
                                    ▲ 여기서 injector webhook 호출
   annotation(vault.hashicorp.com/agent-inject:"true")을 읽고
   JSONPatch로 init 컨테이너 + 사이드카 + 공유 볼륨을 pod spec에 추가
```

etcd에 저장되기 전, apiserver 요청 경로 안에서 <b>한 번(one-shot)</b> pod spec을 변형한다. 그래서 이미 떠 있는 Pod의 annotation을 바꿔봐야 소용없고 <b>재생성(rollout restart)</b>해야 주입된다. 실제로 설치 직후 이 지점에서 데였다. injector webhook의 `failurePolicy`가 `Ignore`라, webhook 서버가 준비되기 전에 스케줄된 파드는 <b>사이드카가 조용히 안 붙는다</b>. 앱은 `/healthz`만 통과해 "떠 있는 것처럼" 보이지만 정작 자격증명 파일이 없어 실제 요청은 500이 났다. 부트스트랩이 끝난 뒤 한 번 `rollout restart`로 재주입을 강제해야 했다.

이 골격은 [Istio](https://istio.io/)의 사이드카 주입과 <b>정확히 같은 확장점</b>이다. 다만 트리거와 목적이 다르다.

| | OpenBao(vault-agent) | Istio(사이드카 모드) |
|---|---|---|
| 트리거 | Pod annotation | 네임스페이스 라벨 + Pod override |
| failurePolicy 기본 | Ignore(미주입 통과) | 최신 기본 Fail(생성 차단) |
| 주입물 | vault-agent(+시크릿 프리페치 init) | istio-proxy(Envoy)(+iptables 리다이렉트) |
| 목적 | 시크릿 파일 전달 | 트래픽 가로채기(mTLS·라우팅) |

(더 깊은 얘기는 [[Istio 서비스 메시 학습기]]에.)

## 7. 시크릿 관리 생태계에서 OpenBao의 자리

공부하며 제일 얻은 건 개별 기능보다 <b>SOPS·KMS·IAM·OpenBao·ESO가 어떻게 겹치고 갈리는지</b>였다. 이들은 같은 레이어의 경쟁자가 아니라 <b>서로 다른 레이어의 스택</b>이다.

```text
① 신원 뿌리   IAM / 워크로드 아이덴티티     ← 모두가 여기에 인증(저장된 비밀 0을 지향)
② 크립토 뿌리 KMS(또는 HSM)               ← 최상위 키(KEK)만, 앱 시크릿은 안 넣음
        ↑ 이 둘을 딛고
③ 전달 (여기서만 실제로 경쟁/보완)
     SOPS ──── git에 암호화 저장(at-rest), 배포 시 복호화, 런타임 무의존
     OpenBao ─ 런타임 서버, 보관+회전+동적생성+감사, KMS로 unseal·IAM으로 인증
     ESO ───── OpenBao/KMS의 값을 k8s Secret 오브젝트로 실체화(브리지)
        ↓
④ 소비   워크로드(Pod/VM)
```

겹치는 건 전달 레이어의 <b>SOPS ↔ OpenBao</b>뿐이다. 그리고 그 둘의 근본 차이는 흔히 말하는 "수동 회전 vs 자동 회전"이 아니라 <b>보관 vs 생성</b>이다. SOPS는 넣어둔 값을 지켜서 전달할 뿐이고, OpenBao는 <b>값을 만들어내기까지</b> 한다(그래서 회전이 자동으로 따라온다). 대신 대가가 있다. SOPS는 배포 후 <b>런타임 의존성이 없지만</b>, OpenBao는 sealed되거나 죽으면 앱이 시크릿을 못 받는 <b>살아있는 의존성</b>이다(단일 노드에선 단일 장애점).

그래서 OpenBao를 도입한다고 SOPS가 완전히 사라지진 않는다. OpenBao 자신의 unseal 키 같은 <b>부트스트랩 앵커</b>는 여전히 어딘가(git이면 SOPS, 아니면 KMS) 있어야 하고, 사이드카로 못 주는 것(`imagePullSecrets`, Gateway TLS, 오퍼레이터가 읽는 Secret 오브젝트)은 ESO로 브리지하거나 그 부분만 SOPS로 남긴다. 우리 조직이 지금 쓰는 [[GitOps 비밀 관리 도입기 SOPS와 age 값 단위 암호화|SOPS 중심 방식]]은 동적이 불필요하고 서버를 안 늘려도 되는 GitOps 순수형으로 적합하고, 동적·회전·감사가 필요한 다수 서비스로 가면 OpenBao 중심(또는 둘을 섞은 하이브리드)이 답이 된다.

한 줄로: <b>IAM=신원 뿌리, KMS=크립토 뿌리, OpenBao=런타임 시크릿 플랫폼(보관+회전+동적생성), SOPS=git-at-rest 전달(무의존·단순).</b> "OpenBao가 더 해준다"는 건 공짜가 아니라 <b>서버 운영 비용과 맞바꾼 것</b>이다.

## 8. 구현하며 밟은 함정들

학습용이라지만 차트를 직접 만들며 실제로 데인 것들이다.

- <b>클러스터 오배포.</b> `helm`은 `--kube-context`가 없으면 현재 컨텍스트에 배포한다. 로컬 기본 컨텍스트가 다른 클러스터를 가리키고 있어 웹훅까지 엉뚱한 곳에 올라갔고 즉시 정리했다. 이후 모든 `helm`/`kubectl`에 컨텍스트를 명시했다.
- <b>injector 접두사.</b> OpenBao 차트가 `vault-k8s` injector를 그대로 번들해서, annotation 접두사가 `openbao.org/`가 아니라 <b>`vault.hashicorp.com/`</b>이고 주입 경로도 `/vault/secrets/`다. `openbao.org/`로 적으면 조용히 무시된다(라이브로 확인).
- <b>helm v4 SSA 충돌.</b> 서버사이드 apply가 injector 웹훅의 `caBundle`(vault-k8s가 소유)과 충돌해서, `helm upgrade`에 `--force-conflicts`가 필요했다.
- <b>grant option no-op.</b> 위 4절에서 말한 그 함정 — `WITH GRANT OPTION` 누락.
- <b>웹훅 레이스.</b> 6절의 미주입 → `rollout restart`.
- <b>StorageClass 중복.</b> 기본 StorageClass가 둘이라 PVC에 어느 걸 쓸지 명시해야 했다.

## 9. 한계

이 셋업은 철저히 학습용이라 부끄러운 구석이 많다. unseal 키와 root 토큰을 평문 Secret에 넣어뒀고 in-cluster TLS도 안 썼다(프로덕션엔 이대로 쓰면 안 된다). 제대로 가려면 재봉인을 없앨 transit/KMS auto-unseal, 그리고 사이드카로 못 주는 비-Pod 시크릿을 위한 ESO 브리지가 다음 숙제다. 그래도 스토리지 백엔드와 secrets engine을 가르고, 봉인의 신뢰 앵커를 어디 둘지 정하고, 앱을 볼트에서 떼어내 자격증명을 단명화하는 이 한 묶음을 직접 굴려본 건 남았다.

## 참고

- [[GitOps 비밀 관리 도입기 SOPS와 age 값 단위 암호화]]
- [[Istio 서비스 메시 학습기]]
- [OpenBao](https://openbao.org/)
- [OpenBao — Database secrets engine](https://openbao.org/docs/secrets/databases/)
- [Kubernetes — Dynamic Admission Control](https://kubernetes.io/docs/reference/access-authn-authz/extensible-admission-controllers/)
