import MarkdownIt from 'markdown-it'
import anchor from 'markdown-it-anchor'
import frontMatterPlugin from 'markdown-it-front-matter'
import { katex } from '@mdit/plugin-katex'
/**
 * 高亮**按需注册**,别 `import hljs from 'highlight.js'`。
 *
 * 主包会把 190+ 种语言全打进 bundle(实测 abnf、mathematica 这类都在里面),
 * 主 chunk 因此涨到 1.9MB —— Android WebView 冷启动光解析编译这坨就要几百毫秒,
 * 而文档里真正出现的语言不出这三十来种。
 * `lib/common` 是官方精选的 36 种(bash/java/json/sql/xml/yaml/python/rust…),自带类型;
 * 底下几个是写部署/运维文档常用、但没进 common 的,单独补上。
 */
import hljs from 'highlight.js/lib/common'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import groovy from 'highlight.js/lib/languages/groovy'
import http from 'highlight.js/lib/languages/http'
import nginx from 'highlight.js/lib/languages/nginx'
import powershell from 'highlight.js/lib/languages/powershell'
import properties from 'highlight.js/lib/languages/properties'
import { resolvePath } from '@/core/paths'

for (const [name, fn] of [
  ['dockerfile', dockerfile],
  ['groovy', groovy],
  ['http', http],
  ['nginx', nginx],
  ['powershell', powershell],
  ['properties', properties],
] as const) {
  hljs.registerLanguage(name, fn)
}

export interface TocItem {
  level: number
  title: string
  slug: string
}

export interface RenderResult {
  html: string
  toc: TocItem[]
  frontMatter: string | null
}

export interface RenderCtx {
  /** 当前文档所在目录(仓库内相对路径) */
  docDir: string
  /** 仓库内相对路径 → 可渲染 URL */
  assetUrl: (repoRelPath: string) => string
}

interface MdEnv extends RenderCtx {
  [key: string]: unknown
}

/** 中文友好 slug:保留汉字,去标点,空白转连字符 */
export function slugify(text: string): string {
  const s = text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[!"#$%&'()*+,./:;<=>?@[\]^`{|}~·。,、;:?!""''《》【】()—…]/g, '')
  return s || 'section'
}

let collectedToc: TocItem[] = []
let collectedFm: string | null = null

const md = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: false,
})

md.use(frontMatterPlugin, (fm: string) => {
  collectedFm = fm
})

md.use(anchor, {
  slugify,
  tabIndex: false,
  callback: (_token, info) => {
    collectedToc.push({ level: Number(_token.tag.slice(1)), title: info.title, slug: info.slug })
  },
})

md.use(katex)

const escapeHtml = md.utils.escapeHtml

/** 语法高亮成 html;语言不认识就纯转义 */
export function highlightCode(source: string, lang: string): string {
  const l = lang.toLowerCase()
  if (l && hljs.getLanguage(l)) return hljs.highlight(source, { language: l, ignoreIllegals: true }).value
  return escapeHtml(source)
}

/** json 家族:给这些代码块额外挂一个「格式化」按钮 */
function isJsonLang(lang: string): boolean {
  return lang === 'json' || lang === 'jsonc' || lang === 'json5' || lang === 'jsonl'
}

/** 代码块右上角的按钮组(json 多一个格式化) */
function codeActions(lang: string): string {
  const fmt = isJsonLang(lang)
    ? `<button class="code-copy code-fmt" type="button" title="展开成缩进格式(不改动数字精度)">格式化</button>`
    : ''
  return `<div class="code-acts">${fmt}<button class="code-copy" type="button">复制</button></div>`
}

// 代码块:mermaid 走占位容器,其余 highlight.js + 语言标签 + 按钮组
md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx]
  const lang = (token.info || '').trim().split(/\s+/)[0].toLowerCase()
  const code = token.content
  if (lang === 'mermaid') {
    return `<div class="mermaid-block"><pre class="mermaid-src">${escapeHtml(code)}</pre><div class="mermaid-target"></div></div>\n`
  }
  return (
    `<div class="code-block">` +
    `<div class="code-head"><span class="code-lang">${escapeHtml(lang || 'text')}</span>` +
    codeActions(lang) +
    `</div>` +
    `<pre class="code-pre" data-lang="${escapeHtml(lang)}"><code>${highlightCode(code, lang)}</code></pre></div>\n`
  )
}

// 仓库内相对图片 → assetUrl
const defaultImage =
  md.renderer.rules.image ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const ctx = env as unknown as MdEnv
  const token = tokens[idx]
  const src = String(token.attrGet('src') ?? '')
  if (src && !/^(https?:|data:|blob:|\/)/i.test(src) && typeof ctx.assetUrl === 'function') {
    const resolved = resolvePath(ctx.docDir ?? '', decodeURI(src))
    token.attrSet('src', ctx.assetUrl(resolved))
    token.attrSet('data-origin', src)
  }
  return defaultImage(tokens, idx, options, env, self)
}

// 表格包一层滚动容器(书卷模式下宽表格横向滚动)
md.renderer.rules.table_open = () => '<div class="table-wrap"><table>'
md.renderer.rules.table_close = () => '</table></div>'

/** 渲染 markdown → { html, toc, frontMatter } */
export function renderMarkdown(source: string, ctx: RenderCtx): RenderResult {
  collectedToc = []
  collectedFm = null
  const env: MdEnv = { ...ctx }
  const html = md.render(source, env as unknown as Parameters<typeof md.render>[1])
  return { html, toc: collectedToc, frontMatter: collectedFm }
}

/** 纯文本附件(sql/json/…)渲染为只读代码视图 */
export function renderPlainText(source: string, ext: string): string {
  return (
    `<div class="code-block code-block--file">` +
    `<div class="code-head"><span class="code-lang">${escapeHtml(ext || 'text')}</span>` +
    codeActions(ext.toLowerCase()) +
    `</div>` +
    `<pre class="code-pre" data-lang="${escapeHtml(ext)}"><code>${highlightCode(source, ext)}</code></pre></div>`
  )
}
