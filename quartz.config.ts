import { QuartzConfig } from "./quartz/cfg"
import * as Plugin from "./quartz/plugins"

/**
 * Quartz 4 Configuration
 *
 * See https://quartz.jzhao.xyz/configuration for more information.
 */
const config: QuartzConfig = {
  configuration: {
    pageTitle: "🛖",
    enableSPA: true,
    enablePopovers: true,
    analytics: {
      provider: "plausible",
    },
    locale: "ko-KR",
    baseUrl: "log.kimfra.com",
    ignorePatterns: ["private", "templates", ".obsidian"],
    defaultDateType: "created",
    theme: {
      fontOrigin: "googleFonts",
      cdnCaching: true,
      typography: {
        header: "Nanum Gothic",
        body: "Nanum Gothic",
        code: "Nanum Gothic Coding",
      },
      colors: {
        // Catppuccin Latte (AnuPpuccin 라이트) + Lavender 강조
        lightMode: {
          light: "#eff1f5", // base
          lightgray: "#ccd0da", // surface0
          gray: "#9ca0b0", // overlay0
          darkgray: "#5c5f77", // subtext1 (본문)
          dark: "#4c4f69", // text (제목)
          secondary: "#7287fd", // lavender (링크/강조)
          tertiary: "#8839ef", // mauve (hover)
          highlight: "rgba(114, 135, 253, 0.15)", // lavender tint
          textHighlight: "#df8e1d55", // yellow
        },
        // Catppuccin Mocha (AnuPpuccin 다크) + Lavender 강조
        darkMode: {
          light: "#1e1e2e", // base
          lightgray: "#313244", // surface0
          gray: "#6c7086", // overlay0
          darkgray: "#bac2de", // subtext1 (본문)
          dark: "#cdd6f4", // text (제목)
          secondary: "#b4befe", // lavender (링크/강조)
          tertiary: "#cba6f7", // mauve (hover)
          highlight: "rgba(180, 190, 254, 0.15)", // lavender tint
          textHighlight: "#f9e2af44",

          // origin
          // light: "#161618",
          // lightgray: "#393639",
          // gray: "#646464",
          // darkgray: "#d4d4d4",
          // dark: "#ebebec",
          // secondary: "#7b97aa",
          // tertiary: "#84a59d",
          // highlight: "rgba(143, 159, 169, 0.15)",
          // textHighlight: "#b3aa0288",
        },
      },
    },
  },
  plugins: {
    transformers: [
      Plugin.FrontMatter(),
      Plugin.CreatedModifiedDate({
        priority: ["frontmatter", "git", "filesystem"],
      }),
      Plugin.SyntaxHighlighting({
        theme: {
          light: "github-light",
          dark: "github-dark",
        },
        keepBackground: false,
      }),
      Plugin.ObsidianFlavoredMarkdown({ enableInHtmlEmbed: false }),
      Plugin.GitHubFlavoredMarkdown(),
      Plugin.TableOfContents(),
      Plugin.CrawlLinks({ markdownLinkResolution: "shortest" }),
      Plugin.Description(),
      Plugin.Latex({ renderEngine: "katex" }),
    ],
    filters: [Plugin.RemoveDrafts()],
    emitters: [
      Plugin.AliasRedirects(),
      Plugin.ComponentResources(),
      Plugin.ContentPage(),
      Plugin.FolderPage(),
      Plugin.TagPage(),
      Plugin.ContentIndex({
        enableSiteMap: true,
        enableRSS: true,
      }),
      Plugin.Assets(),
      Plugin.Static(),
      Plugin.Favicon(),
      Plugin.NotFoundPage(),
      // Comment out CustomOgImages to speed up build time
      Plugin.CustomOgImages(),
    ],
  },
}

export default config
