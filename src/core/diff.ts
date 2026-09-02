/**
 * 行级文本对比(变更面板的「查看改动」)。
 *
 * 算法是 Myers 的 O(ND) 差分,采用 diff-match-patch 那种「正向、反向两条路径同时推进,
 * 在相遇处一分为二再递归」的写法:线性空间,不用存 O(D²) 的回溯表,一份几万行的文档也能
 * 在几十毫秒内算完。行先映射成整数 id 再比 —— 在 Int32Array 上比整数,比反复比字符串快得多。
 *
 * 两端后端只负责把「最近提交」与「工作区」两侧的文本取来(backend.gitDiffSource),
 * diff 只在这里算一份:Rust 与 Node 各算一遍,迟早长出两种不同的输出。
 *
 * 比较时忽略行尾的 `\r`:CRLF / LF 之差在 Windows 与手机之间太常见,把整篇标成"全改了"没有意义。
 */

export type DiffLineType = 'ctx' | 'add' | 'del'

export interface DiffLine {
  type: DiffLineType
  /** 旧侧行号(1 起);新增行为 null */
  oldNo: number | null
  /** 新侧行号(1 起);删除行为 null */
  newNo: number | null
  text: string
}

export interface DiffHunk {
  /** 旧侧起始行号(1 起;纯新增块取插入点前一行 +1) */
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  lines: DiffLine[]
}

export interface LineDiff {
  hunks: DiffHunk[]
  added: number
  removed: number
  /** 两侧逐行相同(可能只差换行符) */
  identical: boolean
  oldLines: number
  newLines: number
}

/** 拆行:末尾的换行不算多出一空行;行尾 `\r` 去掉 */
export function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!
    if (l.endsWith('\r')) lines[i] = l.slice(0, -1)
  }
  return lines
}

interface Op {
  type: DiffLineType
  count: number
}

/** 待处理的一段:`a[a0, a1)` 对 `b[b0, b1)`;`suffix` 是这一段算完后要补的公共尾巴长度 */
interface Task {
  a0: number
  a1: number
  b0: number
  b1: number
  suffix: number
}

function pushOp(out: Op[], type: DiffLineType, count: number): void {
  if (count <= 0) return
  const last = out[out.length - 1]
  if (last && last.type === type) last.count += count
  else out.push({ type, count })
}

/**
 * 两个 id 序列的差分,返回按顺序排列的 ctx / del / add 行程。
 * 用显式栈代替递归:极端输入(几万行交替增删)下递归深度会到几万层,直接爆栈。
 * 栈是后进先出,所以先压右半、再压左半,弹出来正好是左 → 右;尾巴挂在右半任务上,右半算完再补。
 */
function diffIds(a: Int32Array, b: Int32Array): Op[] {
  const out: Op[] = []
  const stack: Task[] = [{ a0: 0, a1: a.length, b0: 0, b1: b.length, suffix: 0 }]
  while (stack.length > 0) {
    const t = stack.pop()!
    let { a0, a1, b0, b1 } = t
    // 公共前缀直接产出
    let prefix = 0
    while (a0 + prefix < a1 && b0 + prefix < b1 && a[a0 + prefix] === b[b0 + prefix]) prefix++
    pushOp(out, 'ctx', prefix)
    a0 += prefix
    b0 += prefix
    // 公共后缀留到这一段结束再补
    let suffix = 0
    while (a1 - suffix > a0 && b1 - suffix > b0 && a[a1 - 1 - suffix] === b[b1 - 1 - suffix]) suffix++
    a1 -= suffix
    b1 -= suffix
    const tail = suffix + t.suffix

    if (a0 === a1) {
      pushOp(out, 'add', b1 - b0)
      pushOp(out, 'ctx', tail)
      continue
    }
    if (b0 === b1) {
      pushOp(out, 'del', a1 - a0)
      pushOp(out, 'ctx', tail)
      continue
    }
    const split = bisect(a, a0, a1 - a0, b, b0, b1 - b0)
    // 找不到任何公共行,或分割点没有把问题变小(理论上不会,防御一手免得死循环):整段替换
    if (!split || (split[0] === 0 && split[1] === 0) || (split[0] === a1 - a0 && split[1] === b1 - b0)) {
      pushOp(out, 'del', a1 - a0)
      pushOp(out, 'add', b1 - b0)
      pushOp(out, 'ctx', tail)
      continue
    }
    const [x, y] = split
    stack.push({ a0: a0 + x, a1, b0: b0 + y, b1, suffix: tail })
    stack.push({ a0, a1: a0 + x, b0, b1: b0 + y, suffix: 0 })
  }
  return out
}

/**
 * Myers 中点分治:正向从 (0,0)、反向从 (n,m) 各自按 d 递增推进,两条最远路径一相遇就返回
 * 相遇点 —— 它一定落在某条最短编辑路径上,于是可以在这里切成两半分别再算。
 * 直接对应 diff-match-patch 的 `diff_bisect`,只是坐标带了偏移(a0 / b0)、比的是整数。
 */
