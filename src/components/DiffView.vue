<template>
  <div class="dv">
    <div class="dv-head">
      <span class="dv-badge" :class="`dv-badge--${change.kind}`">{{ KIND_LABEL[change.kind] }}</span>
      <span class="dv-path" :title="change.path">{{ change.path }}</span>
      <span v-if="diff && !diff.identical" class="dv-stat">
        <b class="dv-stat-add">+{{ diff.added }}</b>
        <b class="dv-stat-del">−{{ diff.removed }}</b>
      </span>
      <span class="dv-flex"></span>
      <button v-if="change.kind !== 'deleted'" class="opt" title="在阅读视图里打开这个文件" @click="emit('open')">打开</button>
      <button
        class="opt"
        :title="change.kind === 'untracked' ? '撤销:删除该新增文件' : '撤销修改,恢复到最近提交的版本'"
        @click="emit('discard')"
      >
        撤销
      </button>
    </div>

    <div class="dv-body">
      <div v-if="loading" class="dv-msg">正在读取两侧内容…</div>
      <div v-else-if="error" class="dv-msg is-err">{{ error }}</div>
      <div v-else-if="src?.binary" class="dv-msg">
        二进制文件,不显示内容对比
        <span class="dv-sub">最近提交 {{ fmtSize(src.baseSize) }} → 工作区 {{ fmtSize(src.currentSize) }}</span>
      </div>
      <div v-else-if="diff?.identical" class="dv-msg">
        内容与最近提交逐行相同
        <span class="dv-sub">差别可能只在换行符(CRLF / LF)或文件属性上</span>
      </div>
      <template v-else-if="diff">
        <template v-for="(h, hi) in shownHunks" :key="hi">
          <div v-if="sepLabel(hi)" class="dv-sep">{{ sepLabel(hi) }}</div>
          <div v-for="(l, li) in h.lines" :key="li" class="dv-line" :class="`dv-line--${l.type}`">
            <span class="dv-no">{{ l.oldNo ?? '' }}</span>
            <span class="dv-no">{{ l.newNo ?? '' }}</span>
            <span class="dv-sign">{{ SIGN[l.type] }}</span>
            <span class="dv-text">{{ l.text || ' ' }}</span>
          </div>
        </template>
        <div v-if="truncated" class="dv-msg">改动太多,只显示了前 {{ MAX_LINES }} 行</div>
        <div v-else-if="tailSkipped > 0" class="dv-sep">⋯ 其后 {{ tailSkipped }} 行未改动</div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 单个文件的改动对比(变更面板右侧 / 手机端二级页)。
 *
 * 两侧文本由后端取(最近提交 ↔ 工作区),行级 diff 在前端 core/diff.ts 算,
 * 这里只负责按 unified diff 的样子画出来:左右两列行号、+/− 标记、块间"跳过 N 行"。
 * 单栏而不是左右对照:手机上没有左右对照的空间,而桌面上一栏也够看清 Markdown 的改动。
 */
import { computed, ref, watch } from 'vue'
import { backend, type DiffSource, type GitChange, type GitChangeKind } from '@/core/backend'
import { diffLines, type DiffHunk, type LineDiff } from '@/core/diff'
import { errMsg } from '@/core/errmsg'

const props = defineProps<{
  repoId: string
  change: GitChange
}>()

const emit = defineEmits<{ open: []; discard: [] }>()

const KIND_LABEL: Record<GitChangeKind, string> = {
  modified: '改',
  added: '增',
  untracked: '新',
  deleted: '删',
  renamed: '移',
}
const SIGN = { ctx: ' ', add: '+', del: '−' } as const

/** 渲染上限:几千个 div 之后再往下浏览器就开始吃力,而这时候用户也不会逐行看了 */
const MAX_LINES = 3000

const loading = ref(false)
const error = ref('')
const src = ref<DiffSource | null>(null)
const diff = ref<LineDiff | null>(null)
let seq = 0

async function load(): Promise<void> {
  const my = ++seq
  loading.value = true
  error.value = ''
  src.value = null
  diff.value = null
  try {
    const s = await backend.gitDiffSource(props.repoId, props.change.path)
    if (my !== seq) return
    src.value = s
    if (!s.binary) diff.value = diffLines(s.base ?? '', s.current ?? '')
  } catch (e) {
    if (my !== seq) return
    error.value = errMsg(e)
  } finally {
    if (my === seq) loading.value = false
  }
}

watch(() => [props.repoId, props.change.path], () => void load(), { immediate: true })

const shownHunks = computed<DiffHunk[]>(() => {
  const d = diff.value
  if (!d) return []
  const out: DiffHunk[] = []
  let n = 0
  for (const h of d.hunks) {
    if (n + h.lines.length > MAX_LINES) {
      if (n < MAX_LINES) out.push({ ...h, lines: h.lines.slice(0, MAX_LINES - n) })
      break
    }
    out.push(h)
    n += h.lines.length
  }
  return out
})

