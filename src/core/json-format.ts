/**
 * JSON 格式化 / 压缩。
 *
 * 刻意不用 `JSON.parse` + `JSON.stringify`:接口报文里的雪花 ID(19 位 Long)过一遍
 * JS number 就丢精度(1234567890123456789 → 1234567890123456800),把文档里的样例
 * 数字悄悄改掉,比不格式化更糟。所以这里自己走一遍递归下降:
 * 结构照常校验,标量(数字 / 字符串 / true / false / null)一律按原文搬运。
 */

export interface JsonResult {
  ok: boolean
  /** 成功时是结果文本;失败时回退为原文 */
  text: string
  /** 失败原因(带行列位置);成功时为空串 */
  error: string
}

/** 标量:数字保持原文(含前导零之外的所有写法),字面量三个 */
const RE_SCALAR = /-?(?:0|[1-9]\d*|\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/y
/** JS 的 \s 已包含 BOM(U+FEFF),粘出来的报文开头带 BOM 也能吃下 */
const RE_WS = /\s*/y

class Printer {
  private i = 0
  private readonly out: string[] = []

  /** pad 为空串 = 压缩输出(无换行无空格) */
  constructor(
    private readonly src: string,
    private readonly pad: string,
  ) {}

  run(): string {
    this.ws()
    this.value(0)
    this.ws()
    if (this.i < this.src.length) throw this.err('JSON 结束后还有多余内容')
    return this.out.join('')
  }

  private err(msg: string): Error {
    let line = 1
    let col = 1
    for (let k = 0; k < this.i && k < this.src.length; k++) {
      if (this.src[k] === '\n') {
        line++
        col = 1
      } else {
        col++
      }
    }
    return new Error(`第 ${line} 行第 ${col} 列:${msg}`)
  }

  private ws(): void {
    RE_WS.lastIndex = this.i
    const m = RE_WS.exec(this.src)
    if (m) this.i += m[0].length
  }

  private nl(depth: number): void {
    if (this.pad) this.out.push('\n' + this.pad.repeat(depth))
  }

  private value(depth: number): void {
    const c = this.src[this.i]
    if (c === undefined) throw this.err('缺少 JSON 值')
    if (c === '{') {
      this.obj(depth)
      return
    }
    if (c === '[') {
      this.arr(depth)
      return
    }
    if (c === '"') {
      this.out.push(this.str())
      return
    }
    RE_SCALAR.lastIndex = this.i
    const m = RE_SCALAR.exec(this.src)
    if (!m) throw this.err(`无法识别的值「${this.src.slice(this.i, this.i + 12)}」`)
    this.out.push(m[0])
    this.i += m[0].length
  }

  /** 字符串按原文整段搬运(转义序列不做还原,免得改动内容) */
  private str(): string {
    const start = this.i
    this.i++
    while (this.i < this.src.length) {
      const c = this.src[this.i]
      if (c === '\\') {
        this.i += 2
        continue
      }
      this.i++
      if (c === '"') return this.src.slice(start, this.i)
    }
    this.i = start
    throw this.err('字符串缺少收尾的双引号')
  }

  private obj(depth: number): void {
    this.i++
    this.ws()
    if (this.src[this.i] === '}') {
      this.i++
      this.out.push('{}')
      return
    }
    this.out.push('{')
    for (;;) {
      this.nl(depth + 1)
      this.ws()
      if (this.src[this.i] === '}') throw this.err('对象末尾多了一个逗号')
      if (this.src[this.i] !== '"') throw this.err('对象的键必须是双引号字符串')
      this.out.push(this.str())
      this.ws()
      if (this.src[this.i] !== ':') throw this.err('键后面缺少冒号')
      this.i++
      this.out.push(this.pad ? ': ' : ':')
      this.ws()
      this.value(depth + 1)
      this.ws()
      const c = this.src[this.i]
      if (c === ',') {
        this.i++
        this.out.push(',')
        continue
      }
      if (c === '}') {
        this.i++
        this.nl(depth)
        this.out.push('}')
        return
      }
      throw this.err('对象里缺少逗号或收尾的右花括号')
    }
  }

  private arr(depth: number): void {
    this.i++
    this.ws()
    if (this.src[this.i] === ']') {
      this.i++
      this.out.push('[]')
      return
    }
    this.out.push('[')
    for (;;) {
      this.nl(depth + 1)
      this.ws()
      if (this.src[this.i] === ']') throw this.err('数组末尾多了一个逗号')
      this.value(depth + 1)
      this.ws()
      const c = this.src[this.i]
      if (c === ',') {
        this.i++
        this.out.push(',')
        continue
      }
      if (c === ']') {
        this.i++
        this.nl(depth)
        this.out.push(']')
        return
      }
      throw this.err('数组里缺少逗号或收尾的右方括号')
    }
  }
}

function run(text: string, pad: string): JsonResult {
  try {
    return { ok: true, text: new Printer(text, pad).run(), error: '' }
  } catch (e) {
    return { ok: false, text, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 缩进展开 */
export function formatJson(text: string, indent = 2): JsonResult {
  return run(text, ' '.repeat(Math.max(0, indent)))
}

/** 压成一行 */
export function minifyJson(text: string): JsonResult {
  return run(text, '')
}

/** 粗判一段文本是否 JSON(对象 / 数组起头);用来决定要不要给格式化入口 */
export function looksLikeJson(text: string): boolean {
  return /^\s*[[{]/.test(text)
}

export interface FenceFormatResult {
  text: string
  /** 成功格式化的代码块数 */
  done: number
  /** 内容不是合法 JSON、原样留下的代码块数 */
  failed: number
}

/**
 * 批量格式化 markdown 里的 ```json 围栏代码块(编辑视图用)。
 * 逐行扫描而不是一条正则通吃 —— 围栏可能是 ``` 或 ~~~、可能带缩进(嵌在列表里)、
 * 长度可能多于三个,正则写全了没人看得懂;不合法的 JSON 原样保留,只统计条数。
 */
export function formatJsonFences(markdown: string, indent = 2): FenceFormatResult {
  const lines = markdown.split('\n')
  const out: string[] = []
  let done = 0
  let failed = 0
  let i = 0
  while (i < lines.length) {
    const open = /^([ \t]*)(`{3,}|~{3,})[ \t]*(json[0-9a-z]*)[ \t]*\r?$/i.exec(lines[i])
    if (!open) {
      out.push(lines[i])
      i++
      continue
    }
    const [, lead, ticks] = open
    const mark = ticks[0] === '~' ? '~' : '`'
    const closeRe = new RegExp(`^[ \\t]*${mark}{${ticks.length},}[ \\t]*\\r?$`)
    let j = i + 1
    while (j < lines.length && !closeRe.test(lines[j])) j++
    if (j >= lines.length) {
      // 围栏没闭合:原样交还,不猜用户意图
      out.push(lines[i])
      i++
      continue
    }
    const r = formatJson(lines.slice(i + 1, j).join('\n'), indent)
    out.push(lines[i])
    if (r.ok) {
      done++
      for (const l of r.text.split('\n')) out.push(lead + l)
    } else {
      failed++
      for (let k = i + 1; k < j; k++) out.push(lines[k])
    }
    out.push(lines[j])
    i = j + 1
  }
  return { text: out.join('\n'), done, failed }
}
