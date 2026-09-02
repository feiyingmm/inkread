/**
 * EPUB 解析:zip → 目录 + 章节 → 可直接塞进 `.prose` 的 HTML。
 *
 * 为什么自己解而不是上 epub.js:墨阅的卖点是那四个排版旋钮(字体/行距/字距/纸色)和
 * 一套自己的阅读样式,而 epub.js 把内容锁在它自己的 iframe 里、连同书自带的 CSS 一起渲染
 * —— 想让旋钮生效就得往 iframe 里注样式,别扭且经常打架。自己解出 XHTML 注进 `.prose`,
 * 目录、查找、导出、打印、位置记忆全都能直接复用已有的那一套。
 *
 * 代价是要自己处理 EPUB 的一堆历史包袱:2 代的 NCX 与 3 代的 nav 两套目录、
 * 路径相对 OPF 而不是包根、zip 里的路径可能带 URL 编码、中文书里 GBK 编码并不罕见。
 * 这些都在下面逐个抹平。
 *
 * 不支持:DRM(加密的书直接报错)、fixed-layout(漫画类固定版式,排版旋钮对它没有意义)。
 */

import { unzipSync } from 'fflate'
import { dirOf, resolvePath } from '@/core/paths'
import {
  decodeText,
  MIME_BY_EXT,
  sanitizeChapterHtml,
  type Ebook,
  type EbookChapter,
  type EbookRender,
  type EbookTocItem,
} from '@/core/ebook'

/** 解压缓存的条目上限。章节文件多在 10~30KB,留十几个够翻页来回而不占内存 */
const ENTRY_CACHE_MAX = 12

interface Reader {
  /** zip 内路径 → 字节(带 LRU 缓存);容错大小写与 URL 编码 */
  read(path: string): Uint8Array | undefined
  /**
   * 条目存不存在。**只查目录索引,不解压** —— 建 spine 时要对 1839 个章节逐个验在不在,
   * 用 `read()` 验的话就是 1839 次解压(每次都要重扫一遍 zip 目录,实测 2.2ms,合计 4 秒)。
   */
  has(path: string): boolean
  /** 丢掉解压缓存 */
  clear(): void
}

/**
 * **按需解压**的读取器,是这个模块最要紧的一处取舍。
 *
 * 一次性 `unzip` 整包很省事,但一本 12MB 的书会摊出 22MB 内容、heap 涨到 37MB(约 3 倍);
 * 长篇小说动辄几十上百兆,照这个比例在 Android WebView 上直接 OOM。
 * 实测(1850 条目的 12MB 书):只扫 zip 目录 2.2ms、只解单个条目 1.5ms,而全量解压 268ms
 * —— 所以按需解压不仅省内存,打开还更快:开书时只解 container/OPF/目录那几个文件,
 * 章节等翻到了再解,读者根本感觉不到那 1.5ms。
 *
 * 代价是原始 zip 字节要一直留着(它是解压的输入),内存下限就是文件本身大小。
 */
function makeReader(bytes: Uint8Array): Reader {
  // 一次扫目录拿到全部条目名:filter 里收集完一律返回 false,不解压任何数据
  const names: string[] = []
  try {
    unzipSync(bytes, {
      filter: (f) => {
        names.push(f.name)
        return false
      },
    })
  } catch {
    // fflate 的报错是英文实现细节(invalid zip data 之类),对读者没意义,换句人话
    throw new Error('这个文件不是有效的 EPUB(压缩包读不开,可能下载不完整)')
  }
  const exact = new Set(names)
  // zip 里大小写不一致的情况有(尤其 Windows 上打包的书),留个小写索引兜底
  const lower = new Map<string, string>()
  for (const n of names) lower.set(n.toLowerCase(), n)

  const cache = new Map<string, Uint8Array>()

  const resolveName = (path: string): string | undefined => {
    const p = normalize(path)
    return exact.has(p) ? p : lower.get(p.toLowerCase())
  }

  return {
    has(path: string): boolean {
      return resolveName(path) !== undefined
    },
    read(path: string): Uint8Array | undefined {
      const name = resolveName(path)
      if (!name) return undefined
      const hit = cache.get(name)
      if (hit) {
        // 命中就提到队尾,让 LRU 淘汰真正最久没碰的
        cache.delete(name)
        cache.set(name, hit)
        return hit
      }
      let data: Uint8Array | undefined
      try {
        data = unzipSync(bytes, { filter: (f) => f.name === name })[name]
      } catch {
        return undefined
      }
      if (!data) return undefined
      cache.set(name, data)
      if (cache.size > ENTRY_CACHE_MAX) {
        const oldest = cache.keys().next().value
        if (oldest !== undefined) cache.delete(oldest)
      }
      return data
    },
    clear(): void {
      cache.clear()
    },
  }
}

