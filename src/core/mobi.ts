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
const BODY = asciiBytes('<body')
const LT = 0x3c // '<'
const GT = 0x3e // '>'
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
 * - `<a filepos="12345">章名</a>`:老式 MOBI 把目录直接排在正文开头(Calibre 出的书排在末尾)
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
    const isLast = r + 1 >= recordCount
    // 最后一条即使是空的也要走一遍:上一条留下的 carry 还没扫完
    if (rec.length === 0 && !isLast) continue
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

    // 不是最后一条时,末尾 keep 字节本轮不扫 —— 它们会作为 carry 在下一轮**完整地**再扫一遍。
    // 记录边界正好切在标记中间(`<a filepos=00|28386980>`)的话,本轮只看得到半截数字,
    // 会伪造出 0 / 1 / 26 这种章节边界:凡人修仙传.mobi 因此把 `<head>` 里的残片
    // `nce type="toc" …` 当成了第一章正文(2026-09-02 用户反馈)。留给带 carry 的下一轮,数字就是完整的。
    const keep = Math.min(CARRY, rec.length)
    const limit = isLast ? buf.length : buf.length - keep

    for (let i = 0; i < limit; i++) {
      const c = buf[i]!
      if (c === LT) {
        if (!matchAt(buf, i, PAGEBREAK)) continue
        const abs = bufBase + i
        push(abs, titleAfter(buf, i + PAGEBREAK.length))
        i += PAGEBREAK.length - 1
      } else if (c === F) {
        if (!matchAt(buf, i, FILEPOS)) continue
        // 只认 `<a filepos=…>`:`<guide>` 里的 `<reference type="toc" filepos=…/>` 也带这个属性,
        // 它指向目录页而不是某章开头,锚文本更是空的 —— 当成目录项只会多出一条错位的"章"
        if (!inAnchorTag(buf, i)) {
          i += FILEPOS.length - 1
          continue
        }
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
        // 数字一路读到了缓冲区末尾:可能还没读完,交给下一轮
        if (p >= buf.length && !isLast) continue
        push(num, anchorText(buf, p))
      }
    }

    // 留下尾巴给下一条接
    carry = rec.subarray(rec.length - keep)
    carryBase = base + rec.length - keep
  }

  out.sort((a, b) => a.pos - b.pos)
  return out
}

/** `filepos=` 出现处是否在一个 `<a …>` 标签里:往前找最近的 `<`,中途先碰到 `>` 说明已在标签外 */
function inAnchorTag(buf: Uint8Array, at: number): boolean {
  for (let j = at - 1; j >= 0 && at - j < 200; j--) {
    const c = buf[j]!
    if (c === GT) return false
    if (c === LT) {
      const t = buf[j + 1]
      const after = buf[j + 2]
      return (t === 0x61 || t === 0x41) && (after === 0x20 || after === 0x09 || after === 0x0a || after === 0x0d)
    }
  }
  return false
}

