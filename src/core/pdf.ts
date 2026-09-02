/**
 * PDF 支撑层:pdf.js 的加载、worker 配置与大纲提取。
 *
 * pdf.js 整包近 1MB,只在真的打开 PDF 时才动态 import(和 mermaid 一样的处理),
 * 免得为了一个不常用的格式把主 chunk 撑大、拖慢冷启动。
 *
 * PDF 是**固定版式**:字体、行距、字距那几个排版旋钮对它一律无效(改不了排版,
 * 只能缩放)。这一点和墨阅"可重排阅读"的主线不同,所以 PDF 走独立视图,
 * 只保证「能看清、记得住读到哪、目录能跳」。
 */

import type { PDFDocumentProxy } from 'pdfjs-dist'

export interface PdfOutlineItem {
  level: number
  title: string
  /** 0 起的页序号;解析不出目标页时为 -1(仍显示,点了不跳) */
  page: number
}

let loading: Promise<typeof import('pdfjs-dist')> | null = null

/**
 * 动态载入 pdf.js 并配好 worker(只做一次)。
 *
 * 用的是 **legacy 构建**而不是默认构建:pdf.js 6 的默认构建直接调用 `Uint8Array.prototype.toHex`、
 * `Promise.try`、`Iterator` helpers 这些 2025 年才进浏览器的 API,不带任何 polyfill;
 * 手机上的 Android WebView 往往落后桌面 WebView2 好几个版本,一开 PDF 就在 worker 里死于
 * `n.toHex is not a function`(2026-09-02 用户反馈,同一份 PDF 电脑端正常)。legacy 构建自带
 * core-js 那一小撮 polyfill,主线程 + worker 各多约 60KB,换来两端都能开。
 */
export function loadPdfjs(): Promise<typeof import('pdfjs-dist')> {
  loading ??= (async () => {
    const [pdfjs, worker] = await Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      // `?url` 让 vite 把 worker 产物单独出一份文件并给出可用地址,
      // 不能直接 import 它的模块(worker 里跑的是另一套全局环境)
      import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
    ])
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
    return pdfjs
  })()
  return loading
}

/**
 * 目录。PDF 的 outline 里存的是「目标对象」而不是页号,要用 `getPageIndex` 反查 ——
 * 一本几百页的书目录可能上百条,逐条反查是并发的,别串行 await。
 */
export async function readOutline(doc: PDFDocumentProxy): Promise<PdfOutlineItem[]> {
  type RawItem = { title: string; dest: string | unknown[] | null; items?: RawItem[] }
  let raw: RawItem[] | null = null
  try {
    raw = (await doc.getOutline()) as RawItem[] | null
  } catch {
    return []
  }
  if (!raw || raw.length === 0) return []

  const flat: { level: number; title: string; dest: RawItem['dest'] }[] = []
  const walk = (items: RawItem[], level: number): void => {
    for (const it of items) {
      const title = (it.title ?? '').trim()
      if (title) flat.push({ level, title, dest: it.dest })
      if (it.items && it.items.length > 0) walk(it.items, level + 1)
    }
  }
  walk(raw, 1)

  const pages = await Promise.all(
    flat.map(async (it) => {
      try {
        // dest 可能是命名目标(字符串)或直接的目标数组,前者要先查表
        const dest = typeof it.dest === 'string' ? await doc.getDestination(it.dest) : it.dest
        const ref = Array.isArray(dest) ? dest[0] : null
        if (!ref) return -1
        return await doc.getPageIndex(ref as Parameters<typeof doc.getPageIndex>[0])
      } catch {
        return -1
      }
    }),
  )
  return flat.map((it, i) => ({ level: it.level, title: it.title, page: pages[i] ?? -1 }))
}

/** 目录项 → slug(TocPanel 只把它当标识符原样传回) */
export function pdfTocSlug(page: number, idx: number): string {
  return `p${page}#${idx}`
}

export function parsePdfTocSlug(slug: string): number {
  const n = Number(slug.slice(1).split('#')[0])
  return Number.isFinite(n) ? n : -1
}
