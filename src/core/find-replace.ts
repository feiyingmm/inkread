/**
 * 编辑视图的查找 / 替换内核。
 *
 * 一律以 **Markdown 源码**为准来计数与替换 —— 编辑器 DOM 里代码块、公式还带一份
 * 渲染副本,按 DOM 找容易替换到错的那一处。高亮定位由调用方在 DOM 上做,只借用这里
 * 算出来的"第几处"。
 */

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 全部命中的起始下标(按出现顺序);不含重叠命中 */
export function findAll(text: string, query: string, caseSensitive: boolean): number[] {
  if (!query) return []
  const re = new RegExp(escapeRe(query), caseSensitive ? 'g' : 'gi')
  const out: number[] = []
  for (const m of text.matchAll(re)) out.push(m.index)
  return out
}

/** 替换指定位置的那一处 */
export function replaceAt(text: string, start: number, queryLen: number, replacement: string): string {
  return text.slice(0, start) + replacement + text.slice(start + queryLen)
}

/** 全部替换;count 为替换处数 */
export function replaceAll(
  text: string,
  query: string,
  replacement: string,
  caseSensitive: boolean,
): { text: string; count: number } {
  const hits = findAll(text, query, caseSensitive)
  if (hits.length === 0) return { text, count: 0 }
  // 从后往前replace,前面的下标才不会被挪动
  let out = text
  for (let i = hits.length - 1; i >= 0; i--) out = replaceAt(out, hits[i], query.length, replacement)
  return { text: out, count: hits.length }
}
