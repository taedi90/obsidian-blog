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
  { folder: "DevOps/Kubernetes", emoji: "☸️", label: "Kubernetes", desc: "운영·트러블슈팅·네트워크·KubeVirt" },
  { folder: "DevOps/CICD", emoji: "🔀", label: "CICD", desc: "Jenkins·ArgoCD·GitOps·배포 자동화" },
  { folder: "DevOps/Database", emoji: "🗄️", label: "Database", desc: "MariaDB/Galera·Redis·RabbitMQ·Elasticsearch·Weaviate" },
  { folder: "DevOps/Infra", emoji: "🏗️", label: "Infra", desc: "GPU·스토리지(NFS)·네트워크·서버 하드웨어" },
  { folder: "DevOps/Migration", emoji: "📦", label: "Migration", desc: "폐쇄망 이관·Helmfile·형상관리·SOPS" },
  { folder: "DevOps/Container", emoji: "🐳", label: "Container", desc: "도커 컨테이너 기초" },
  { folder: "DevOps/Tooling", emoji: "🧰", label: "Tooling", desc: "자체 IaC 도구·AI 에이전트·지식관리" },
  { folder: "DevOps/K8s-Clustering-2025", emoji: "🚀", label: "K8s Clustering (2025)", desc: "사내 온프레미스 쿠버네티스 클러스터 도입기" },
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