/** `<body …>` 收尾之后的字节偏移 —— 正文从这儿才开始;找不到就从 0 起 */
function findBodyStart(head: Uint8Array): number {
  for (let i = 0; i + BODY.length <= head.length; i++) {
    if (head[i] !== LT || !matchAt(head, i, BODY)) continue
    const end = afterTagEnd(head, i + BODY.length)
    return end > i ? end : 0
  }
  return 0
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
    if (buf[i] === GT) return i + 1
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

/** 块级标签:blockquote 里有这些时不能整体降成 `<p>`(p 里不能再套块) */
const BLOCK_TAGS = new Set([
  'p', 'div', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'pre', 'hr', 'section',
])

/**
 * MOBI6 没有 CSS,kindlegen 把一切 margin / 缩进都编译成 `<blockquote>`;有的书整本正文
 * 每一段都是 `<p><blockquote><font>…</font></blockquote></p>`(凡人修仙传 - 忘语.mobi,
 * 2026-09-02 用户反馈"段落都有底色")。它在这里是纯排版而非引用,套上 .prose 的引用块样式
 * (左竖线 + 底色)整页都是色块。
 *
 * 处理:blockquote 一律拆掉 —— 只含行内内容的降成 `<p>`(段距 / 缩进那些旋钮照常生效),
 * 含块级子元素的降成 `<div>`,落在标题里的降成 `<span>`;再清掉 HTML 解析器拆
 * `<p><blockquote>` 时留下的空 `<p></p>` 壳。由内到外处理,外层判断"有没有块级子元素"时内层已换好。
 * EPUB 不做这一步:它有 CSS,blockquote 多半真是引用。
 */
function flattenLayoutBlockquotes(body: HTMLElement): void {
  const doc = body.ownerDocument
  const all = Array.from(body.getElementsByTagName('blockquote')).reverse()
  for (const bq of all) {
    const inHeading = !!bq.parentElement?.closest('h1,h2,h3,h4,h5,h6')
    const hasBlock = Array.from(bq.children).some((c) => BLOCK_TAGS.has(c.localName))
    const repl = doc.createElement(inHeading ? 'span' : hasBlock ? 'div' : 'p')
    while (bq.firstChild) repl.appendChild(bq.firstChild)
    bq.replaceWith(repl)
  }
  // 空壳判定看"有没有可见内容"而不是"有没有子元素":`<p><font> </font></p>` 这种只剩空白的也是壳
  for (const p of Array.from(body.getElementsByTagName('p'))) {
    if (!(p.textContent ?? '').trim() && !p.querySelector('img,br,hr,svg,video,audio')) p.remove()
  }
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

  // 正文从 `<body>` 之后才开始:前面的 `<html><head><guide>…</guide></head>` 不是内容,
  // 万一有边界落在这段里,切出来的"章"就是半截标签
  const bodyStart = findBodyStart(slice(0, Math.min(textLength, 8192)))

  // 章节边界:扫出来的 pagebreak 与 filepos 合起来,首尾补齐
  const bounds = [
    bodyStart,
    ...boundaries.map((b) => b.pos).filter((b) => b > bodyStart && b < textLength),
    textLength,
  ]
  const uniq = [...new Set(bounds)].sort((a, b) => a - b)
  /**
   * 单章字节上限。分隔符解析不出来时(格式变种、书本身没分章)整本会成为一章,
   * 几十 MB 的 HTML 塞进 DOM 必然卡死 —— 所以超长的一律再按这个粒度切开,
   * 宁可章名不好看,也不能卡住。约 8 万汉字,比任何正常章节都宽松。
   */
  const MAX_CHAPTER = 240 * 1024
  /** 夹在两个标记之间不足这么多字节的碎片不成章(典型:`<mbp:pagebreak/>` 与紧随其后的目录 filepos 相差十几字节) */
  const FRAGMENT = 64
  const ranges: { start: number; end: number }[] = []
  const pushRange = (start: number, end: number): void => {
    // 过滤掉夹在标记之间的碎片(几十字节的空段没有阅读价值)
    if (end - start <= FRAGMENT) return
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
  if (ranges.length === 0) pushRange(bodyStart, textLength)
  if (ranges.length === 0) ranges.push({ start: bodyStart, end: textLength })

  const titleByPos = new Map<number, string>()
  for (const b of boundaries) if (b.title && !titleByPos.has(b.pos)) titleByPos.set(b.pos, b.title)

  const chapters: EbookChapter[] = ranges.map((r) => ({
    id: String(r.start),
    title: titleByPos.get(r.start) ?? '',
  }))
  const rangeById = new Map(ranges.map((r) => [String(r.start), r]))

  /** 位置落在哪一章里(filepos 未必正好压在章节边界上) */
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

  /**
   * 目录项落到哪一章。边界若落在被 pushRange 过滤掉的碎片区间里(pagebreak 与紧随其后的
   * 目录 filepos 相差十几字节的情形),`chapterIdFor` 会把它归到**前一章**;这里改成归到
   * 紧随其后开始的那一章 —— 那才是它指的地方。
   */
  function tocChapterFor(pos: number): string {
    let lo = 0
    let hi = ranges.length - 1
    let next = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (ranges[mid]!.start >= pos) {
        next = mid
        hi = mid - 1
      } else {
        lo = mid + 1
      }
    }
    if (next >= 0 && ranges[next]!.start - pos <= FRAGMENT) return String(ranges[next]!.start)
    return chapterIdFor(pos)
  }

  // 目录 = 有名字的那些章节边界。同一章可能被 pagebreak 与 `<a filepos>` 各报一次
  // (Calibre 出的书两样都有,凡人修仙传.mobi 实测目录条数是章数的两倍),相邻同章同名的只留一条;
  // 同章不同名的(卷名 + 章名)两条都留,少一条就丢信息
  const tocItems: EbookTocItem[] = []
  for (const b of boundaries) {
    if (!b.title) continue
    const chapterId = tocChapterFor(b.pos)
    const prev = tocItems[tocItems.length - 1]
    if (prev && prev.chapterId === chapterId && prev.title === b.title) continue
    tocItems.push({ level: 1, title: b.title, chapterId, anchor: '' })
  }

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
        onBody: flattenLayoutBlockquotes,
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
