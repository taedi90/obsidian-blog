---
title: "CI 빌드 캐시가 디스크를 잠식하지 않게: 전용 buildx 빌더와 buildkitd GC 정책"
date: 2026-05-04
draft: false
tags:
  - ci
  - docker
  - buildkit
  - buildx
  - jenkins
banner: 
cssclasses: 
description: CI 이미지 빌드 캐시가 빌드 노드 디스크를 야금야금 잠식하던 걸, 전용 buildx 빌더와 buildkitd GC 정책으로 상·하한을 걸어 잡은 기록.
permalink: 
aliases: 
completed: true
type:
  - note
---

> [!SUMMARY]
> CI에서 이미지를 빌드할 때마다 BuildKit 캐시가 쌓이기만 하고 줄지 않아 빌드 노드 디스크를 잠식했다. `docker-container` 드라이버로 전용 buildx 빌더를 재실행해도 안전하게(idempotent) 만들고, 그 빌더의 buildkitd에 GC 정책을 물려 캐시 사용량에 하한(`reservedSpace`)과 상한(`maxUsedSpace`·`minFreeSpace`)을 걸었다. 캐시 이점은 그대로 두고 디스크 고갈만 막는 게 목표였다.

## 1. 쌓이기만 하는 빌드 캐시

CI에서 도커 이미지를 빌드하면 레이어 캐시가 남는다. 다음 빌드가 빨라지니 캐시 자체는 고마운 존재인데, 문제는 <b>이게 알아서 줄지 않는다</b>는 점이다. 빌드 노드에서 며칠 돌리다 보면 캐시가 수백 GB로 불어 디스크를 잠식했다. 결국 디스크가 차서 빌드가 실패하고, 그제서야 사람이 직접 들어가 `docker buildx prune`을 실행하는 구조였다. 캐시가 주는 편익을 디스크 청소 작업으로 되갚는 셈이라 영 마음에 들지 않았다.

캐시를 아예 안 남기면? 그럼 빌드가 매번 처음부터 도니 느리다. 그건 문제를 없애는 게 아니라 다른 문제로 바꾸는 것뿐이다. 내가 원한 건 <b>캐시는 유지하되 디스크를 다 먹기 전에 알아서 정리되는</b> 상태였다. 사람이 개입하지 않아도 캐시가 일정 범위 안에서 살아 움직이는 것.

여기서 짚어야 할 제약이 하나 있었다. Jenkins 컨테이너는 호스트의 도커 소켓을 그대로 물려 쓰는데(`/var/run/docker.sock` 마운트), 이때 빌드는 기본 buildx 빌더, 즉 도커 데몬(dockerd)에 내장된 BuildKit으로 나간다. 이 기본 빌더(`docker` 드라이버)는 buildkitd 설정 파일을 따로 지정하기가 어렵다. GC 정책을 바꾸려면 데몬 자체를 수정해야 하는데, 빌드 노드의 도커 데몬 설정을 CI 편의 때문에 변경하는 일은 내키지 않았다.

## 2. docker-container 드라이버로 전용 빌더 분리

그래서 빌드 전용 빌더를 따로 세우기로 했다. buildx의 <b>`docker-container` 드라이버</b>는 BuildKit을 도커 데몬 안이 아니라 별도 컨테이너로 띄운다. 이 드라이버를 쓰면 빌더를 만들 때 `--buildkitd-config`로 buildkitd 설정 파일을 통째로 넣을 수 있다. 호스트 데몬은 그대로 두고, 이 전용 빌더에만 GC 정책을 걸 수 있다는 뜻이다.

빌더 생성은 컨테이너가 뜰 때마다 실행되는 초기화 스크립트에 넣었다. 여기서 신경 쓴 건 <b>멱등성(idempotency)</b>이다. 컨테이너가 재시작될 때마다 `create`를 무지성으로 부르면 "빌더가 이미 있다"며 실패한다. 그래서 먼저 `inspect`로 존재 여부를 보고, 없을 때만 만든다.

```sh
#!/usr/bin/env sh
set -eu

BUILDER_NAME=ci-builder
BUILDKITD_CONFIG=/opt/buildkit/buildkitd.toml

# 이미 있으면 건너뛰고, 없을 때만 docker-container 드라이버로 전용 빌더를 만든다.
# (재시작마다 무조건 create 하면 "already exists"로 죽으니, inspect로 먼저 확인)
if ! docker buildx inspect "$BUILDER_NAME" >/dev/null 2>&1; then
  docker buildx create \
    --name "$BUILDER_NAME" \
    --driver docker-container \
    --buildkitd-config "$BUILDKITD_CONFIG"
fi

# 빌더의 BuildKit 컨테이너를 실제로 기동(bootstrap)해 첫 빌드가 느려지지 않게 한다.
docker buildx inspect "$BUILDER_NAME" --bootstrap >/dev/null
```

`--bootstrap`은 빌더의 BuildKit 컨테이너를 미리 띄워두는 옵션이다. 이걸 안 하면 첫 빌드가 들어올 때 컨테이너를 띄우느라 한 박자 늦는데, 초기화 시점에 미리 깨워두는 편이 낫다.

## 3. buildkitd GC 정책으로 상·하한 걸기

빌더에 지정한 `buildkitd.toml`이다. 여기에 GC 정책을 적어 캐시가 사용할 수 있는 디스크 범위에 상·하한을 정했다.

