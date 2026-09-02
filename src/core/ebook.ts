/**
 * 电子书的统一模型 + 共用的章节消毒。
 *
 * EPUB 与 MOBI 的差别其实只在**怎么把一章的 HTML 取出来**:前者是 zip 里的 XHTML 文件,
 * 后者是一整条文本流里的一段字节。取出来之后要做的事一模一样 —— 剥脚本、剥书自带的 CSS、
 * 把书内图片和链接改写成受控形式。所以那部分放在这里共用:
 * 消毒逻辑是安全相关的,存两份将来一定会不同步。
 */

export interface EbookChapter {
  /** 章节标识。EPUB 是 zip 内路径,MOBI 是文本流里的字节偏移 */
  id: string
  /** 章节名;取不到就留空,视图会退回用正文里的第一个标题 */
  title: string
}

export interface EbookTocItem {
  /** 1 起的层级,直接喂给 TocPanel */
  level: number
  title: string
  /** 目标章节 id;空串 = 纯分组标题(第几卷之类),点了不跳 */
  chapterId: string
  /** 章内锚点(EPUB 的元素 id / name);MOBI 用不到 */
  anchor: string
}

export interface EbookRender {
  html: string
  /** 该章第一个标题的文字,没有目录时用来兜底显示 */
  heading: string
}

/** 视图只依赖这套接口,不关心底下是 epub 还是 mobi */
export interface Ebook {
  title: string
  creator: string
  /** 阅读顺序 */
  chapters: EbookChapter[]
  toc: EbookTocItem[]
  renderChapter(id: string): EbookRender
  /**
   * 某章的纯文本,只给全书查找用。
   *
   * 不走 `renderChapter` 是因为那要建 DOM、改写图片链接、跑消毒 —— 一本 2469 章的书
   * 全渲一遍要十几秒。这里只解压 + 粗暴剥标签,单章不到 1ms。
   * 代价是标签属性里的字也会被搜到(偶有误报),对"这个词出现在哪章"够用了。
   */
  chapterText(id: string): string
  /** 释放当前章的图片 blob(换章时调) */
  releaseAssets(): void
  /** 关书 */
  dispose(): void
}

export interface SanitizeHooks {
  /** 书内资源引用 → 可用 URL;返回空串表示取不到,该元素会被删掉 */
  assetUrl(ref: string): string
  /**
   * 书内链接 → 目标章节;返回 null 表示这条链接没法解析(会去掉 href)。
   * **不传则保留原始 href**,交给调用方自己的点击逻辑处理 ——
   * 独立 HTML 文档就走这条路(仓库内相对链接由阅读视图接管跳转)。
   */
  resolveLink?: (href: string) => { chapterId: string; anchor: string } | null
  /** 消毒完、序列化之前的最后一手(HTML 文档用它给标题补 id、收集大纲) */
  onBody?: (body: HTMLElement) => void
  /**
   * 收到文档自带的 CSS(`<style>` 里的内容)。
   *
   * 电子书**不传**这个:书里的 `font-size:12pt; color:#000` 会把排版旋钮全压过去,
   * 而"排版归读者"是墨阅的主张。独立 HTML 文档相反 —— 那些卡片、网格、配色
   * 本身就是内容,剥掉就只剩一堆文本(2026-09-02 用户反馈)。
   */
  collectStyles?: (css: string) => void
  /** 保留行内 style(同上,只有独立 HTML 文档需要) */
  keepInlineStyle?: boolean
}

/** 一律剥掉的元素:脚本、书自带样式(排版由墨阅接管)、外部嵌入 */
const DROP_TAGS = ['script', 'style', 'link', 'iframe', 'object', 'embed', 'base', 'meta']

/**
 * 书里的颜色 / 字体类**展示属性**(`<font color face>`、`<td bgcolor>`、`<div background>`):
 * 与行内 style 是一回事 —— 浅色纸上一段 `#92EBA8` 的绿字、指定某款本机没有的字体,
 * 都是在跟纸色与字体设置抢话。电子书模式下一并剥掉;`size` / `align` 留着,它们只关乎层级与对齐。
 */
const PRESENTATION_ATTRS = new Set(['color', 'bgcolor', 'background', 'face'])

/** 书内跳转落在这两个属性上,由视图接管点击 */
export const CHAPTER_ATTR = 'data-book-chapter'
export const ANCHOR_ATTR = 'data-book-anchor'
export const EXTERNAL_ATTR = 'data-external'

/**
 * 把一章的 HTML 洗成能直接塞进 `.prose` 的样子。
 *
 * 消毒不是可选项:电子书里的 HTML 是任人打包的第三方内容,script 一律去掉。
 * **书自带的 CSS 也一并去掉** —— 留着它,字号/行距/纸色那几个旋钮就全被书里的
 * `font-size:12pt; color:#000` 压过去了,而"排版归读者"正是墨阅的主张。
 */
