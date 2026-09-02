/**
 * 最近阅读列表(按文库分开存)。
 *
 * 数据一直都在(v0.4.0 起 Ctrl+P 空输入就是靠它),这里只是把它从「一串路径」
 * 升级成「路径 + 时间」,好让侧栏和命令面板能显示「20 分钟前 · 读到 42%」。
 * 进度不存在这儿,查 [reading-pos] 那份 —— 一份数据只有一个主人。
 */

import { loadPos } from '@/core/reading-pos'

export interface RecentDoc {
  path: string
  /** 最后打开时间(ms);0 = 旧存档没记时间 */
  at: number
}

/** 存 20 条:命令面板一屏也就这么多,再多是负担 */
const LIMIT = 20

function key(repoId: string): string {
  return `inkread:recent:${repoId}`
}

/** 读并顺带迁移旧格式(`string[]` → `{path, at}[]`) */
export function listRecent(repoId: string): RecentDoc[] {
  if (!repoId) return []
  try {
    const raw = JSON.parse(localStorage.getItem(key(repoId)) ?? '[]') as unknown[]
    return raw
      .map((it) => (typeof it === 'string' ? { path: it, at: 0 } : (it as RecentDoc)))
      .filter((it): it is RecentDoc => !!it && typeof it.path === 'string' && !!it.path)
      .map((it) => ({ path: it.path, at: Number(it.at) || 0 }))
  } catch {
    return []
  }
}

function write(repoId: string, list: RecentDoc[]): void {
  localStorage.setItem(key(repoId), JSON.stringify(list.slice(0, LIMIT)))
}

/** 记一次打开:已在列表里就提到最前并更新时间 */
export function pushRecent(repoId: string, path: string): void {
  if (!repoId || !path) return
  const rest = listRecent(repoId).filter((it) => it.path !== path)
  write(repoId, [{ path, at: Date.now() }, ...rest])
}

/** 文件已经不在了(删了/改名了)就从列表里摘掉 */
export function dropRecent(repoId: string, paths: string[]): void {
  if (!repoId || paths.length === 0) return
  const drop = new Set(paths)
  write(
    repoId,
    listRecent(repoId).filter((it) => !drop.has(it.path)),
  )
}

export function clearRecent(repoId: string): void {
  localStorage.removeItem(key(repoId))
}

/** 「20 分钟前」这类相对时间;时间未知返回空串 */
export function relTime(at: number): string {
  if (!at) return ''
  const diff = Date.now() - at
  if (diff < 0) return '刚刚'
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.floor(hour / 24)
  if (day === 1) return '昨天'
  if (day < 7) return `${day} 天前`
  const d = new Date(at)
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

/** 侧栏/命令面板那行副标题:「20 分钟前 · 读到 42%」 */
export function recentMeta(repoId: string, doc: RecentDoc): string {
  const parts: string[] = []
  const t = relTime(doc.at)
  if (t) parts.push(t)
  const { pct } = loadPos(repoId, doc.path)
  // 1% 以下当没读过(刚打开就退出),100% 直接说读完
  if (pct >= 99) parts.push('已读完')
  else if (pct >= 1) parts.push(`读到 ${Math.round(pct)}%`)
  return parts.join(' · ')
}
