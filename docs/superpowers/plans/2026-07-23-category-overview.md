# CategoryOverview 컴포넌트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quartz 4 랜딩(index)에 카테고리별 글 개수를 자동 집계하고 큐레이션한 대표글(`featured: true`)을 보여주는 `CategoryOverview` 커스텀 컴포넌트를 추가한다.

**Architecture:** `RecentNotes.tsx`와 동일한 `QuartzComponentConstructor` 패턴의 preact 컴포넌트. 빌드 시 `allFiles`(발행 글, draft 제외됨)를 받아 카테고리 config의 folder prefix로 개수를 세고 `featured` 글을 뽑아 카드 그리드로 렌더. `ConditionalRender`로 index 페이지에만 배치.

**Tech Stack:** Quartz 4.5.0, preact/JSX(TSX), SCSS, esbuild(Quartz 내장 빌드).

## Global Constraints

- Quartz 버전: 4.5.0 (fork `taedi90/obsidian-blog`). 업스트림 컴포넌트 파일은 수정하지 말고 신규 파일 위주.
- Node: 20+ (`.node-version` = v20.9.0).
- 색상은 하드코드 금지 — 반드시 테마 변수(`--light`, `--lightgray`, `--gray`, `--darkgray`, `--dark`, `--secondary`, `--tertiary`) 사용. 다크모드 자동 대응.
- 카테고리당 대표글 최대 3개, 날짜 내림차순.
- `Life` 카테고리 제외.
- 커밋 대상 저장소가 둘로 나뉜다:
  - `.quartz/` 하위(컴포넌트·scss·layout·index.ts) → fork 저장소(`taedi90/obsidian-blog`).
  - `Publish/` 하위(index.md, featured frontmatter) → vault 저장소(main).
- **커밋은 사용자 확인 후 실행**(이 세션 기본 규칙). 계획엔 명시하되 무단 커밋하지 않는다.
- 작업 디렉토리 기준: 빌드 명령은 `/Users/taesoo/note/.quartz`에서 실행. `content`는 `../Publish` 심링크라 별도 sync 없이 빌드된다.

---

## File Structure

- Create: `quartz/components/CategoryOverview.tsx` — 카테고리 config + 집계/featured 로직 + 렌더.
- Create: `quartz/components/styles/categoryOverview.scss` — 카드 그리드 스타일.
- Modify: `quartz/components/index.ts` — `CategoryOverview` export 추가.
- Modify: `quartz/quartz.layout.ts` — `defaultContentPageLayout.beforeBody`에 ConditionalRender 배치.
- Modify: `Publish/index.md` — 손관리 카테고리 표 제거.
- Content: 대표 노출할 글에 `featured: true` frontmatter 추가.

**검증 방식 참고:** Quartz 프로젝트엔 컴포넌트 단위 테스트 러너가 없다. 각 태스크의 "테스트"는 `npx quartz build`(성공 여부) + 생성된 `public/index.html` grep(마크업 존재/개수 확인) + 필요 시 `--serve` 육안 확인이다. 이 프로젝트의 실제 피드백 루프가 그것이므로 가짜 unit test를 만들지 않는다.

---

### Task 1: CategoryOverview 컴포넌트 + 스타일 + 등록 + 배치

**Files:**
- Create: `quartz/components/CategoryOverview.tsx`
- Create: `quartz/components/styles/categoryOverview.scss`
- Modify: `quartz/components/index.ts`
- Modify: `quartz/quartz.layout.ts`

**Interfaces:**
- Consumes: `QuartzComponentProps`(`allFiles`, `fileData`, `cfg`, `displayClass`), `resolveRelative`, `getDate`, `Date`, `classNames`.
- Produces: `Component.CategoryOverview()` — 인자 없는 `QuartzComponentConstructor`. index 페이지 `beforeBody`에서 렌더.

- [ ] **Step 1: 컴포넌트 파일 작성** — `quartz/components/CategoryOverview.tsx`