/**
 * 按名字取元素,忽略命名空间前缀。
 * OPF/NCX 里 `<item>` 通常不带前缀,但 `<dc:title>` 带,有些书还给整个文档加了默认命名空间
 * —— `getElementsByTagName` 在 XML 文档里是按 qualified name 精确匹配的,单靠它会漏。
 */
function tags(root: Document | Element, name: string): Element[] {
  const direct = Array.from(root.getElementsByTagName(name))
  if (direct.length > 0) return direct
  return Array.from(root.getElementsByTagName('*')).filter((e) => e.localName === name)
}

function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  // XML 严格模式下一个未转义的 & 就能让整篇解析失败,而这在野生 EPUB 里很常见;
  // 解析器出错时退回宽容的 HTML 解析
  if (doc.getElementsByTagName('parsererror').length > 0) {
    return new DOMParser().parseFromString(text, 'text/html')
  }
  return doc
}

/** zip 内路径规范化:去掉前导斜杠、解 URL 编码 */
function normalize(p: string): string {
  const noHash = p.split('#')[0] ?? ''
  let decoded = noHash
  try {
    decoded = decodeURIComponent(noHash)
  } catch {
    /* 半截的 % 转义,原样用 */
  }
  return decoded.replace(/^\/+/, '')
}

/**
 * 打开一本 EPUB。`bytes` 是整个 .epub 文件的字节,**会被一直持有**(按需解压要用它)。
 * 只解析元数据(container / OPF / 目录),章节和图片留到读者真翻到时再解。
 */
export async function openEpub(bytes: Uint8Array): Promise<Ebook> {
  const reader = makeReader(bytes)
  const file = (path: string): Uint8Array | undefined => reader.read(path)
  const has = (path: string): boolean => reader.has(path)
  const text = (path: string): string => {
    const b = file(path)
    return b ? decodeText(b) : ''
  }

  if (has('META-INF/encryption.xml')) {
    throw new Error('这本书有 DRM 加密,墨阅打不开')
  }

  // 1) container.xml → OPF 位置
  const containerText = text('META-INF/container.xml')
  if (!containerText) throw new Error('不是有效的 EPUB(缺 META-INF/container.xml)')
  const opfPath = normalize(
    tags(parseXml(containerText), 'rootfile')[0]?.getAttribute('full-path') ?? '',
  )
  if (!opfPath || !has(opfPath)) throw new Error('不是有效的 EPUB(找不到 OPF)')
  const opfDir = dirOf(opfPath)
  const opf = parseXml(text(opfPath))

  // OPF 里的 href 一律相对 OPF 所在目录,不是相对包根
  const abs = (href: string): string => resolvePath(opfDir, normalize(href))

  // 2) manifest:id → {href, mediaType, properties}
  const manifest = new Map<string, { href: string; type: string; props: string }>()
  for (const it of tags(opf, 'item')) {
    const id = it.getAttribute('id')
    const href = it.getAttribute('href')
    if (!id || !href) continue
    manifest.set(id, {
      href: abs(href),
      type: it.getAttribute('media-type') ?? '',
      props: it.getAttribute('properties') ?? '',
    })
  }

  // 3) spine:阅读顺序
  const spineEl = tags(opf, 'spine')[0]
  const chapters: EbookChapter[] = []
  for (const ref of spineEl ? tags(spineEl, 'itemref') : []) {
    // linear="no" 是封面/版权页一类的附属内容,不进正文流
    if (ref.getAttribute('linear') === 'no') continue
    const item = manifest.get(ref.getAttribute('idref') ?? '')
    // 只验在不在,别把 1839 章全解压一遍
    if (item && has(item.href)) chapters.push({ id: item.href, title: '' })
  }
  if (chapters.length === 0) throw new Error('这本书没有可读的正文(spine 为空)')

  // 4) 目录:优先 EPUB3 的 nav,退回 EPUB2 的 NCX
  const navItem = [...manifest.values()].find((m) => m.props.split(/\s+/).includes('nav'))
  const ncxHref = manifest.get(spineEl?.getAttribute('toc') ?? '')?.href
    ?? [...manifest.values()].find((m) => m.type === 'application/x-dtbncx+xml')?.href
  let toc: EbookTocItem[] = []
  if (navItem) toc = parseNav(text(navItem.href), navItem.href)
  if (toc.length === 0 && ncxHref) toc = parseNcx(text(ncxHref), ncxHref)

  // 目录里的标题回填到章节表,「上一章/下一章」才有名字可显示
  const titleById = new Map<string, string>()
  for (const t of toc) if (t.chapterId && !titleById.has(t.chapterId)) titleById.set(t.chapterId, t.title)
  for (const c of chapters) c.title = titleById.get(c.id) ?? ''

  const meta = tags(opf, 'metadata')[0]
  const metaText = (name: string): string =>
    (meta ? tags(meta, name)[0]?.textContent : '')?.trim() ?? ''

  const urls = new Map<string, string>()
  /**
   * blob URL 上限。视图是无限滚动的,连着读几百章不会有"换章即释放"的时机,
   * 不设上限就会一路攒到几十 MB。上限远大于窗口里同时显示的章数,
   * 被回收的必然是早已滚出 DOM 的图。
   */
  const URL_MAX = 40

  /** zip 内路径 → blob URL(带缓存);找不到返回空串 */
  function assetUrl(path: string): string {
    const p = normalize(path)
    const hit = urls.get(p)
    if (hit) {
      urls.delete(p)
      urls.set(p, hit)
      return hit
    }
    const data = file(p)
    if (!data) return ''
    const ext = p.slice(p.lastIndexOf('.') + 1).toLowerCase()
    // 复制一份再喂 Blob:解出来的视图可能共享底层 buffer,直接传视图会把它整块钉住
    const url = URL.createObjectURL(
      new Blob([data.slice()], { type: MIME_BY_EXT[ext] ?? 'application/octet-stream' }),
    )
    urls.set(p, url)
    if (urls.size > URL_MAX) {
      const oldest = urls.keys().next().value
      if (oldest !== undefined) {
        URL.revokeObjectURL(urls.get(oldest)!)
        urls.delete(oldest)
      }
    }
    return url
  }

  return {
    title: metaText('title') || metaText('dc:title'),
    creator: metaText('creator') || metaText('dc:creator'),
    chapters,
    toc,
    renderChapter(id: string): EbookRender {
      const data = file(id)
      if (!data) return { html: '<p>这一章的内容文件缺失</p>', heading: '' }
      const dir = dirOf(id)
      return sanitizeChapterHtml(decodeText(data), {
        // 章节里的图片路径相对该章文件所在目录
        assetUrl: (src) => assetUrl(resolvePath(dir, normalize(src))),
        resolveLink: (href) => ({
          chapterId: resolvePath(dir, normalize(href)),
          anchor: href.includes('#') ? (href.split('#')[1] ?? '') : '',
        }),
      })
    },
    chapterText(id: string): string {
      const data = file(id)
      if (!data) return ''
      return decodeText(data)
        .replace(/<(script|style)[\s\S]*?<\/>/gi, ' ')
        .replace(/<[^>]*>/g, ' ')
    },
    releaseAssets(): void {
      for (const u of urls.values()) URL.revokeObjectURL(u)
      urls.clear()
    },
    dispose(): void {
      for (const u of urls.values()) URL.revokeObjectURL(u)
      urls.clear()
      reader.clear()
    },
  }
}

