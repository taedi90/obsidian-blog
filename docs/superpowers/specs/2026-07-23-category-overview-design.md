# CategoryOverview 컴포넌트 설계

- 날짜: 2026-07-23
- 대상: Quartz 4 블로그 (`log.kimfra.com`, fork: `taedi90/obsidian-blog`)
- 목적: 방문자(채용담당자 등)가 랜딩에서 **전문성의 폭**(어떤 영역을, 얼마나 깊게 다뤘는지)을 10초 안에 파악하게 한다. 블로그를 이력서 레퍼런스로 활용.

## 배경 / 문제

- 글 186개가 깊게 중첩된 폴더에 분산. 사이드바 Explorer 트리로는 훑기 어렵다(긴 한글 제목).
- 현재 `Publish/index.md`는 **손으로 관리하는 카테고리 표**를 두고 있어 글이 늘면 낡는다.
- "최근 게시물"은 Obsidian Dataview Serializer 플러그인이 정적 표로 구워둔 것(수동 갱신).

핵심 통찰: 사이드바를 고치는 문제가 아니라 **랜딩을 포트폴리오형 개요로 만드는** 문제다.

## 목표 (이번 스코프)

`quartz/components/CategoryOverview.tsx` 커스텀 컴포넌트 1개를 만들어 index 페이지 상단에 렌더한다.

- 카테고리별 **발행 글 개수를 빌드 시 자동 집계** → 절대 낡지 않음.
- 카테고리별 **대표글(`featured: true`)을 최대 3개, 최신순**으로 카드에 노출 → 큐레이션한 깊이 증명.
- 카드 그리드(반응형 + 다크모드).

비목표(이번 스코프 밖):
- "최근 게시물" 표(dataview-serializer)는 그대로 둔다.
- 사이드바 Explorer 개선, Quartz v5 업그레이드, Astro 전환.

## 설계

### 1. 컴포넌트

`RecentNotes.tsx`와 동일한 `QuartzComponentConstructor` 패턴. `QuartzComponentProps`에서 `allFiles`, `fileData`, `cfg`, `displayClass`를 받는다.

- `allFiles`는 이미 draft가 제거된 발행 글 목록이다(`RemoveDrafts` 필터가 build에서 제외).
- 각 카테고리 config의 `folder` prefix로 `allFiles`를 필터해 개수를 센다.
- 카운트에서 제외: 폴더 노트(파일명이 상위 폴더명과 동일, 예 `DevOps/Container/Container`), `index`, 태그/폴더 자동 생성 페이지.

### 2. 카테고리 config (컴포넌트 상단 상수)

폴더 자동 나열이 아니라 명시적 배열로 **순서·이모지·설명**을 통제한다. 현재 `index.md` 표 내용을 재활용. 실제 폴더명 기준:

| folder | emoji | label | desc |
| --- | --- | --- | --- |
| `DevOps/K8s-Clustering-2025` | 🚀 | K8s Clustering (2025) | 사내 온프레미스 쿠버네티스 클러스터 도입기 |
| `DevOps/Kubernetes` | ☸️ | Kubernetes | 운영·트러블슈팅·네트워크·KubeVirt |
| `DevOps/CICD` | 🔀 | CICD | Jenkins·ArgoCD·GitOps·배포 자동화 |
| `DevOps/Database` | 🗄️ | Database | MariaDB/Galera·Redis·RabbitMQ·Elasticsearch·Weaviate |
| `DevOps/Infra` | 🏗️ | Infra | GPU·스토리지(NFS)·네트워크·서버 하드웨어 |
| `DevOps/Migration` | 📦 | Migration | 폐쇄망 이관·Helmfile·형상관리·SOPS |
| `DevOps/Container` | 🐳 | Container | 도커 컨테이너 기초 |
| `DevOps/Tooling` | 🧰 | Tooling | 자체 IaC 도구·AI 에이전트·지식관리 |
| `DevOps/Linux` | 🖥️ | Linux | 리눅스 |
| `DevOps/ETC` | ⚙️ | ETC | 미분류 |

- `Life`는 제외(전문성 랜딩).

### 3. 대표글 (featured)

- 글 frontmatter에 `featured: true`를 단 글만 대표글로 노출.
- 카테고리당 **최대 3개, 날짜(date) 내림차순** 정렬. 표시: 제목(내부 링크) + 작성일.
- `featured` 글이 없는 카테고리는 **대표글 줄 자체를 생략**(빈 자리 없이 개수·설명만 표시).
- 링크는 `resolveRelative(fileData.slug!, page.slug!)`로 생성(RecentNotes와 동일).

### 4. 배치

`quartz.layout.ts`의 `defaultContentPageLayout.beforeBody`에 `ConditionalRender`로 index에서만 렌더:

```ts
Component.ConditionalRender({
  component: Component.CategoryOverview(),
  condition: (page) => page.fileData.slug === "index",
})
```

`ArticleTitle`/`ContentMeta` 뒤, 본문(index.md 인사말) 위에 위치. (정확한 순서는 구현 시 시각 확인.)

### 5. `index.md` 정리

- 손으로 관리하던 **`## 📂 주요 카테고리` 표 제거**(컴포넌트가 대체).
- 인사말, `주요 관심분야` 콜아웃은 유지.
- `## 📝 최근 게시물`(dataview-serializer 표)은 유지.

### 6. 스타일

`quartz/styles/custom.scss`에 카드 그리드 추가.

- 반응형: 모바일 1열 / 태블릿 2열 / 데스크톱 2~3열 (CSS grid `auto-fit, minmax`).
- 다크모드: 기존 테마 변수(`--secondary`, `--tertiary`, `--lightgray`, `--light`, `--gray`) 재사용 — 하드코드 색상 금지.
- 카드: 이모지+label 헤더, 우측/하단에 글 개수 배지, 설명 한 줄, 대표글 목록(있을 때).

### 7. 컴포넌트 등록

`quartz/components/index.ts`에 `CategoryOverview` export 추가(기존 컴포넌트와 동일 방식).

## 파일 변경 요약

- 신규: `quartz/components/CategoryOverview.tsx`
- 신규(선택): `quartz/components/styles/categoryOverview.scss` 또는 `custom.scss`에 인라인
- 수정: `quartz/components/index.ts` (export)
- 수정: `quartz/quartz.layout.ts` (ConditionalRender 배치)
- 수정: `Publish/index.md` (카테고리 표 제거)
- 콘텐츠: 대표로 노출할 글에 `featured: true` frontmatter 추가(큐레이션, 점진적)

## 검증

- `npx quartz build --serve`로 로컬 렌더 확인: index에만 카드 표시, 개수 정확, featured 링크 이동, 다크모드, 모바일 폭.
- 다른 문서 페이지에는 카드가 안 나오는지 확인(ConditionalRender).

## 리스크 / 주의

- fork 저장소라 커스텀 컴포넌트는 향후 Quartz 업스트림 머지 시 수동 유지 대상.
- 폴더명에 특수문자가 있으면 slug prefix 매칭 주의(`K8s-Clustering-2025`는 이미 정리됨).
