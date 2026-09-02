/**
 * 独立 HTML 文档的阅读渲染。
 *
 * 之前 `.html` 只能当代码看(走 renderPlainText 显示源码)。现在消毒后直接渲染。
 *
 * **两种模式,按文档自己有没有样式来选**(2026-09-02 用户反馈后改):
 *
 * - **原样模式**(文档带 `<style>`):保留它的 CSS,只把选择器套上作用域前缀,
 *   不套墨阅的正文排版。那些卡片、网格、配色本身就是内容 —— 一份排好版的
 *   「口肌操卡」剥掉 CSS 就只剩一串文本流,和用浏览器打开完全两样。
 *   代价是排版四旋钮对它无效(它有自己的设计,本就不该被覆盖)。
 * - **阅读模式**(裸 HTML,只有语义标签):套 `.prose`,与 markdown 一个待遇 ——
 *   这种文档没有自己的视觉主张,交给墨阅排版更好读。
 *
 * 两种模式下都会:剥 script / 事件属性 / `javascript:` 链接,把相对图片改写成
 * 可取的 URL,给标题补 id 收进大纲。链接原样保留,由阅读视图接管跳转。
 */

import { sanitizeChapterHtml } from '@/core/ebook'
import { slugify, type TocItem } from '@/core/markdown/pipeline'
import { resolvePath } from '@/core/paths'

/** 原样模式下给文档 CSS 套的作用域 class */
export const HTML_DOC_SCOPE = 'ink-html'

export interface HtmlDocResult {
  html: string
  toc: TocItem[]
  /** 文档自带样式 → 走原样模式(不套 .prose,排版旋钮不生效) */
  styled: boolean
}

export interface HtmlDocCtx {
  /** 当前文档所在目录(仓库内相对路径) */
  docDir: string
  /** 仓库内相对路径 → 可渲染 URL */
  assetUrl: (repoRelPath: string) => string
}

/**
 * 把文档 CSS 限制在作用域容器内,别泄出去改到应用自己的界面。
 *
 * 用 CSSOM 解析而不是正则改写:逗号分隔的选择器组、`@media` 嵌套、伪元素
 * 这些正则很容易弄错,而浏览器手上本来就有一个正确的解析器。
 */
function scopeCss(cssText: string, scope: string): string {
  const probe = document.createElement('style')
  // media 设成不匹配任何设备:挂进 document 只为借解析器,别让它真的生效
  probe.media = 'not all'
  probe.textContent = cssText
  document.head.appendChild(probe)
  const sheet = probe.sheet
  let out = ''
  try {
    out = sheet ? serializeRules(sheet.cssRules, scope) : ''
  } catch {
    out = ''
  } finally {
    probe.remove()
  }
  return out
}

function scopeSelector(selector: string, scope: string): string {
  return selector
    .split(',')
    .map((one) => {
      const sel = one.trim()
      if (!sel) return ''
      // 文档的 body/html/:root 规则实际针对的是整篇内容,落到作用域容器自己身上
      if (/^(html|body|:root)$/i.test(sel)) return `.${scope}`
      if (/^(html|body)\s+/i.test(sel)) return `.${scope} ${sel.replace(/^(html|body)\s+/i, '')}`
      return `.${scope} ${sel}`
    })
    .filter(Boolean)
    .join(', ')
}

function serializeRules(rules: CSSRuleList, scope: string): string {
  let out = ''
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) {
      out += `${scopeSelector(rule.selectorText, scope)}{${rule.style.cssText}}\n`
    } else if (rule instanceof CSSMediaRule) {
      out += `@media ${rule.conditionText}{${serializeRules(rule.cssRules, scope)}}\n`
    } else if (rule instanceof CSSSupportsRule) {
      out += `@supports ${rule.conditionText}{${serializeRules(rule.cssRules, scope)}}\n`
    } else if (rule instanceof CSSKeyframesRule || rule instanceof CSSFontFaceRule) {
      // 动画与字体声明不吃选择器,原样带过去
      out += `${rule.cssText}\n`
    }
    // @import 一律丢弃:不给文档拉外部样式表的机会
  }
  return out
}

export function renderHtmlDoc(raw: string, ctx: HtmlDocCtx): HtmlDocResult {
  const toc: TocItem[] = []
  const used = new Set<string>()
  const cssParts: string[] = []

  const assetUrl = (src: string): string => {
    let rel = src
    try {
      rel = decodeURI(src)
    } catch {
      /* 半截转义,原样用 */
    }
    // 绝对路径(/x.png)在文库语义下没有意义,当仓库根处理
    return ctx.assetUrl(resolvePath(ctx.docDir, rel.replace(/^\/+/, '')))
  }

  const collectToc = (body: HTMLElement): void => {
    for (const h of Array.from(body.querySelectorAll('h1, h2, h3, h4, h5, h6'))) {
      const title = (h.textContent ?? '').trim()
      if (!title) continue
      let slug = h.getAttribute('id') ?? slugify(title)
      // 同名标题在一篇里重复很常见,补序号保证 slug 唯一,大纲才跳得准
      if (used.has(slug)) {
        let n = 2
        while (used.has(`${slug}-${n}`)) n++
        slug = `${slug}-${n}`
      }
      used.add(slug)
      h.setAttribute('id', slug)
      toc.push({ level: Number(h.tagName.slice(1)), title, slug })
    }
  }

  // 第一遍:先看文档有没有自带样式(决定走哪种模式)
  const probe = sanitizeChapterHtml(raw, {
    assetUrl,
    collectStyles: (css) => cssParts.push(css),
    keepInlineStyle: true,
    onBody: collectToc,
  })
  const rawCss = cssParts.join('\n').trim()
  const inlineStyled = /\sstyle=/i.test(probe.html)
  const styled = !!rawCss || inlineStyled

  if (!styled) {
    // 裸 HTML:与 markdown 一个待遇,交给 .prose 排版
    return { html: probe.html, toc, styled: false }
  }

  const scoped = rawCss ? scopeCss(rawCss, HTML_DOC_SCOPE) : ''
  // 样式随内容一起塞进容器:innerHTML 插入的 <style> 是会生效的,
  // 这样换文档时样式跟着内容一起被替换掉,不用单独管理生命周期
  const html = scoped ? `<style>${scoped}</style>${probe.html}` : probe.html
  return { html, toc, styled: true }
}