/** EPUB3 的 nav.xhtml:层级 = ol 的嵌套深度 */
function parseNav(html: string, navHref: string): EbookTocItem[] {
  if (!html) return []
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const navs = Array.from(doc.getElementsByTagName('nav'))
  const tocNav =
    navs.find((n) => (n.getAttribute('epub:type') ?? n.getAttribute('type') ?? '').includes('toc')) ??
    navs[0]
  if (!tocNav) return []
  const dir = dirOf(navHref)
  const out: EbookTocItem[] = []
  const walk = (list: Element, level: number): void => {
    for (const li of Array.from(list.children).filter((e) => e.localName === 'li')) {
      const a = Array.from(li.children).find((e) => e.localName === 'a' || e.localName === 'span')
      const href = a?.getAttribute('href') ?? ''
      const title = (a?.textContent ?? '').trim()
      if (title) {
        out.push({
          level,
          title,
          // 没有 href 的是纯分组标题(第几卷),指向空串,点击时不跳转
          chapterId: href ? resolvePath(dir, normalize(href)) : '',
          anchor: href.includes('#') ? (href.split('#')[1] ?? '') : '',
        })
      }
      for (const sub of Array.from(li.children).filter((e) => e.localName === 'ol' || e.localName === 'ul')) {
        walk(sub, level + 1)
      }
    }
  }
  for (const list of Array.from(tocNav.children).filter((e) => e.localName === 'ol' || e.localName === 'ul')) {
    walk(list, 1)
  }
  return out
}

/** EPUB2 的 toc.ncx:层级 = navPoint 的嵌套深度 */
function parseNcx(xml: string, ncxHref: string): EbookTocItem[] {
  if (!xml) return []
  const doc = parseXml(xml)
  const map = tags(doc, 'navMap')[0]
  if (!map) return []
  const dir = dirOf(ncxHref)
  const out: EbookTocItem[] = []
  const walk = (parent: Element, level: number): void => {
    for (const pt of Array.from(parent.children).filter((e) => e.localName === 'navPoint')) {
      const label = tags(pt, 'navLabel')[0]
      const title = (label?.textContent ?? '').trim()
      const src = tags(pt, 'content')[0]?.getAttribute('src') ?? ''
      if (title) {
        out.push({
          level,
          title,
          chapterId: src ? resolvePath(dir, normalize(src)) : '',
          anchor: src.includes('#') ? (src.split('#')[1] ?? '') : '',
        })
      }
      walk(pt, level + 1)
    }
  }
  walk(map, 1)
  return out
}
