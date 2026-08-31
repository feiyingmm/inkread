import type { TocItem } from '@/core/markdown/pipeline'

/** 文内目录的层级树节点(由扁平标题序列按 level 组装) */
export interface TocNode extends TocItem {
  children: TocNode[]
}

/**
 * 扁平标题列表 → 层级树。
 * 标题跳级(h2 直接接 h4)在真实文档里很常见,所以用栈按"层级更浅就出栈"归位,
 * 不假设逐级递增;文档以 h3 起头这种也能正确成为根级。
 */
export function buildTocTree(items: TocItem[]): TocNode[] {
  const roots: TocNode[] = []
  const stack: TocNode[] = []
  for (const it of items) {
    const node: TocNode = { ...it, children: [] }
    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) stack.pop()
    if (stack.length > 0) stack[stack.length - 1].children.push(node)
    else roots.push(node)
    stack.push(node)
  }
  return roots
}

/** 目标 slug 的祖先 slug 集合(用于给"折叠着但当前正读到里面"的节点打标) */
export function ancestorSlugs(roots: TocNode[], slug: string): Set<string> {
  const out = new Set<string>()
  if (!slug) return out
  const walk = (nodes: TocNode[], trail: string[]): boolean => {
    for (const n of nodes) {
      if (n.slug === slug) {
        for (const s of trail) out.add(s)
        return true
      }
      if (n.children.length > 0 && walk(n.children, [...trail, n.slug])) return true
    }
    return false
  }
  walk(roots, [])
  return out
}

/** 树里所有"有子节点"的 slug —— 折叠全部时用 */
export function branchSlugs(roots: TocNode[]): string[] {
  const out: string[] = []
  const walk = (nodes: TocNode[]): void => {
    for (const n of nodes) {
      if (n.children.length > 0) {
        out.push(n.slug)
        walk(n.children)
      }
    }
  }
  walk(roots)
  return out
}