function bisect(a: Int32Array, a0: number, n: number, b: Int32Array, b0: number, m: number): [number, number] | null {
  const maxD = Math.ceil((n + m) / 2)
  const vOffset = maxD
  const vLength = 2 * maxD
  const v1 = new Int32Array(vLength).fill(-1)
  const v2 = new Int32Array(vLength).fill(-1)
  v1[vOffset + 1] = 0
  v2[vOffset + 1] = 0
  const delta = n - m
  // 长度差为奇数时相遇发生在正向推进途中,偶数时发生在反向途中
  const front = delta % 2 !== 0
  let k1start = 0
  let k1end = 0
  let k2start = 0
  let k2end = 0
  for (let d = 0; d < maxD; d++) {
    for (let k1 = -d + k1start; k1 <= d - k1end; k1 += 2) {
      const k1Offset = vOffset + k1
      let x1 =
        k1 === -d || (k1 !== d && v1[k1Offset - 1]! < v1[k1Offset + 1]!) ? v1[k1Offset + 1]! : v1[k1Offset - 1]! + 1
      let y1 = x1 - k1
      while (x1 < n && y1 < m && a[a0 + x1] === b[b0 + y1]) {
        x1++
        y1++
      }
      v1[k1Offset] = x1
      if (x1 > n) {
        k1end += 2
      } else if (y1 > m) {
        k1start += 2
      } else if (front) {
        const k2Offset = vOffset + delta - k1
        if (k2Offset >= 0 && k2Offset < vLength && v2[k2Offset]! !== -1) {
          const x2 = n - v2[k2Offset]!
          if (x1 >= x2) return [x1, y1]
        }
      }
    }
    for (let k2 = -d + k2start; k2 <= d - k2end; k2 += 2) {
      const k2Offset = vOffset + k2
      let x2 =
        k2 === -d || (k2 !== d && v2[k2Offset - 1]! < v2[k2Offset + 1]!) ? v2[k2Offset + 1]! : v2[k2Offset - 1]! + 1
      let y2 = x2 - k2
      while (x2 < n && y2 < m && a[a0 + n - x2 - 1] === b[b0 + m - y2 - 1]) {
        x2++
        y2++
      }
      v2[k2Offset] = x2
      if (x2 > n) {
        k2end += 2
      } else if (y2 > m) {
        k2start += 2
      } else if (!front) {
        const k1Offset = vOffset + delta - k2
        if (k1Offset >= 0 && k1Offset < vLength && v1[k1Offset]! !== -1) {
          const x1 = v1[k1Offset]!
          const y1 = vOffset + x1 - k1Offset
          if (x1 >= n - x2) return [x1, y1]
        }
      }
    }
  }
  return null
}

/** 行 → 整数 id(相同内容同一个 id) */
function toIds(lines: string[], ids: Map<string, number>): Int32Array {
  const out = new Int32Array(lines.length)
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!
    let id = ids.get(l)
    if (id === undefined) {
      id = ids.size
      ids.set(l, id)
    }
    out[i] = id
  }
  return out
}

/** 行程 → 带行号的逐行序列 */
function expand(ops: Op[], oldLines: string[], newLines: string[]): DiffLine[] {
  const lines: DiffLine[] = []
  let oi = 0
  let ni = 0
  for (const op of ops) {
    for (let k = 0; k < op.count; k++) {
      if (op.type === 'ctx') {
        lines.push({ type: 'ctx', oldNo: oi + 1, newNo: ni + 1, text: newLines[ni]! })
        oi++
        ni++
      } else if (op.type === 'del') {
        lines.push({ type: 'del', oldNo: oi + 1, newNo: null, text: oldLines[oi]! })
        oi++
      } else {
        lines.push({ type: 'add', oldNo: null, newNo: ni + 1, text: newLines[ni]! })
        ni++
      }
    }
  }
  return lines
}

/**
 * 按 unified diff 的规矩切块:每处改动前后各带 `context` 行,两处改动之间没改的行不超过
 * `2 * context` 就并成一块。
 */
function toHunks(lines: DiffLine[], context: number): DiffHunk[] {
  const hunks: DiffHunk[] = []
  let i = 0
  while (i < lines.length) {
    if (lines[i]!.type === 'ctx') {
      i++
      continue
    }
    const start = Math.max(0, i - context)
    // 从这处改动往后走,中间的未改动段够短就把下一处改动也收进来
    let end = i + 1
    let j = i + 1
    while (j < lines.length) {
      if (lines[j]!.type !== 'ctx') {
        end = j + 1
        j++
        continue
      }
      let k = j
      while (k < lines.length && lines[k]!.type === 'ctx' && k - j <= 2 * context) k++
      if (k < lines.length && lines[k]!.type !== 'ctx') {
        j = k
        continue
      }
      break
    }
    const hunkEnd = Math.min(lines.length, end + context)
    const slice = lines.slice(start, hunkEnd)
    let oldCount = 0
    let newCount = 0
    for (const l of slice) {
      if (l.oldNo !== null) oldCount++
      if (l.newNo !== null) newCount++
    }
    hunks.push({
      oldStart: firstNo(lines, start, 'oldNo'),
      oldCount,
      newStart: firstNo(lines, start, 'newNo'),
      newCount,
      lines: slice,
    })
    i = hunkEnd
  }
  return hunks
}

/** 块起点在某一侧的行号:块首行在该侧没有行号(纯新增 / 纯删除开头)时,取前一个有行号的 +1 */
function firstNo(lines: DiffLine[], start: number, side: 'oldNo' | 'newNo'): number {
  const direct = lines[start]![side]
  if (direct !== null) return direct
  for (let i = start - 1; i >= 0; i--) {
    const n = lines[i]![side]
    if (n !== null) return n + 1
  }
  return 1
}

/** 两段文本的行级差分 */
export function diffLines(oldText: string, newText: string, context = 3): LineDiff {
  const oldLines = splitLines(oldText)
  const newLines = splitLines(newText)
  const ids = new Map<string, number>()
  const ops = diffIds(toIds(oldLines, ids), toIds(newLines, ids))
  let added = 0
  let removed = 0
  for (const op of ops) {
    if (op.type === 'add') added += op.count
    else if (op.type === 'del') removed += op.count
  }
  const identical = added === 0 && removed === 0
  const hunks = identical ? [] : toHunks(expand(ops, oldLines, newLines), context)
  return { hunks, added, removed, identical, oldLines: oldLines.length, newLines: newLines.length }
}
