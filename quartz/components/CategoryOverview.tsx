import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { FullSlug, joinSegments, resolveRelative } from "../util/path"
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
  { folder: "Study", emoji: "📚", label: "Study", desc: "Go/Java·Cobra·Docusaurus·goreleaser·GitHub Actions·Terraform·취약점·AI 파이프라인·OpenBao·Istio" },
  { folder: "Kubernetes", emoji: "☸️", label: "Kubernetes", desc: "운영·트러블슈팅·네트워크·KubeVirt" },
  { folder: "CICD", emoji: "🔀", label: "CICD", desc: "Jenkins·ArgoCD·GitOps·배포 자동화" },
  { folder: "Database", emoji: "🗄️", label: "Database", desc: "MariaDB/Galera·Redis·RabbitMQ·Elasticsearch·Weaviate" },
  { folder: "Infra", emoji: "🏗️", label: "Infra", desc: "GPU·스토리지(NFS)·네트워크·서버 하드웨어" },
  { folder: "Migration", emoji: "📦", label: "Migration", desc: "폐쇄망 이관·Helmfile·형상관리·SOPS" },
  { folder: "Container", emoji: "🐳", label: "Container", desc: "도커 컨테이너 기초" },
  { folder: "Tooling", emoji: "🧰", label: "Tooling", desc: "자체 IaC 도구·AI 에이전트·지식관리" },
  { folder: "K8s-Clustering-2025", emoji: "🚀", label: "K8s Clustering (2025)", desc: "사내 온프레미스 쿠버네티스 클러스터 도입기" },
  { folder: "Linux", emoji: "🖥️", label: "Linux", desc: "리눅스" },
  { folder: "ETC", emoji: "⚙️", label: "ETC", desc: "미분류" },
]

// 카드마다 노출할 글 최대 개수. featured(상단 고정) + 최신 글로 채운다.
const LIST_LIMIT = 10

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
            const byDateDesc = (a: QuartzPluginData, b: QuartzPluginData) =>
              (getDate(cfg, b)?.getTime() ?? 0) - (getDate(cfg, a)?.getTime() ?? 0)
            // featured 를 날짜순으로 위에 고정하고, 나머지는 최신순으로 채워 최대 LIST_LIMIT 개.
            const featured = articles
              .filter((f) => f.frontmatter?.featured === true)
              .sort(byDateDesc)
            const rest = articles
              .filter((f) => f.frontmatter?.featured !== true)
              .sort(byDateDesc)
            const shown = [...featured, ...rest].slice(0, LIST_LIMIT)
            const featuredSlugs = new Set(featured.map((f) => f.slug))

            const folderHref = resolveRelative(
              fileData.slug!,
              joinSegments(cat.folder, "index") as FullSlug,
            )

            return (
              <li class="category-card">
                <span class="category-count">{articles.length}편</span>
                <a class="category-link" href={folderHref}>
                  <span class="category-title">
                    {cat.emoji} {cat.label}
                  </span>
                </a>
                <p class="category-desc">{cat.desc}</p>
                {shown.length > 0 && (
                  <ul class="category-featured">
                    {shown.map((page) => (
                      <li class={featuredSlugs.has(page.slug) ? "featured" : undefined}>
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