const truncated = computed(() => {
  const d = diff.value
  return !!d && d.hunks.reduce((s, h) => s + h.lines.length, 0) > MAX_LINES
})

/** 两块之间(以及第一块之前)有多少行没改动 —— 按新侧行号算,增删行都已计入 */
function sepLabel(i: number): string {
  const hs = shownHunks.value
  const h = hs[i]!
  const prevEnd = i === 0 ? 0 : hs[i - 1]!.newStart + hs[i - 1]!.newCount - 1
  const skipped = h.newStart - prevEnd - 1
  if (skipped > 0) return `⋯ 跳过 ${skipped} 行未改动`
  return i === 0 ? '' : '⋯'
}

const tailSkipped = computed(() => {
  const d = diff.value
  const hs = shownHunks.value
  if (!d || hs.length === 0) return 0
  const last = hs[hs.length - 1]!
  return Math.max(0, d.newLines - (last.newStart + last.newCount - 1))
})

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
</script>

<style scoped>
.dv {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  min-width: 0;
}
.dv-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  padding: 8px 12px;
  border-bottom: 1px solid var(--line);
}
.dv-badge {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  font-size: 11.5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
}
.dv-badge--modified {
  background: #f7edd8;
  color: #8a5f0b;
}
.dv-badge--added,
.dv-badge--untracked {
  background: #e2f2e4;
  color: #2c6e35;
}
.dv-badge--deleted {
  background: #fbe4e4;
  color: #a33636;
}
.dv-badge--renamed {
  background: #e2edf8;
  color: #2b5f8e;
}
.dv-path {
  min-width: 0;
  font-size: 12.5px;
  color: var(--t1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  /* 路径太长时保住文件名那一端 */
  direction: rtl;
  text-align: left;
}
.dv-stat {
  flex-shrink: 0;
  font-size: 12px;
  font-family: var(--font-mono);
}
.dv-stat-add {
  color: #2c6e35;
}
.dv-stat-del {
  color: #a33636;
  margin-left: 6px;
}
.dv-flex {
  flex: 1;
}
.dv-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.55;
  padding-bottom: 12px;
}
.dv-msg {
  padding: 28px 16px;
  text-align: center;
  color: var(--t3);
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.8;
}
.dv-msg.is-err {
  color: #a33636;
}
.dv-sub {
  display: block;
  font-size: 12px;
}
.dv-sep {
  padding: 3px 12px;
  font-size: 11.5px;
  color: var(--t3);
  background: var(--bg-side);
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  font-family: var(--font-sans);
}
.dv-line {
  display: flex;
  align-items: flex-start;
}
.dv-no {
  flex-shrink: 0;
  width: 44px;
  padding: 0 6px;
  text-align: right;
  color: var(--t3);
  font-size: 11.5px;
  line-height: inherit;
  user-select: none;
  border-right: 1px solid var(--line);
}
.dv-sign {
  flex-shrink: 0;
  width: 18px;
  text-align: center;
  color: var(--t3);
  user-select: none;
}
.dv-text {
  flex: 1;
  min-width: 0;
  padding-right: 10px;
  white-space: pre-wrap;
  word-break: break-all;
  tab-size: 4;
  color: var(--t1);
}
.dv-line--add {
  background: #e8f5ea;
}
.dv-line--add .dv-sign {
  color: #2c6e35;
  font-weight: 700;
}
.dv-line--del {
  background: #fbe9e9;
}
.dv-line--del .dv-sign {
  color: #a33636;
  font-weight: 700;
}
.dv-line--del .dv-text {
  color: var(--t2);
}
:root[data-mode='dark'] .dv-badge--modified {
  background: #3a2f14;
  color: #d9ab4e;
}
:root[data-mode='dark'] .dv-badge--added,
:root[data-mode='dark'] .dv-badge--untracked {
  background: #16311a;
  color: #7ec98a;
}
:root[data-mode='dark'] .dv-badge--deleted {
  background: #3a1a1a;
  color: #e08585;
}
:root[data-mode='dark'] .dv-badge--renamed {
  background: #16283a;
  color: #7fb2dc;
}
:root[data-mode='dark'] .dv-stat-add,
:root[data-mode='dark'] .dv-line--add .dv-sign {
  color: #7ec98a;
}
:root[data-mode='dark'] .dv-stat-del,
:root[data-mode='dark'] .dv-line--del .dv-sign,
:root[data-mode='dark'] .dv-msg.is-err {
  color: #e08585;
}
:root[data-mode='dark'] .dv-line--add {
  background: #16311a;
}
:root[data-mode='dark'] .dv-line--del {
  background: #3a1a1a;
}
@media (max-width: 900px) {
  .dv-head {
    padding: 8px 10px;
  }
  .dv-no {
    width: 34px;
    padding: 0 4px;
  }
  .dv-body {
    font-size: 12px;
    padding-bottom: calc(12px + var(--safe-bottom, 0px));
  }
}
</style>