```tsx
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { resolveRelative } from "../util/path"
import { QuartzPluginData } from "../plugins/vfile"
import { Date, getDate } from "./Date"
import { classNames } from "../util/lang"
import style from "./styles/categoryOverview.scss"

type Category = {
  folder: string
  emoji: string
  label: string
  desc: string
}

const CATEGORIES: Category[] = [
  { folder: "DevOps/K8s-Clustering-2025", emoji: "🚀", label: "K8s Clustering (2025)", desc: "사내 온프레미스 쿠버네티스 클러스터 도입기" },
  { folder: "DevOps/Kubernetes", emoji: "☸️", label: "Kubernetes", desc: "운영·트러블슈팅·네트워크·KubeVirt" },
  { folder: "DevOps/CICD", emoji: "🔀", label: "CICD", desc: "Jenkins·ArgoCD·GitOps·배포 자동화" },
  { folder: "DevOps/Database", emoji: "🗄️", label: "Database", desc: "MariaDB/Galera·Redis·RabbitMQ·Elasticsearch·Weaviate" },
  { folder: "DevOps/Infra", emoji: "🏗️", label: "Infra", desc: "GPU·스토리지(NFS)·네트워크·서버 하드웨어" },
  { folder: "DevOps/Migration", emoji: "📦", label: "Migration", desc: "폐쇄망 이관·Helmfile·형상관리·SOPS" },
  { folder: "DevOps/Container", emoji: "🐳", label: "Container", desc: "도커 컨테이너 기초" },
  { folder: "DevOps/Tooling", emoji: "🧰", label: "Tooling", desc: "자체 IaC 도구·AI 에이전트·지식관리" },
  { folder: "DevOps/Linux", emoji: "🖥️", label: "Linux", desc: "리눅스" },
  { folder: "DevOps/ETC", emoji: "⚙️", label: "ETC", desc: "미분류" },
]

const FEATURED_LIMIT = 3

// 폴더 노트(폴더명과 동일한 파일) 및 index 는 글 개수에서 제외
function isFolderNote(slug: string): boolean {
  const parts = slug.split("/")
  if (parts.length < 2) return false
  const last = parts[parts.length - 1]
  const parent = parts[parts.length - 2]
  return last === parent || last === "index"
}

function articlesIn(allFiles: QuartzPluginData[], folder: string): QuartzPluginData[] {
  const prefix = folder + "/"
  return allFiles.filter((f) => {
    const slug = f.slug ?? ""
    return slug.startsWith(prefix) && !isFolderNote(slug)
  })
}

export default (() => {
  const CategoryOverview: QuartzComponent = ({
    allFiles,
    fileData,
    displayClass,
    cfg,
  }: QuartzComponentProps) => {
    return (
      <div class={classNames(displayClass, "category-overview")}>
        <ul class="category-grid">
          {CATEGORIES.map((cat) => {
            const articles = articlesIn(allFiles, cat.folder)
            const featured = articles
              .filter((f) => f.frontmatter?.featured === true)
              .sort(
                (a, b) => (getDate(cfg, b)?.getTime() ?? 0) - (getDate(cfg, a)?.getTime() ?? 0),
              )
              .slice(0, FEATURED_LIMIT)

            return (
              <li class="category-card">
                <div class="category-head">
                  <span class="category-title">
                    {cat.emoji} {cat.label}
                  </span>
                  <span class="category-count">{articles.length}편</span>
                </div>
                <p class="category-desc">{cat.desc}</p>
                {featured.length > 0 && (
                  <ul class="category-featured">
                    {featured.map((page) => (
                      <li>
                        <a
                          href={resolveRelative(fileData.slug!, page.slug!)}
                          class="internal"
                        >
                          {page.frontmatter?.title}
                        </a>
                        {page.dates && (
                          <span class="featured-date">
                            <Date date={getDate(cfg, page)!} locale={cfg.locale} />
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    )
  }

  CategoryOverview.css = style
  return CategoryOverview
}) satisfies QuartzComponentConstructor
```

