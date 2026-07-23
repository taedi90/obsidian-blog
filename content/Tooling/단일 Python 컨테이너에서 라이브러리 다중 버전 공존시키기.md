---
title: 단일 Python 컨테이너에서 라이브러리 다중 버전 공존시키기 (PYTHONPATH/sys.path 격리 검증)
date: 2026-03-12
draft: false
tags:
  - python
  - docker
  - dependency-management
  - weaviate
  - troubleshooting
banner: 
cssclasses: 
description: 호환 불가 변경이 있는 클라이언트 라이브러리 두 버전을 하나의 컨테이너에서 환경변수로 골라 로드해야 했다. multi-stage 빌드와 sys.path.insert로 격리하고 실제 API 차이까지 실측한 기록.
permalink: 
aliases: 
completed: true
type:
  - issue
---

## 🚀 요약

> [!SUMMARY]
> 호환 불가 변경이 있는 클라이언트 라이브러리(`weaviate-client`) 두 버전을 하나의 컨테이너에서 환경변수로 골라 써야 했다. multi-stage 빌드로 구버전을 별도 디렉토리에 설치하고, 런타임에 `sys.path.insert`로 import 우선순위를 분기해 해결했다. docker-compose로 버전별 서버를 붙여 CRUD와 버전 전용 API 차이까지 실제로 돌려 검증했다.

## ⚙️ 환경

- Python 3.11 (`uv` 기반 이미지)
- `weaviate-client` 4.15.0 / 4.19.2 두 버전 공존
- Weaviate 서버 1.26.1 / 1.34.0 (docker-compose로 각각 기동)

## 💬 이슈

같은 클라이언트 라이브러리의 두 버전을 <b>하나의 컨테이너 이미지</b>에서 환경변수로 골라 로드해야 하는 상황이 있었다. 구버전 서버와 신버전 서버를 둘 다 상대해야 하는데, 클라이언트 라이브러리는 그 사이에 호환 불가 변경(breaking change)이 있었다.

구체적으로 `weaviate-client`는 4.16을 기점으로 named vector 생성 API가 갈린다. 4.15는 `vectorizer_config=`에 `Configure.NamedVectors.none()`을 넘기는데, 4.19는 `vector_config=`에 `Configure.Vectors.self_provided()`를 넘긴다. 파라미터명도 클래스도 다르다. 한쪽 코드를 반대 버전에서 실행하면 그냥 깨진다.

보통은 이럴 때 컨테이너를 둘로 나누거나 가상환경을 따로 판다. 그게 정석이다. 다만 이번엔 "이미지는 하나로 두고 실행 시점에 버전을 고른다"가 가능한지가 궁금했다. `pip install`은 한 환경에 같은 패키지의 두 버전을 나란히 두지 못한다. 나중에 깐 게 앞엣걸 덮어쓴다. 그러면 하나의 `site-packages` 안에서 두 버전을 어떻게 공존시킬 것인가, 그리고 런타임에 어느 쪽을 로드할지 어떻게 결정할 것인가가 문제였다.

## 🧗 해결

핵심 아이디어는 두 개다. 하나는 <b>설치 위치를 물리적으로 분리</b>하는 것, 다른 하나는 <b>런타임에 `sys.path` 우선순위를 바꿔</b> import를 분기하는 것이다.

### 1. import 탐색 순서

Python은 `import weaviate`를 만나면 `sys.path`에 담긴 디렉토리를 <b>앞에서부터</b> 뒤져 처음 만난 패키지를 로드한다. 즉 같은 이름의 패키지가 두 경로에 있어도, `sys.path` 앞쪽에 있는 쪽이 이긴다. 여기에 기대면 된다. 기본 경로에 한 버전을 깔고, 다른 버전은 별도 디렉토리에 깐 뒤, 필요할 때만 그 디렉토리를 `sys.path` 맨 앞에 끼워 넣으면 로드되는 버전이 바뀐다.

### 2. multi-stage 빌드로 버전을 격리 설치