```toml
# ref https://docs.docker.com/build/buildkit/toml-configuration/
root = "/var/lib/buildkit"
[worker.oci]
  gc = true

  [[worker.oci.gcpolicy]]
    all = true
    reservedSpace = "30GB"
    maxUsedSpace = "500GB"
    minFreeSpace = "20%"
```

값 하나하나가 하는 일이 다르다.

- <b>`gc = true`</b>: 이 워커에서 자동 GC를 켠다. 이게 꺼져 있으면 밑에 정책을 아무리 적어도 청소가 안 돈다.
- <b>`reservedSpace = "30GB"`</b>: 캐시의 <b>하한</b>이다. GC가 돌아도 이 밑으로는 캐시를 걷어내지 않는다. 캐시 이점을 유지하려고 둔 안전판이다. 청소한답시고 캐시를 0으로 밀어버리면 매 빌드가 다시 처음부터 도니, "이만큼은 남겨둬라"를 못 박은 것.
- <b>`maxUsedSpace = "500GB"`</b>: 캐시의 <b>상한</b>이다. 캐시가 이 선을 넘으면 GC가 돌아 다시 밑으로 끌어내린다. 디스크를 잠식하던 주범을 직접 겨누는 값이다.
- <b>`minFreeSpace = "20%"`</b>: 디스크에서 항상 비워둘 여유 공간이다. 자유 공간이 이 밑으로 떨어지면 캐시를 정리한다. `maxUsedSpace`가 캐시 절대량을 보는 축이라면, 이쪽은 디스크 전체의 여유를 보는 축이다. 둘 중 먼저 걸리는 쪽이 GC를 부른다.
- <b>`all = true`</b>: 이 정책이 내부·공유 캐시 레코드까지 전부 청소 대상으로 삼게 한다. 기본적으로 BuildKit은 일부 레코드를 보호하는데, `all = true`면 예외 없이 이 정책의 상·하한 규칙을 따르게 된다.

> [!NOTE]
> `reservedSpace`(하한)와 `maxUsedSpace`(상한)를 한 정책에 같이 적는 것이 이 설정의 핵심이다. 하한만 있으면 캐시가 무한정 불어나고, 상한만 있으면 청소 시점에 캐시가 비어 있어 빌드가 느려질 수 있다. 두 값 사이에서 캐시가 오가도록 만드는 것이 "캐시는 살리고 디스크는 지키는" 지점이었다. 30GB / 500GB는 우리 빌드 노드 디스크 크기와 이미지 크기를 보고 정한 값이라, 환경에 맞춰 조절할 값이다.

## 4. 컨테이너 기동에 물리기

마지막으로 이 조각들을 Jenkins 컨테이너에 엮었다. `buildkitd.toml`과 초기화 스크립트를 컨테이너 안으로 마운트하고, 컨테이너 엔트리포인트를 이 초기화 스크립트로 지정했다. 그리고 파이프라인이 매번 `--builder ci-builder`를 붙이지 않아도 되도록 `BUILDX_BUILDER` 환경변수로 기본 빌더를 지정했다.

```yaml
services:
  jenkins:
    # ...
    environment:
      # 이 값이 있으면 docker buildx 명령이 별도 지정 없이 이 빌더를 쓴다.
      - BUILDX_BUILDER=ci-builder
    volumes:
      # GC 정책 설정과 초기화 스크립트를 컨테이너 안으로 읽기 전용 마운트
      - ./buildkitd.toml:/opt/buildkit/buildkitd.toml:ro
      - ./jenkins-init-buildx.sh:/usr/local/bin/jenkins-init-buildx.sh:ro
    # Jenkins 기동 전에 전용 빌더부터 준비시킨다
    entrypoint: ["/bin/sh", "/usr/local/bin/jenkins-init-buildx.sh"]
```

엔트리포인트를 초기화 스크립트로 덮어썼으니, 스크립트가 빌더 준비를 마친 뒤에는 원래의 Jenkins 기동으로 이어져야 한다. 컨테이너를 재시작해도 2번의 멱등성 덕분에 빌더는 있으면 재사용, 없으면 재생성으로 조용히 정리된다.

## 5. 동작 확인

빌드를 몇 번 돌린 뒤 전용 빌더의 캐시 사용량을 봤다. 별도 지정 없이 조회하면 `BUILDX_BUILDER`가 가리키는 `ci-builder`를 본다.

```sh
# 전용 빌더의 빌드 캐시 사용량을 확인한다. 상한(maxUsedSpace) 근처에서
# GC가 돌며 하한(reservedSpace) 위로 유지되는지가 관전 포인트.
docker buildx du --builder ci-builder
```

캐시가 상한을 넘기려 하면 GC가 돌아 다시 내려오고, 그래도 하한 아래로는 안 떨어져 캐시 히트는 유지됐다. 디스크가 차서 빌드가 실패하는 일도, 사람이 직접 들어가 `prune`을 실행하는 일도 없어졌다. 원했던 "손을 대지 않아도 캐시가 범위 안에서 유지되는" 상태가 바로 그것이다.

## 참고

- [BuildKit TOML configuration](https://docs.docker.com/build/buildkit/toml-configuration/)
- [Build cache garbage collection](https://docs.docker.com/build/cache/garbage-collection/)
- [docker-container build driver](https://docs.docker.com/build/builders/drivers/docker-container/)
- [[모노레포 증분 빌드 파이프라인 - 커밋 해시 태깅과 git diff 선별 빌드|이 빌더로 캐시를 태우는 모노레포 증분 빌드 파이프라인]]
