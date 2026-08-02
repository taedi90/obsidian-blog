---
title: Harbor 레지스트리 데이터 손실과 노드 캐시 이미지 역push 복구의 한계
date: 2025-10-28
draft: false
tags:
  - harbor
  - container-registry
  - containerd
  - disaster-recovery
  - troubleshooting
banner: 
cssclasses: 
description: Harbor 데이터가 날아간 뒤 전 노드에 캐시된 이미지 754개로 복구를 시도했지만, 대부분이 레이어 없는 껍데기라 복구 불가임을 확인한 기록.
permalink: 
aliases: 
completed: true
type:
  - issue
---

## 요약

> [!SUMMARY]
> Harbor DB·스토리지 장애로 레지스트리 데이터가 통째로 날아갔다. 전 노드에 캐시된 컨테이너 이미지 754개를 마지막 동아줄로 보고 역push 복구를 시도했지만, `ctr images check`로 걸러보니 레이어가 온전한 건 8개뿐이었다. 나머지는 containerd에 이름·매니페스트만 남고 실제 레이어(blob)가 없는 껍데기라, 외부 소스 없이는 복구가 불가능하다는 걸 확인하고 재빌드·재pull로 방향을 틀었다.

## 1. 환경

- Kubernetes 클러스터 (컨테이너 런타임 containerd)
- 컨테이너 레지스트리: Harbor
- 노드에 캐시된 이미지: 754개 (전 노드 `crictl images` 합산)

## 2. 이슈

Harbor의 DB와 오브젝트 스토리지가 장애로 함께 무너지면서 레지스트리 데이터가 손실됐다. 백업이 있었으면 이 글은 없었을 것이다. 없었으니 이 글이 있다.

당장 급한 건 배포였다. ArgoCD가 참조하는 이미지들이 레지스트리에서 통째로 사라졌으니, 새로 배포하거나 파드가 재기동되는 순간 `ImagePullBackOff`가 줄줄이 터질 상황이었다. 원본을 다시 구할 수 있는 공개 이미지는 그렇다 쳐도, 사내에서 빌드한 이미지가 문제였다. 이건 어디서 다시 받아올 데가 없다.

그때 떠오른 게 노드 캐시였다. 클러스터 노드들은 지금까지 돌린 파드의 이미지를 로컬 containerd에 캐시하고 있다. Harbor가 죽어도 이미 돌던 파드는 멀쩡히 돌고 있었다. 그렇다면 <b>노드에 남아 있는 이 캐시를 긁어모아 다시 Harbor로 밀어 넣으면(역push) 상당수를 살릴 수 있지 않을까?</b> 이게 첫 가설이었다.

결론부터 말하면 이 가설은 대체로 틀렸다. 다만 왜 틀렸는지가 이 글의 핵심이라, 순서대로 적는다.

## 3. 해결

### 1. 전 노드 캐시 이미지 목록 수집

먼저 클러스터에 이미지가 얼마나 남아 있는지 실물을 세야 했다. 각 노드에 SSH로 붙어 `crictl images`를 긁어 한곳에 모았다.

```bash
# 각 노드에 SSH로 접속해 crictl 이미지 목록을 수집한다.
for node in "${nodes[@]}"; do
  echo "=== Node: $node ==="
  ssh "$node" 'sudo crictl images | grep "registry.internal.example"'
done > all-cached-images.txt

# Harbor에서 받아온 이미지만 카운트
grep -c "registry.internal.example" all-cached-images.txt
# 754
```

754개. 손실 전 Harbor가 들고 있던 수백 개보다 오히려 많았다(태그 여러 개, 노드 중복 포함). 이 숫자만 보면 "다 살릴 수 있겠는데?" 싶었다. 여기서 함정에 빠졌다.

### 2. 이미지 메타데이터와 content store

핵심을 짚고 가야 한다. containerd의 이미지 스토어는 크게 두 부분이다.

- <b>이미지 메타데이터</b>: `이미지 이름 → 매니페스트 digest` 매핑. `crictl images`가 보여주는 게 이 목록이다.
- <b>content store</b>: 매니페스트가 가리키는 실제 레이어(blob)들. digest로 주소가 매겨진 실물 데이터다.

`crictl images`에 이름이 뜬다고 해서 그 이미지의 레이어가 content store에 온전히 다 있다는 뜻이 아니다. containerd는 이미지를 pull하면 레이어 blob을 받아 스냅샷으로 풀어(unpack) 쓰는데, 이후 원본 blob이 정리되거나 pull이 중간에 끊겨 <b>이름·매니페스트만 남고 레이어는 사라지는</b> 경우가 있다. 그러면 목록엔 멀쩡히 보이지만 push하려는 순간 "레이어가 없다"며 실패한다.

즉 754는 <b>"이름이 남은 이미지 수"</b>지 <b>"복구 가능한 이미지 수"</b>가 아니다. 이 둘을 같은 걸로 착각한 게 첫 가설이 틀린 이유였다.

그래서 레이어 완전성을 실제로 검사해야 했다. `ctr images check`는 각 이미지에 대해 매니페스트가 참조하는 blob이 content store에 다 있는지 보고 `complete`/`incomplete`를 찍어준다.

