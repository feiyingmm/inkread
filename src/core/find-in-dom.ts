/**
 * 当前 DOM 里的文内查找。markdown、HTML 文档、电子书章节共用一套。
 *
 * 高亮走 **CSS Custom Highlight API**(`CSS.highlights`),而不是往正文里插 `<mark>`:
 * 插标签会改动 DOM 结构 —— 折叠状态、目录锚点、原样渲染的 HTML 布局都可能被带坏,
 * 而且清除高亮时还得把结构还原回去。Highlight API 只是"画在上面",不碰 DOM。
 * 老浏览器没有这个 API 时自动退化成"只滚动到命中处、不着色"。
 */

const HL_ALL = 'inkread-search'
const HL_CURRENT = 'inkread-search-current'

export interface FindState {
  ranges: Range[]
  index: number
}

/** 在 root 的文本节点里找出所有命中(大小写不敏感) */
export function findRanges(root: HTMLElement | null, rawQuery: string): Range[] {
  const query = rawQuery.trim().toLowerCase()
  if (!root || !query) return []
  const out: Range[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    const text = (node.textContent ?? '').toLowerCase()
    let idx = 0
    while ((idx = text.indexOf(query, idx)) >= 0) {
      const r = new Range()
      r.setStart(node, idx)
      r.setEnd(node, idx + query.length)
      out.push(r)
      idx += query.length
    }
  }
  return out
}

/** 全部命中着淡色、当前一处着重色 */
export function paintHighlights(ranges: Range[], index: number): void {
  try {
    if (!CSS.highlights) return
    CSS.highlights.set(HL_ALL, new Highlight(...ranges))
    const cur = ranges[index]
    if (cur) CSS.highlights.set(HL_CURRENT, new Highlight(cur))
    else CSS.highlights.delete(HL_CURRENT)
  } catch {
    /* 不支持就只靠滚动定位 */
  }
}

export function clearHighlights(): void {
  try {
    CSS.highlights?.delete(HL_ALL)
    CSS.highlights?.delete(HL_CURRENT)
  } catch {
    /* 同上 */
  }
}

/** 把命中处滚到视野中间 */
export function revealRange(range: Range | undefined, before?: (el: HTMLElement) => void): void {
  const el = range?.startContainer.parentElement
  if (!el) return
  before?.(el)
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

/** 循环步进(到头绕回) */
export function stepIndex(total: number, current: number, dir: number): number {
  if (total === 0) return 0
  return (current + dir + total) % total
}
