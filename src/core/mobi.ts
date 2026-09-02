/**
 * MOBI(.mobi / .prc)解析。
 *
 * 结构与 EPUB 完全不同:没有 zip、没有一章一文件,整本书是**一条连续的 HTML 字节流**,
 * 被切成固定 4096 字节一条的记录、逐条 PalmDOC(LZ77)压缩,塞进 PalmDB 容器里。
 * 章节边界靠流里的 `<mbp:pagebreak/>`,目录靠 `<a filepos="12345">`(十进制字节偏移),
 * 图片靠 `<img recindex="00001">` 指向容器里的另一条记录。
 *
 * 实测手头两本 40MB 级的中文长篇都是 **MOBI6 + PalmDOC 压缩 + 无 DRM + UTF-8**,
 * 没有碰到 HUFF/CDIC(那套私有哈夫曼才是逆向级工作量)。所以这里只支持 PalmDOC 压缩,
 * 遇到 HUFF/CDIC 或加密书直接给出可读的错误。
 *
 * 内存策略与 EPUB 一致 —— **不把 36MB 的文本流整条解出来**:
 * 记录是定长的,`filepos / 4096` 就是记录号,所以任意字节区间都能只解那几条记录。
 * 建目录时逐条流式扫一遍(每次只留 4KB + 一点跨界残余),扫完只留下位置索引。
 */

import {
  decodeText,
  sanitizeChapterHtml,
  sniffImageMime,
  type Ebook,
  type EbookChapter,
  type EbookRender,
  type EbookTocItem,
} from '@/core/ebook'

/** PalmDB 头部固定 78 字节,之后是记录偏移表 */
const PDB_HEADER = 78
const PDB_RECORD_ENTRY = 8

interface PalmDb {
  type: string
  creator: string
  /** 每条记录的 [起始, 结束) 字节范围 */
  records: { start: number; end: number }[]
}

function parsePalmDb(data: Uint8Array): PalmDb {
  if (data.length < PDB_HEADER + PDB_RECORD_ENTRY) throw new Error('文件太小,不是 MOBI')
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const ascii = (from: number, len: number): string =>
    String.fromCharCode(...data.subarray(from, from + len))
  const count = view.getUint16(76)
  const offsets: number[] = []
  for (let i = 0; i < count; i++) {
    const at = PDB_HEADER + i * PDB_RECORD_ENTRY
    if (at + 4 > data.length) break
    offsets.push(view.getUint32(at))
  }
  const records = offsets.map((start, i) => ({
    start,
    end: i + 1 < offsets.length ? offsets[i + 1]! : data.length,
  }))
  return { type: ascii(60, 4), creator: ascii(64, 4), records }
}

/**
 * PalmDOC(LZ77 变体)解压。规则很简单,也正是 MOBI 能自己解的原因:
 * - `0x00`:字面 NUL
 * - `0x01..0x08`:后面这么多字节是字面量
 * - `0x09..0x7f`:就是这个 ASCII 字符
 * - `0x80..0xbf`:两字节一组,取出 (距离, 长度),从已输出内容里回抄(可重叠)
 * - `0xc0..0xff`:一个空格 + `byte ^ 0x80`
 */
function palmDocDecompress(src: Uint8Array, maxOut: number): Uint8Array {
  const out = new Uint8Array(maxOut)
  let o = 0
  let i = 0
  while (i < src.length && o < maxOut) {
    const b = src[i++]!
    if (b === 0) {
      out[o++] = 0
    } else if (b <= 8) {
      for (let n = 0; n < b && i < src.length && o < maxOut; n++) out[o++] = src[i++]!
    } else if (b <= 0x7f) {
      out[o++] = b
    } else if (b <= 0xbf) {
      if (i >= src.length) break
      const pair = (b << 8) | src[i++]!
      const distance = (pair >> 3) & 0x07ff
      const length = (pair & 0x07) + 3
      if (distance === 0 || distance > o) break
      // 逐字节抄(允许重叠:距离小于长度时后面抄的是刚写进去的)
      for (let n = 0; n < length && o < maxOut; n++) out[o] = out[o - distance]!, o++
    } else {
      out[o++] = 0x20
      if (o < maxOut) out[o++] = b ^ 0x80
    }
  }
  return out.subarray(0, o)
}

