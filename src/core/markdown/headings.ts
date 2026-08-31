import { slugify, type TocItem } from '@/core/markdown/pipeline'

/**
 * 从 Markdown 源码里抽标题(编辑视图的大纲用)。
 *
 * 阅读视图的大纲是 markdown-it-anchor 在渲染时顺手收的,编辑视图没有渲染这一步 ——
 * 为拿标题把全文重渲染一遍太贵(每次敲键都要跑一趟 highlight.js),所以这里逐行扫源码。
 * slug 规则(slugify + 同名标题追加 -1 / -2)与阅读视图保持一致,好让两个视图的大纲
 * 折叠状态、当前项能对上;拿 claude-docs 的 737 篇真实文档比对过,两边逐字一致。
 */

/**
 * 标题文字里的行内标记:阅读视图的大纲取的是纯文字,这里也去掉。
 * ⚠️ 不能无脑删 `*` `_` —— 表名 `cms_cx_article` 里的下划线在 markdown 里不是强调,
 * 阅读视图会原样保留;删了两边 slug 就对不上(737 篇里踩到 81 篇)。
 */
const INLINE_CLEAN: [RegExp, string][] = [
  [/!\[[^\]]*\]\([^)]*\)/g, ''], // 图片
  [/\[([^\]]*)\]\([^)]*\)/g, '$1'], // 链接只留文字
  // 行内 html:标签名与属性名都得是 ascii,`<Skill 名称 1>` 这种占位写法在阅读视图里
  // 是普通文字(markdown-it 不认它是标签),这里也别删
  [/<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s+[a-zA-Z_:-][\w:.-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*\s*\/?>/g, ''],
  [/~~([^~]+)~~/g, '$1'],
  [/\*\*([^*]+)\*\*/g, '$1'],
  [/\*([^*]+)\*/g, '$1'],
  // 下划线强调必须成对且贴着词边界,词中间的 _ 一律留着
  [/(^|[\s(【(])__([^_]+)__(?=[\s)】),.:;!?、,。:;!?]|$)/g, '$1$2'],
  [/(^|[\s(【(])_([^_]+)_(?=[\s)】),.:;!?、,。:;!?]|$)/g, '$1$2'],
]

/** 这一行能不能当 setext 标题的正文(排除列表 / 引用 / 表格 / 围栏那些行) */
function canBeSetextText(line: string): boolean {
  const t = line.trim()
  if (!t) return false
  return !/^(#{1,6}(\s|$)|>|[-*+]\s|\d+[.)]\s|\||`{3,}|~{3,}|:{3,})/.test(t)
}

function cleanTitle(raw: string): string {
  // 按反引号切段:行内代码原样保留(`sharecms:commonconfig:<key>` 里的 <key> 是字面内容,
  // 阅读视图把 code_inline 整段收进标题),只清洗普通文字段
  return raw
    .trim()
    .split(/(`+[^`]*`+)/)
    .map((seg, i) => {
      if (i % 2 === 1) return seg.replace(/^`+|`+$/g, '')
      let t = seg
      for (const [re, rep] of INLINE_CLEAN) t = t.replace(re, rep)
      return t
    })
    .join('')
    .trim()
}

export function extractHeadings(source: string): TocItem[] {
  const lines = source.split(/\r?\n/)
  const out: TocItem[] = []
  const used = new Set<string>()
  /** 当前所在围栏的标记(``` / ~~~~…),空串表示不在代码块里 */
  let fence = ''
  let i = 0

  // front matter:仅当首行是 --- 时成立(与阅读视图的 markdown-it-front-matter 同款判断)
  if (lines[0]?.trim() === '---') {
    i = 1
    while (i < lines.length && lines[i].trim() !== '---') i++
    i++
  }

  const push = (level: number, rawTitle: string): void => {
    const title = cleanTitle(rawTitle)
    let slug = slugify(title)
    if (used.has(slug)) {
      let n = 1
      while (used.has(`${slug}-${n}`)) n++
      slug = `${slug}-${n}`
    }
    used.add(slug)
    out.push({ level, title, slug })
  }

  for (; i < lines.length; i++) {
    const line = lines[i]
    if (fence) {
      // 收尾围栏后面不许带语言标记 —— ```markdown 块里嵌的 ```bash 不算收尾,
      // 否则块内的 `# 注释` 会被错当成标题(真实文档里踩到过)
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*\r?$/.exec(line)
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = ''
      continue
    }
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (open) {
      fence = open[1]
      continue
    }
    // ATX:# ~ ###### + 空格;`#tag` 这种不算标题
    const atx = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/.exec(line)
    if (atx) {
      push(atx[1].length, (atx[2] ?? '').replace(/[ \t]+#+[ \t]*$/, ''))
      continue
    }
    // setext:上一行是正文,本行全是 = 或 -
    const setext = /^ {0,3}(=+|-+)[ \t]*$/.exec(line)
    if (setext && i > 0 && canBeSetextText(lines[i - 1])) {
      push(setext[1][0] === '=' ? 1 : 2, lines[i - 1])
    }
  }
  return out
}