- [ ] **Step 2: 스타일 파일 작성** — `quartz/components/styles/categoryOverview.scss`

```scss
.category-overview {
  margin: 1rem 0 2rem;

  & > .category-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 1rem;
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .category-card {
    border: 1px solid var(--lightgray);
    border-radius: 8px;
    padding: 1rem;
    background: var(--light);
    transition:
      border-color 0.2s ease,
      transform 0.2s ease;

    &:hover {
      border-color: var(--secondary);
      transform: translateY(-2px);
    }
  }

  .category-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .category-title {
    font-weight: 600;
    color: var(--dark);
  }

  .category-count {
    font-size: 0.8rem;
    color: var(--gray);
    white-space: nowrap;
  }

  .category-desc {
    margin: 0.4rem 0 0.6rem;
    font-size: 0.85rem;
    color: var(--darkgray);
  }

  .category-featured {
    list-style: none;
    padding: 0.5rem 0 0;
    margin: 0;
    border-top: 1px solid var(--lightgray);

    & > li {
      display: flex;
      justify-content: space-between;
      gap: 0.5rem;
      font-size: 0.85rem;
      margin: 0.25rem 0;
    }

    & .featured-date {
      color: var(--gray);
      white-space: nowrap;
      font-size: 0.75rem;
    }
  }
}
```

- [ ] **Step 3: 컴포넌트 등록** — `quartz/components/index.ts`

기존 import 블록(예: `import RecentNotes from "./RecentNotes"` 근처)에 추가:

```ts
import CategoryOverview from "./CategoryOverview"
```

`export { ... }` 목록에 `CategoryOverview,` 추가(알파벳/기존 스타일에 맞춰, 예 `RecentNotes,` 근처).

- [ ] **Step 4: 레이아웃 배치** — `quartz/quartz.layout.ts`

`defaultContentPageLayout.beforeBody` 배열에서 `Component.ArticleTitle()` **다음, `Component.ContentMeta()` 앞**에 index 전용 렌더를 추가:

```ts
  beforeBody: [
    Component.ConditionalRender({
      component: Component.Breadcrumbs(),
      condition: (page) => page.fileData.slug !== "index",
    }),
    Component.ArticleTitle(),
    Component.ConditionalRender({
      component: Component.CategoryOverview(),
      condition: (page) => page.fileData.slug === "index",
    }),
    Component.ContentMeta(),
    Component.TagList(),
  ],
```

- [ ] **Step 5: 빌드 검증**

Run: `cd /Users/taesoo/note/.quartz && npx quartz build`
Expected: 에러 없이 완료(`Emitted ... files`). 실패 시 TSX 문법/import 경로부터 확인.

- [ ] **Step 6: 렌더 마크업 확인**

Run: `grep -c 'category-card' /Users/taesoo/note/.quartz/public/index.html`
Expected: `10` (카테고리 10개).

Run: `grep -o '[0-9]*편' /Users/taesoo/note/.quartz/public/index.html | head`
Expected: 각 카테고리 글 개수(예 `12편`)가 출력됨. 개수가 0으로만 나오면 folder prefix/slug 매칭을 점검(대소문자, `K8s-Clustering-2025`).

- [ ] **Step 7: 육안 확인(선택)**

Run: `cd /Users/taesoo/note/.quartz && npx quartz build --serve` 후 브라우저에서 `http://localhost:8080/` 접속.
확인: index에만 카드 그리드 표시 / 다른 글 페이지엔 없음 / 다크모드 토글 / 모바일 폭 1열.

- [ ] **Step 8: 커밋(사용자 확인 후)**

```bash
cd /Users/taesoo/note/.quartz
git add quartz/components/CategoryOverview.tsx quartz/components/styles/categoryOverview.scss quartz/components/index.ts quartz.layout.ts
git commit -m "feat: add CategoryOverview component for landing page"
```

---

### Task 2: index.md 손관리 카테고리 표 제거

**Files:**
- Modify: `Publish/index.md`

**Interfaces:**
- Consumes: Task 1의 CategoryOverview(카테고리 개요를 대체 제공).
- Produces: 중복 없는 랜딩 본문.