/** 在字节数组里比对 ASCII 模式(标记都是 ASCII,UTF-8 多字节序列不会与之冲突) */
function matchAt(buf: Uint8Array, at: number, needle: Uint8Array): boolean {
  if (at + needle.length > buf.length) return false
  for (let j = 1; j < needle.length; j++) {
    if (buf[at + j] !== needle[j]) return false
  }
  return true
}

const asciiBytes = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0))

const PAGEBREAK = asciiBytes('<mbp:pagebreak')
const FILEPOS = asciiBytes('filepos=')
const LT = 0x3c // '<'
const F = 0x66 // 'f'

interface Boundary {
  pos: number
  title: string
}

/**
 * 流式扫一遍文本流,收集章节边界与章名。
 *
 * 只为拿位置和标题,每条记录解压后用完即弃 —— 峰值内存是 4KB 而不是整条 36MB 的流。
 * 跨记录被切断的标记靠 `carry`(上一条的尾巴)接上。
 *
 * 两种目录来源都要认:
 * - `<a filepos="12345">章名</a>`:老式 MOBI 把目录直接排在正文开头
 * - `<mbp:pagebreak/>`:章节分隔;实测手头两本 40MB 的书**只有**它(目录另存在 INDX
 *   索引记录里,那套格式繁琐且容易解错),所以章名改从分隔符后面的正文里就手取 ——
 *   反正这条记录已经解压在手上,等于零成本。
 *
 * 单次遍历、只在首字符命中时才深比较:两个模式各扫一遍 buffer 的话,
 * 8908 条记录就是上亿次比较,实测能占掉好几秒。
 */
function scanStream(
  readRecord: (i: number) => Uint8Array,
  recordCount: number,
  recordSize: number,
): Boundary[] {
  const out: Boundary[] = []
  const seen = new Set<number>()
  /** 够放下一个 `<a filepos="…">章名</a>` 片段,也够从分隔符后取一段正文当标题 */
  const CARRY = 1024
  // 标注 ArrayBufferLike:subarray 出来的视图带的是这个更宽的 buffer 类型
  let carry: Uint8Array<ArrayBufferLike> = new Uint8Array(0)
  let carryBase = 0

  const push = (pos: number, title: string): void => {
    if (seen.has(pos)) return
    seen.add(pos)
    out.push({ pos, title })
  }

  for (let r = 0; r < recordCount; r++) {
    const rec = readRecord(r)
    if (rec.length === 0) continue
    const base = r * recordSize
    // 把上一条的尾巴接到前面一起搜,避免标记正好被切成两半而漏掉
    let buf: Uint8Array
    let bufBase: number
    if (carry.length > 0) {
      const merged = new Uint8Array(carry.length + rec.length)
      merged.set(carry, 0)
      merged.set(rec, carry.length)
      buf = merged
      bufBase = carryBase
    } else {
      buf = rec
      bufBase = base
    }

    for (let i = 0; i < buf.length; i++) {
      const c = buf[i]!
      if (c === LT) {
        if (!matchAt(buf, i, PAGEBREAK)) continue
        const abs = bufBase + i
        push(abs, titleAfter(buf, i + PAGEBREAK.length))
        i += PAGEBREAK.length - 1
      } else if (c === F) {
        if (!matchAt(buf, i, FILEPOS)) continue
        let p = i + FILEPOS.length
        while (p < buf.length && (buf[p] === 0x22 || buf[p] === 0x27)) p++
        let num = 0
        let digits = 0
        while (p < buf.length && buf[p]! >= 0x30 && buf[p]! <= 0x39) {
          num = num * 10 + (buf[p]! - 0x30)
          p++
          digits++
        }
        i = p - 1
        if (digits === 0) continue
        push(num, anchorText(buf, p))
      }
    }

    // 留下尾巴给下一条接
    const keep = Math.min(CARRY, rec.length)
    carry = rec.subarray(rec.length - keep)
    carryBase = base + rec.length - keep
  }

  out.sort((a, b) => a.pos - b.pos)
  return out
}