먼저 두 버전을 물리적으로 다른 경로에 심었다. builder 스테이지에서 구버전(4.15.0)을 `--target`으로 격리 디렉토리에 설치하고, runtime 스테이지에서 신버전(4.19.2)을 기본 경로에 설치한 뒤 격리 디렉토리만 복사해 왔다.

```dockerfile
# builder: 4.15.0 과 그 종속성만 별도 디렉토리(/app/libs_4_15)로 설치
FROM ghcr.io/astral-sh/uv:python3.11-bookworm-slim AS builder
WORKDIR /app
RUN uv pip install "weaviate-client==4.15.0" --target /app/libs_4_15 --system

# runtime: 신버전(4.19.2)은 기본 경로로 설치하고, 격리 디렉토리만 가져온다
FROM ghcr.io/astral-sh/uv:python3.11-bookworm-slim AS runtime
WORKDIR /app
RUN uv pip install "weaviate-client==4.19.2" --system
COPY --from=builder /app/libs_4_15 /app/libs_4_15
COPY main.py .
COPY my_app/ ./my_app/
CMD ["python", "main.py"]
```

`--target`은 패키지와 그 종속성을 지정한 디렉토리에 통째로 떨군다. 이렇게 하면 4.15.0 트리는 `/app/libs_4_15` 안에, 4.19.2 트리는 기본 `site-packages`에 각각 온전히 들어간다. 종속성까지 함께 격리되니 버전이 얽힐 여지가 없다. 구버전을 굳이 builder에서 만들어 복사한 건 최종 이미지에 빌드 흔적을 안 남기려는 습관인데, 여기선 사실 runtime에서 바로 `--target`으로 깔아도 결과는 같다.

### 3. 환경변수로 sys.path 분기

런타임에서는 `MODE` 환경변수를 읽어 로드할 버전을 정한다. 구버전을 쓸 때만 격리 디렉토리를 `sys.path` 맨 앞에 끼워 넣고, 그 <b>직후에</b> import를 트리거하는 게 요점이다.

```python
# main.py — MODE 에 따라 import 경로를 분기한다.
if mode == "4.15":
    sys.path.insert(0, "/app/libs_4_15")   # 격리 경로를 최우선으로
    from my_app.logic_old import run_task   # → /app/libs_4_15 의 4.15.0 로드
    run_task(url, grpc_port)

elif mode == "4.19":
    from my_app.logic_new import run_task    # → 기본 경로의 4.19.2 로드
    run_task(url, grpc_port)
```

`logic_old`/`logic_new`는 모듈 최상단에서 `import weaviate`를 한다. 그래서 이 모듈을 언제 import하느냐가 곧 어느 버전을 로드하느냐가 된다. `sys.path.insert(0, ...)`를 먼저 실행하고 나서 `logic_old`를 import하면, 그 안의 `import weaviate`가 격리 경로의 4.15.0을 먼저 만난다. `sys.path.insert`는 반드시 import 앞에 와야 한다. 순서가 뒤집히면 이미 기본 경로 버전이 로드된 뒤라 소용이 없다.

버전별 코드는 별도 모듈로 갈라뒀다. 억지로 한 파일에서 `if version` 분기를 치는 대신, 버전마다 파일을 나눠 각자 자기 버전 스타일로 쓰게 한 게 읽기에 낫다. named vector 생성만 봐도 이렇게 다르다.

```python
# logic_old.py (4.15) — 구 API
client.collections.create(
    name=NAMED_VEC_COLLECTION,
    vectorizer_config=[                          # 4.15 파라미터명
        Configure.NamedVectors.none(name="custom_vec"),
    ],
    properties=[Property(name="label", data_type=DataType.TEXT)],
)

# logic_new.py (4.19) — 신 API (4.16+)
client.collections.create(
    name=NAMED_VEC_COLLECTION,
    vector_config=[                              # 4.16+ 파라미터명
        Configure.Vectors.self_provided(name="custom_vec"),
    ],
    properties=[Property(name="label", data_type=DataType.TEXT)],
)
```

