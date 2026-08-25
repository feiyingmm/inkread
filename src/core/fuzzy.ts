/**
 * 文件路径模糊匹配打分:子序列命中,连续命中与文件名段命中加权。
 * 返回 <0 表示不匹配,分数越高越靠前。
 */
export function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  if (!q) return 0

  // 完整子串命中:权重最高,文件名里命中再加权
  const sub = t.indexOf(q)
  if (sub >= 0) {
    const nameStart = t.lastIndexOf('/') + 1
    let score = 1000 - Math.min(sub, 200)
    if (sub >= nameStart) score += 500
    score -= Math.min(t.length, 300) / 10
    return score
  }

  // 子序列匹配
  let ti = 0
  let score = 0
  let streak = 0
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]
    let found = -1
    while (ti < t.length) {
      if (t[ti] === ch) {
        found = ti
        break
      }
      ti++
    }
    if (found < 0) return -1
    streak = found > 0 && q[qi - 1] === t[found - 1] ? streak + 1 : 0
    score += 10 + streak * 8
    if (found === 0 || t[found - 1] === '/' || t[found - 1] === '_' || t[found - 1] === '-' || t[found - 1] === '.') {
      score += 20
    }
    ti = found + 1
  }
  score -= Math.min(t.length, 300) / 10
  return score
}

export interface FuzzyHit<T> {
  item: T
  score: number
}

export function fuzzyFilter<T>(query: string, items: T[], key: (item: T) => string, limit = 50): T[] {
  if (!query.trim()) return items.slice(0, limit)
  const hits: FuzzyHit<T>[] = []
  for (const item of items) {
    const s = fuzzyScore(query, key(item))
    if (s >= 0) hits.push({ item, score: s })
  }
  hits.sort((a, b) => b.score - a.score)
  return hits.slice(0, limit).map((h) => h.item)
}