```bash
# 각 노드에서 k8s.io 네임스페이스의 각 이미지가 레이어까지 온전한지 검사한다.
for node in "${nodes[@]}"; do
  ssh "$node" 'for img in $(sudo ctr -n k8s.io images ls -q | grep registry.internal.example | grep -v "@sha256:"); do
    sudo ctr -n k8s.io images check name=="$img"
  done'
done | grep -E "(complete|incomplete)" > layer-status.txt

# 레이어까지 온전한(complete) 이미지만 카운트
grep -w complete layer-status.txt | wc -l
# 8
```

8개. 754개 중 8개(약 1.1%)만 레이어가 온전했고, 나머지 746개는 `incomplete` — 껍데기였다.

왜 이렇게 처참한가. 노드에 이미지가 pull되면 레이어는 스냅샷으로 풀린 뒤 원본 blob이 정리되는 경우가 많고, pull이 중간에 끊겨 일부 레이어만 남은 경우도 있다. 파드를 띄우는 데는 지장이 없지만, 이미지 전체를 다시 조립해 push하려면 원본 레이어 blob이 다 있어야 하는데 그게 없다. 그래서 대부분이 incomplete였다.

### 3. 온전한 8개를 재구축한 Harbor로 push

건질 수 있는 건 확실히 건진다. `complete`로 나온 8개는 노드에서 곧바로 `ctr image push`로 재구축한 Harbor에 밀어 넣었다. 굳이 tar로 뽑아 옮길 것 없이, 노드의 containerd가 가진 이미지를 레지스트리로 직접 올리면 된다.

```bash
# complete로 확인된 이미지를 노드에서 Harbor로 직접 push한다. (blob이 온전해야 성공)
sudo ctr -n k8s.io image push \
  --user '<robot-account>:<token>' \
  registry.internal.example/project/app:tag
```

`incomplete` 이미지에 같은 push를 시도하면 레이어 blob이 없어 `blob upload invalid`로 실패한다. 이게 "복구 불가"의 실증이다. 목록에 이름은 있는데 실물이 없으니, 아무리 명령을 두드려도 없는 레이어가 생겨나진 않는다.

incomplete 이미지를 다시 pull하거나 `ctr content fetch`로 누락 레이어만 받아보려고도 했다. 하지만 받아올 원본인 Harbor가 죽어 있으니 될 리 없었다.

### 4. 나머지 746개는 외부 소스로

캐시로 살릴 수 없다는 게 분명해졌으니, 남은 건 원본을 다시 구하는 것뿐이었다.

- <b>공개 이미지</b>: Docker Hub·공식 레지스트리에서 다시 pull해서 Harbor로 재push. 보관 부담이 없는 부류라 상대적으로 수월했다.
- <b>사내 빌드 이미지</b>: CI/CD 파이프라인을 다시 돌려 재빌드. Dockerfile과 소스가 버전 관리되고 있어서 살아난 거지, 이게 없었으면 정말로 복구 불가였다.

```bash
# 공개 이미지: 원본에서 재pull → Harbor로 재push
docker pull nginx:1.24
docker tag nginx:1.24 registry.internal.example/library/nginx:1.24
docker push registry.internal.example/library/nginx:1.24

# 사내 이미지: CI/CD 재실행으로 재빌드
```

## 4. 확인

| 항목 | 수량 |
|------|------|
| 노드 캐시 이미지 총계 | 754 |
| 레이어 온전(복구 성공) | 8 |
| 레이어 불완전(캐시 복구 불가) | 746 |
| 외부 소스 재수집·재빌드 | 746 |

노드 캐시에서 실제로 살린 건 8개, 1.1%였다. 숫자만 보면 초라하지만, 애초에 754개가 다 살 수 있는 게 아니었다는 사실을 확인한 것 자체가 이 작업의 결과였다. `incomplete` 746개는 어떤 재주를 부려도 이 클러스터 안에서는 나오지 않는다. 살릴 수 있는 8개는 캐시로, 나머지는 외부 소스로 처리했다.

교훈은 뻔하지만 뼈아프다.

- <b>노드 캐시는 백업이 아니다.</b> 실행에 필요한 레이어만 조각조각 남을 뿐, 이미지 전체를 담고 있지 않다. 재난 시 최후의 동아줄로 기대할 대상이 못 된다.
- 레지스트리 백업이 곧 복구 가능성이다. Harbor DB(PostgreSQL) 정기 백업, 오브젝트 스토리지 스냅샷, 설정 버전 관리가 없으면 데이터 손실 시 복구 수단이 없다.
- 사내 빌드 이미지가 그나마 살아난 건 소스와 Dockerfile이 관리되고 있었기 때문이다. 이건 결과적으로 이중화가 돼 있던 셈이다.

단일 Harbor 인스턴스는 SPOF다. 중요 이미지는 외부 스토리지에 이중 push해두거나 레지스트리 복제를 걸어두는 편이 좋겠다는 생각을, 데이터를 다 날리고 나서야 했다.

## 참고

- [containerd content flow (image content store)](https://github.com/containerd/containerd/blob/main/docs/content-flow.md)
- [crictl (Kubernetes debug)](https://kubernetes.io/docs/tasks/debug/debug-cluster/crictl/)
- [Harbor Backup and Restore](https://goharbor.io/docs/2.11.0/administration/backup-restore/)
