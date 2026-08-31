import type { TreeNode } from '@/core/backend'

/**
 * 文件树的**显示顺序唯一裁决者**。
 *
 * 为什么放前端:两个后端各排各的,结果不一样 ——
 * Rust(`fsops.rs`)按 Unicode 码位:数字 < 英文 < 汉字,汉字之间是码位序、对人没有意义;
 * dev-server(Node)用 `localeCompare('zh-CN')`:拼音序,但汉字整体排在拉丁字母前。
 * 同一个文库在手机和浏览器里顺序不同(2026-08-31 用户发现)。
 *
 * 与其在两端各实现一遍拼音规则(Rust 还得引一个拼音库),不如让后端只管给数据、
 * 顺序统一由这里决定 —— WebView 自带 ICU,两端跑的是同一份 `Intl.Collator`,不可能不一致。
 *
 * 规则:目录在前、文件在后;同类按中文拼音序,数字按数值大小(文档2 排在 文档10 前面)。
 */
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

export function sortTree(nodes: TreeNode[]): TreeNode[] {
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return collator.compare(a.name, b.name)
  })
  for (const n of nodes) {
    if (n.children) sortTree(n.children)
  }
  return nodes
}