/** 剥标签、压空白,截成能进目录的短标题 */
function cleanTitle(raw: string): string {
  const text = raw
    .replace(/<[^>]*>/g, ' ')
    // 按字节截 400 会把最后一个标签切一半(`<div width="0em" align`),它没有 `>`
    // 收尾,上面那条清不掉,漏出来就成了目录里的一行乱码
    .replace(/<[^>]*$/, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, '')
    // 同理,多字节字符被切断会留下替换字符
    .replace(/�/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > 30 ? `${text.slice(0, 30)}…` : text
}

/** 跳过当前标签的收尾(`/>` 或 `>`),返回其后第一个字节的下标 */
function afterTagEnd(buf: Uint8Array, from: number): number {
  for (let i = from; i < buf.length && i < from + 64; i++) {
    if (buf[i] === 0x3e) return i + 1
  }
  return from
}

/** 从一段 HTML 里取第一个块级元素的文字 —— 章名一般就在紧跟分隔符的那个标签里 */
function firstBlockText(html: string): string {
  const re = /<(h[1-6]|p|div|b|strong|font|span)[^>]*>([\s\S]*?)<\//gi
  for (const m of html.matchAll(re)) {
    const t = cleanTitle(m[2] ?? '')
    if (t) return t
  }
  return ''
}

/** `<a filepos=…>` 的锚文本:从 `>` 取到 `</a>` */
function anchorText(buf: Uint8Array, from: number): string {
  const start = afterTagEnd(buf, from)
  if (start >= buf.length) return ''
  const end = Math.min(buf.length, start + 300)
  const slice = decodeText(buf.subarray(start, end))
  const close = slice.indexOf('</a')
  return cleanTitle(close > 0 ? slice.slice(0, close) : slice)
}

/**
 * 章节分隔符之后的章名。
 *
 * 分隔符正好落在记录末尾时后面的文本还没解出来 —— 那就留空(约 2% 的章),
 * 视图会退回用正文里的第一个标题显示。
 */
function titleAfter(buf: Uint8Array, from: number): string {
  const start = afterTagEnd(buf, from)
  if (start >= buf.length) return ''
  // 窗口给到 900 字节:有些章在分隔符后先来一串 <div>/<img> 声明,
  // 400 字节根本够不到章名(实测那样会漏掉约 6% 的章名)
  const end = Math.min(buf.length, start + 900)
  if (end - start < 20) return ''
  const html = decodeText(buf.subarray(start, end))
  // 优先取第一个块级元素的文字;整段都没有标签时退回取开头一小段
  return firstBlockText(html) || cleanTitle(html.slice(0, 60))
}

/** 打开一本 MOBI。`data` 是整个文件的字节,会被一直持有(按需解压要用) */
export async function openMobi(data: Uint8Array): Promise<Ebook> {
  const pdb = parsePalmDb(data)
  if (pdb.type !== 'BOOK' || pdb.creator !== 'MOBI') {
    throw new Error(`不是 MOBI 电子书(容器类型 ${pdb.type}${pdb.creator})`)
  }
  const rec0 = pdb.records[0]
  if (!rec0) throw new Error('MOBI 文件损坏(没有记录)')
  const head = data.subarray(rec0.start, rec0.end)
  const hv = new DataView(head.buffer, head.byteOffset, head.byteLength)

  const compression = hv.getUint16(0)
  const textLength = hv.getUint32(4)
  const textRecordCount = hv.getUint16(8)
  const recordSize = hv.getUint16(10) || 4096
  const encryption = hv.getUint16(12)

  if (encryption !== 0) throw new Error('这本书有 DRM 加密,墨阅打不开')
  if (compression === 17480) {
    throw new Error('这本书用了 HUFF/CDIC 压缩,墨阅暂不支持;可以用 Calibre 转成 EPUB')
  }
  if (compression !== 1 && compression !== 2) {
    throw new Error(`不认识的 MOBI 压缩方式(${compression})`)
  }

  // MOBI header 紧跟在 PalmDOC header 之后
  const magic = String.fromCharCode(...head.subarray(16, 20))
  let firstImage = 0
  let fullName = ''
  let codepage = 65001
  if (magic === 'MOBI') {
    const mobiLen = hv.getUint32(20)
    codepage = hv.getUint32(28)
    // KF8(AZW3)的正文是另一套骨架(SKEL/FRAG 索引 + 内嵌 CSS),
    // 拿 MOBI6 的规则去解会找不到任何章节分隔符 —— 整本变成一章、渲染直接卡死。
    // 与其给个坏体验,不如明说。
    const fileVersion = hv.getUint32(36)
    if (fileVersion >= 8) {
      throw new Error('这是 KF8 / AZW3 格式,墨阅暂不支持;用 Calibre 转成 EPUB 即可阅读')
    }
    if (mobiLen >= 96) firstImage = hv.getUint32(108)
    const nameOffset = hv.getUint32(84)
    const nameLength = hv.getUint32(88)
    if (nameOffset > 0 && nameLength > 0 && nameOffset + nameLength <= head.length) {
      fullName = decodeText(head.subarray(nameOffset, nameOffset + nameLength)).trim()
    }
  }
  const fallbackEnc = codepage === 1252 ? 'windows-1252' : 'utf-8'

  /** 解压第 i 条文本记录(记录 0 是头,文本从 1 开始) */
  const cache = new Map<number, Uint8Array>()
  const CACHE_MAX = 24
  function readRecord(i: number): Uint8Array {
    const hit = cache.get(i)
    if (hit) {
      cache.delete(i)
      cache.set(i, hit)
      return hit
    }
    const r = pdb.records[i + 1]
    if (!r) return new Uint8Array(0)
    const raw = data.subarray(r.start, r.end)
    const out = compression === 1 ? raw.slice(0, recordSize) : palmDocDecompress(raw, recordSize)
    cache.set(i, out)
    if (cache.size > CACHE_MAX) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
    return out
  }

  /** 取文本流的任意字节区间 —— 只解压覆盖它的那几条记录 */
  function slice(from: number, to: number): Uint8Array {
    const start = Math.max(0, Math.min(from, textLength))
    const end = Math.max(start, Math.min(to, textLength))
    const firstRec = Math.floor(start / recordSize)
    const lastRec = Math.floor((end - 1) / recordSize)
    const out = new Uint8Array(end - start)
    let written = 0
    for (let r = firstRec; r <= lastRec; r++) {
      const rec = readRecord(r)
      const recStart = r * recordSize
      const copyFrom = Math.max(0, start - recStart)
      const copyTo = Math.min(rec.length, end - recStart)
      if (copyTo > copyFrom) {
        out.set(rec.subarray(copyFrom, copyTo), written)
        written += copyTo - copyFrom
      }
    }
    return out.subarray(0, written)
  }

  const boundaries = scanStream(readRecord, textRecordCount, recordSize)

  // 章节边界:扫出来的 pagebreak 与 filepos 合起来,首尾补齐
  const bounds = [0, ...boundaries.map((b) => b.pos).filter((b) => b > 0 && b < textLength), textLength]
  const uniq = [...new Set(bounds)].sort((a, b) => a - b)
  /**
   * 单章字节上限。分隔符解析不出来时(格式变种、书本身没分章)整本会成为一章,
   * 几十 MB 的 HTML 塞进 DOM 必然卡死 —— 所以超长的一律再按这个粒度切开,
   * 宁可章名不好看,也不能卡住。约 8 万汉字,比任何正常章节都宽松。
   */
  const MAX_CHAPTER = 240 * 1024
  const ranges: { start: number; end: number }[] = []
  const pushRange = (start: number, end: number): void => {
    // 过滤掉夹在标记之间的碎片(几十字节的空段没有阅读价值)
    if (end - start <= 64) return
    if (end - start <= MAX_CHAPTER) {
      ranges.push({ start, end })
      return
    }
    for (let at = start; at < end; at += MAX_CHAPTER) {
      ranges.push({ start: at, end: Math.min(end, at + MAX_CHAPTER) })
    }
  }
  for (let i = 0; i + 1 < uniq.length; i++) {
    pushRange(uniq[i]!, uniq[i + 1]!)
  }
  if (ranges.length === 0) pushRange(0, textLength)
  if (ranges.length === 0) ranges.push({ start: 0, end: textLength })

  const titleByPos = new Map<number, string>()
  for (const b of boundaries) if (b.title && !titleByPos.has(b.pos)) titleByPos.set(b.pos, b.title)

  const chapters: EbookChapter[] = ranges.map((r) => ({
    id: String(r.start),
    title: titleByPos.get(r.start) ?? '',
  }))
  const rangeById = new Map(ranges.map((r) => [String(r.start), r]))

  /** 目录项落在哪一章里(filepos 未必正好压在章节边界上) */
  function chapterIdFor(pos: number): string {
    let lo = 0
    let hi = ranges.length - 1
    let ans = 0
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (ranges[mid]!.start <= pos) {
        ans = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    return String(ranges[ans]!.start)
  }

  // 目录 = 有名字的那些章节边界
  const tocItems: EbookTocItem[] = boundaries
    .filter((b) => b.title)
    .map((b) => ({ level: 1, title: b.title, chapterId: chapterIdFor(b.pos), anchor: '' }))

  // ---- 图片 ----
  const urls = new Map<string, string>()
  /** 同 epub:无限滚动没有"换章即释放"的时机,靠上限兜住(见 core/epub.ts 的说明) */
  const URL_MAX = 40

  /** `recindex:00001` → 容器里的图片记录 */
  function imageUrl(ref: string): string {
    const m = /^recindex:(\d+)$/.exec(ref)
    if (!m || firstImage <= 0) return ''
    const idx = Number(m[1])
    if (!Number.isFinite(idx) || idx <= 0) return ''
    const hit = urls.get(ref)
    if (hit) {
      urls.delete(ref)
      urls.set(ref, hit)
      return hit
    }
    const rec = pdb.records[firstImage + idx - 1]
    if (!rec) return ''
    const bytes = data.subarray(rec.start, rec.end)
    const mime = sniffImageMime(bytes)
    if (mime === 'application/octet-stream') return ''
    // 复制一份再喂 Blob:直接传视图会把整个文件的 buffer 钉住
    const url = URL.createObjectURL(new Blob([bytes.slice()], { type: mime }))
    urls.set(ref, url)
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
    title: fullName,
    creator: '',
    chapters,
    toc: tocItems,
    renderChapter(id: string): EbookRender {
      const range = rangeById.get(id)
      if (!range) return { html: '<p>这一章的位置对不上</p>', heading: '' }
      const raw = decodeText(slice(range.start, range.end), fallbackEnc)
      // MOBI 特有的两个属性先翻译成标准形态,消毒逻辑就能与 EPUB 共用一套
      const html = raw
        .replace(/<img([^>]*?)\srecindex=["']?(\d+)["']?/gi, '<img$1 src="recindex:$2"')
        .replace(/<a([^>]*?)\sfilepos=["']?(\d+)["']?/gi, '<a$1 href="filepos:$2"')
      return sanitizeChapterHtml(html, {
        assetUrl: imageUrl,
        resolveLink: (href) => {
          const m = /^filepos:(\d+)$/.exec(href)
          return m ? { chapterId: chapterIdFor(Number(m[1])), anchor: '' } : null
        },
      })
    },
    chapterText(id: string): string {
      const range = rangeById.get(id)
      if (!range) return ''
      return decodeText(slice(range.start, range.end), fallbackEnc).replace(/<[^>]*>/g, ' ')
    },
    releaseAssets(): void {
      for (const u of urls.values()) URL.revokeObjectURL(u)
      urls.clear()
    },
    dispose(): void {
      for (const u of urls.values()) URL.revokeObjectURL(u)
      urls.clear()
      cache.clear()
    },
  }
}