export function sanitizeChapterHtml(html: string, hooks: SanitizeHooks): EbookRender {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const body = doc.body
  if (!body) return { html: '', heading: '' }

  // 先把要留的样式收走,再统一清场。
  // 从整个文档取而不是只看 body:HTML 解析器会把 `<style>` 归到 `<head>` 里去,
  // 只扫 body 的话一份正常写法的文档反而一条样式都收不到。
  if (hooks.collectStyles) {
    const css = Array.from(doc.getElementsByTagName('style'))
      .map((el) => el.textContent ?? '')
      .join('\n')
    if (css.trim()) hooks.collectStyles(css)
  }
  for (const tag of DROP_TAGS) {
    for (const el of Array.from(body.getElementsByTagName(tag))) el.remove()
  }

  for (const el of Array.from(body.getElementsByTagName('*'))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on') || (name === 'href' && /^\s*javascript:/i.test(attr.value))) {
        el.removeAttribute(attr.name)
      } else if (!hooks.keepInlineStyle && PRESENTATION_ATTRS.has(name)) {
        el.removeAttribute(attr.name)
      }
    }
    // 行内 style 里位置无关的部分挑不干净,整条去掉,排版交给 .prose
    if (!hooks.keepInlineStyle) el.removeAttribute('style')

    const local = el.localName
    if (local === 'img' || local === 'image') {
      // SVG 里的 <image> 用 xlink:href
      const src = el.getAttribute('src') ?? el.getAttribute('xlink:href') ?? el.getAttribute('href') ?? ''
      if (src && !/^(https?:|data:|blob:)/i.test(src)) {
        const url = hooks.assetUrl(src)
        if (!url) {
          el.remove()
          continue
        }
        el.setAttribute('src', url)
        if (el.hasAttribute('xlink:href')) el.setAttribute('xlink:href', url)
      }
    } else if (local === 'a') {
      const raw = el.getAttribute('href') ?? ''
      // 章内锚点原样留着,浏览器自己能跳
      if (!raw || raw.startsWith('#')) continue
      if (/^(https?|mailto):/i.test(raw)) {
        el.setAttribute(EXTERNAL_ATTR, '1')
        continue
      }
      if (!hooks.resolveLink) continue
      const target = hooks.resolveLink(raw)
      el.removeAttribute('href')
      if (target) {
        el.setAttribute(CHAPTER_ATTR, target.chapterId)
        el.setAttribute(ANCHOR_ATTR, target.anchor)
      }
    }
  }

  hooks.onBody?.(body)
  const heading = (body.querySelector('h1, h2, h3, h4, title')?.textContent ?? '').trim()
  return { html: body.innerHTML, heading }
}

/**
 * 文本解码。规范都要求 UTF-8,但实际流通的中文书里 GBK/GB18030 不少见,
 * 直接按 UTF-8 解会得到满屏 �。先扒 XML 声明 / meta 里的编码名,认识就按它来。
 */
export function decodeText(bytes: Uint8Array, fallback = 'utf-8'): string {
  const head = new TextDecoder('utf-8').decode(bytes.subarray(0, 1024))
  const m = /encoding=["']([\w-]+)["']/i.exec(head) ?? /charset=["']?([\w-]+)/i.exec(head)
  const enc = (m?.[1] ?? fallback).toLowerCase()
  if (enc === 'utf-8' || enc === 'utf8') return new TextDecoder('utf-8').decode(bytes)
  try {
    return new TextDecoder(enc).decode(bytes)
  } catch {
    // 编码名不认识(TextDecoder 会抛),退回 UTF-8 总比整本读不了强
    return new TextDecoder('utf-8').decode(bytes)
  }
}

/** 目录项 → 唯一 slug(TocPanel 只把它当标识符原样传回) */
export function tocSlug(item: EbookTocItem, idx: number): string {
  return `${idx}|${item.chapterId}|${item.anchor}`
}

export function parseTocSlug(slug: string): { chapterId: string; anchor: string } {
  const parts = slug.split('|')
  return { chapterId: parts[1] ?? '', anchor: parts[2] ?? '' }
}

export const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
}

/** 按字节头认图片类型 —— MOBI 的图片记录不带文件名,只能看魔数 */
export function sniffImageMime(bytes: Uint8Array): string {
  const b = bytes
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg'
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png'
  if (b[0] === 0x47 && b[1] === 0x49) return 'image/gif'
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp'
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57) return 'image/webp'
  return 'application/octet-stream'
}