### 4. docker-compose로 버전별 서버 붙이기

검증하려면 클라이언트만 갈라선 안 되고, 각 버전이 붙을 서버도 있어야 했다. 같은 이미지를 두 번 띄우되 환경변수만 다르게 줘서, 각각 자기 버전에 맞는 Weaviate 서버를 상대하게 했다. 서버가 healthy가 될 때까지 기다렸다가 앱이 뜨도록 `depends_on`에 `condition: service_healthy`를 걸었다.

```yaml
services:
  weaviate-v1:      # Weaviate 서버 1.26.1
    image: semitechnologies/weaviate:1.26.1
    # ... healthcheck 로 ready 확인

  weaviate-v2:      # Weaviate 서버 1.34.0
    image: semitechnologies/weaviate:1.34.0
    # ... healthcheck 로 ready 확인

  python-app-v1:    # 같은 이미지, MODE 만 다르게
    build: .
    depends_on:
      weaviate-v1:
        condition: service_healthy
    environment:
      MODE: "4.15"
      WEAVIATE_URL: "http://weaviate-v1:8080"

  python-app-v2:
    build: .
    depends_on:
      weaviate-v2:
        condition: service_healthy
    environment:
      MODE: "4.19"
      WEAVIATE_URL: "http://weaviate-v2:8080"
```

## ✅ 확인

`docker compose up --build`로 두 앱을 동시에 띄웠다. 먼저 각 앱이 실제로 의도한 버전을 로드했는지부터 봤다. `weaviate.__version__`을 로그로 찍게 해뒀는데, `python-app-v1`은 `4.15.0`, `python-app-v2`는 `4.19.2`로 나왔다. 같은 이미지인데 환경변수만으로 로드된 버전이 갈렸다는 뜻이다.

그다음은 각자 자기 서버에 붙어 CRUD가 도는지였다. 컬렉션 생성 → batch 삽입 → 조회까지 두 버전 모두 정상이었다. 여기까지는 "경로 분기가 먹혔다"의 확인이다.

마지막으로 버전 간 API 차이를 실제로 찔러봤다. 각 버전에서 특정 API가 있는지/도는지를 직접 실행해 대조했다.

| 항목 | 4.15.0 | 4.19.2 |
|---|---|---|
| Named vector 파라미터명 | `vectorizer_config=` | `vector_config=` |
| Named vector 클래스 | `Configure.NamedVectors.none()` | `Configure.Vectors.self_provided()` |
| `Configure.Vectors` 클래스 존재 | ✗ | ✓ (4.16+) |
| `Filter.contains_none()` 메서드 존재 | ✗ | ✓ (4.17+) |
| `backups.list()` 메서드 존재 | ✗ | ✓ (4.16.8+) |

4.15에서는 `Configure.Vectors`가 아예 없고 named vector도 구 API로만 만들어지는데, 4.19에서는 신 API가 돌고 4.16 이후 추가된 메서드들도 붙어 있었다. 두 버전이 한 이미지 안에서 서로를 오염시키지 않고 각자 온전히 동작한다는 걸, 존재하는 API 목록의 차이로 확인한 셈이다.

정석대로면 버전마다 이미지를 나누는 게 맞고, 대부분은 그게 낫다. 다만 이렇게 `--target`으로 설치 위치를 나누고 `sys.path`로 로드 순서를 정하면, 하나의 이미지에서 두 버전을 골라 쓰는 것도 된다는 걸 눈으로 봤다. Python이 import를 어떻게 찾는지만 알면 우회로가 하나 더 생긴다.

## 🔗 참고

- [Python `sys.path`](https://docs.python.org/3/library/sys.html#sys.path)
- [uv pip install — Target directory](https://docs.astral.sh/uv/pip/packages/)
- [Docker multi-stage builds](https://docs.docker.com/build/building/multi-stage/)
- [weaviate-client (PyPI)](https://pypi.org/project/weaviate-client/)
