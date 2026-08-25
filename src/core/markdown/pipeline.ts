import MarkdownIt from 'markdown-it'
import anchor from 'markdown-it-anchor'
import frontMatterPlugin from 'markdown-it-front-matter'
import { katex } from '@mdit/plugin-katex'
import hljs from 'highlight.js'
import { resolvePath } from '@/core/paths'

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

// 代码块:mermaid 走占位容器,其余 highlight.js + 语言标签 + 复制按钮
md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx]
  const lang = (token.info || '').trim().split(/\s+/)[0].toLowerCase()
  const code = token.content
  if (lang === 'mermaid') {
    return `<div class="mermaid-block"><pre class="mermaid-src">${escapeHtml(code)}</pre><div class="mermaid-target"></div></div>\n`
  }
  let body: string
  if (lang && hljs.getLanguage(lang)) {
    body = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
  } else {
    body = escapeHtml(code)
  }
  return (
    `<div class="code-block">` +
    `<div class="code-head"><span class="code-lang">${escapeHtml(lang || 'text')}</span>` +
    `<button class="code-copy" type="button">复制</button></div>` +
    `<pre class="code-pre"><code>${body}</code></pre></div>\n`
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
  let body: string
  if (ext && hljs.getLanguage(ext)) {
    body = hljs.highlight(source, { language: ext, ignoreIllegals: true }).value
  } else {
    body = escapeHtml(source)
  }
  return (
    `<div class="code-block code-block--file">` +
    `<div class="code-head"><span class="code-lang">${escapeHtml(ext || 'text')}</span>` +
    `<button class="code-copy" type="button">复制</button></div>` +
    `<pre class="code-pre"><code>${body}</code></pre></div>`
  )
}
