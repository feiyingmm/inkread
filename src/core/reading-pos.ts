/**
 * 每篇文档的阅读位置。
 *
 * v0.5.0 之前只存一个绝对 `scrollTop` 像素值(`inkread:scroll:<repo>:<path>` = "1234")。
 * 现在多存一个百分比:最近阅读列表要显示「读到 42%」,而光有像素值算不出比例
 * —— 总高度得等文档渲染完才知道,列表里没法现算。
 *
 * 旧存档(纯数字)照常读,只是 pct 为 0(列表不显示进度),读一次之后就自动升级成新格式。
 */

export interface ReadingPos {
  /** 滚动容器的 scrollTop 像素值 */
  top: number
  /** 阅读进度百分比 0~100;0 表示未知(旧存档) */
  pct: number
  /** EPUB 专用:读到第几章(spine 序号)。markdown 不用 */
  chapter?: number
}

/** 落盘用短键,一个文库上千篇文档时 localStorage 能省下不少 */
interface Stored {
  t: number
  p: number
  c?: number
}

const EMPTY: ReadingPos = { top: 0, pct: 0 }

function key(repoId: string, path: string): string {
  return `inkread:scroll:${repoId}:${path}`
}

export function loadPos(repoId: string, path: string): ReadingPos {
  const raw = localStorage.getItem(key(repoId, path))
  if (!raw) return EMPTY
  // 旧格式:纯数字
  const asNum = Number(raw)
  if (Number.isFinite(asNum)) return { top: asNum, pct: 0 }
  try {
    const s = JSON.parse(raw) as Partial<Stored>
    return { top: Number(s.t) || 0, pct: Number(s.p) || 0, chapter: Number(s.c) || 0 }
  } catch {
    return EMPTY
  }
}

export function savePos(repoId: string, path: string, pos: ReadingPos): void {
  const data: Stored = { t: Math.round(pos.top), p: Math.round(pos.pct) }
  if (pos.chapter) data.c = pos.chapter
  localStorage.setItem(key(repoId, path), JSON.stringify(data))
}

export function clearPos(repoId: string, path: string): void {
  localStorage.removeItem(key(repoId, path))
}