- [ ] **Step 1: 카테고리 표 섹션 삭제**

`Publish/index.md`에서 아래 블록 전체를 제거:
- `## 📂 주요 카테고리` 헤더
- 그 아래 마크다운 표(`| 🏷️ 카테고리 | 📝 설명 |` ~ `| ⚙️ ETC ... |`)
- 표 앞뒤의 잉여 `---` 구분선 하나(문맥상 자연스럽게)

유지할 것: 상단 인사말, `> 💡 주요 관심분야` 콜아웃, `## 📝 최근 게시물`(dataview-serializer 표), 하단 피드백 콜아웃.

- [ ] **Step 2: 빌드 후 중복 확인**

Run: `cd /Users/taesoo/note/.quartz && npx quartz build && grep -c '주요 카테고리' public/index.html`
Expected: `0` (수동 표 사라짐). 카드 그리드(`category-card`)는 여전히 `10`.

- [ ] **Step 3: 커밋(사용자 확인 후)**

```bash
cd /Users/taesoo/note && git add Publish/index.md
git commit -m "docs: replace manual category table with CategoryOverview component"
```

---

### Task 3: 대표글 featured frontmatter 큐레이션(1차)

**Files:**
- Content: `Publish/DevOps/**/*.md` 중 대표로 노출할 글

**Interfaces:**
- Consumes: Task 1의 `featured: true` 인식 로직.
- Produces: 각 카테고리 카드에 대표글 노출.

- [ ] **Step 1: 카테고리별 대표 후보 확인**

Run: `cd /Users/taesoo/note/Publish && for d in DevOps/K8s-Clustering-2025 DevOps/Kubernetes DevOps/CICD DevOps/Database DevOps/Infra DevOps/Migration DevOps/Container DevOps/Tooling DevOps/Linux DevOps/ETC; do echo "== $d =="; ls "$d"/*.md 2>/dev/null | head; done`
사용자와 함께 카테고리당 1~3편의 대표글을 고른다(최고작 기준).

- [ ] **Step 2: 선택 글 frontmatter에 `featured: true` 추가**

각 대표글 상단 frontmatter에 한 줄 추가(예):

```yaml
---
title: ...
date: 2025-07-10
draft: false
featured: true
tags:
  - ...
---
```

- [ ] **Step 3: 빌드 후 노출 확인**

Run: `cd /Users/taesoo/note/.quartz && npx quartz build && grep -c 'category-featured' public/index.html`
Expected: featured를 단 카테고리 수만큼(>=1) 출력. 0이면 `featured: true` YAML 위치/철자 확인.

- [ ] **Step 4: 커밋(사용자 확인 후)**

```bash
cd /Users/taesoo/note && git add Publish
git commit -m "docs: mark featured articles for landing highlights"
```

---

## Self-Review

**1. Spec coverage:**
- 카테고리별 개수 자동 집계 → Task 1 `articlesIn` + 렌더. ✅
- featured 대표글 최대 3개 최신순 → Task 1 정렬/slice + Task 3 큐레이션. ✅
- featured 없으면 대표글 줄 생략 → Task 1 `featured.length > 0` 조건. ✅
- index 전용 렌더 → Task 1 Step 4 ConditionalRender. ✅
- Life 제외 → CATEGORIES에 미포함. ✅
- 손관리 표 제거 → Task 2. ✅
- 최근 게시물 표 유지 → Task 2에서 보존 명시. ✅
- 다크모드/반응형/테마 변수 → Task 1 Step 2 scss. ✅

**2. Placeholder scan:** TBD/TODO/"적절히 처리" 없음. 모든 코드 스텝에 실제 코드 포함. ✅

**3. Type consistency:** `articlesIn`, `isFolderNote`, `CATEGORIES`, `FEATURED_LIMIT` 이름이 Task 1 내에서 일관. `Component.CategoryOverview()`는 index.ts export명(`CategoryOverview`)과 일치. ✅
