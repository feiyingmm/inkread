<template>
  <MobilePage title="文件信息" @back="emit('close')">
    <div class="fi-head">
      <span class="fi-icon"><Icon :name="node.type === 'dir' ? 'folder' : 'doc'" :size="20" /></span>
      <div class="fi-name">{{ node.name }}</div>
    </div>

    <div v-if="loading" class="fi-hint">读取中…</div>
    <div v-else-if="error" class="fi-hint fi-hint--err">{{ error }}</div>
    <div v-else-if="info" class="fi-rows">
      <div v-for="row in rows" :key="row.k" class="fi-row">
        <span class="fi-k">{{ row.k }}</span>
        <span class="fi-v" :class="{ 'fi-v--path': row.mono }">{{ row.v }}</span>
      </div>
    </div>

    <template #footer>
      <span class="foot-flex"></span>
      <button class="opt" :disabled="!info" @click="copyAbs">复制绝对路径</button>
      <button class="opt is-on" @click="emit('close')">关闭</button>
    </template>
  </MobilePage>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { backend, type EntryInfo, type GitChange, type TreeNode } from '@/core/backend'
import { copyText } from '@/core/clipboard'
import { errMsg } from '@/core/errmsg'
import { dirOf, extOf, fileKind } from '@/core/paths'
import { toast } from '@/core/toast'
import Icon from '@/components/Icon.vue'
import MobilePage from '@/components/MobilePage.vue'

const props = defineProps<{
  repoId: string
  node: TreeNode
  /** 未提交变更明细(已在内存里,顺带算出本条目的 git 本地状态,不再问后端) */
  changes: GitChange[]
}>()

const emit = defineEmits<{ close: [] }>()

const info = ref<EntryInfo | null>(null)
const loading = ref(true)
const error = ref('')

onMounted(async () => {
  try {
    info.value = await backend.entryInfo(props.repoId, props.node.path)
  } catch (e) {
    error.value = `读取信息失败:${errMsg(e)}`
  } finally {
    loading.value = false
  }
})

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function fmtTime(ms?: number): string {
  if (!ms) return '—'
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const KIND_LABEL: Record<string, string> = {
  markdown: 'Markdown 文档',
  image: '图片',
  text: '文本',
  other: '其它文件',
}

const typeLabel = computed(() => {
  if (props.node.type === 'dir') return '文件夹'
  const ext = extOf(props.node.path)
  const kind = KIND_LABEL[fileKind(props.node.path)]
  return ext ? `${kind}(.${ext})` : kind
})

/** git 本地状态:目录看子树里有没有变更 */
const gitLabel = computed(() => {
  const p = props.node.path
  const hit =
    props.node.type === 'dir'
      ? props.changes.filter((c) => c.path === p || c.path.startsWith(`${p}/`))
      : props.changes.filter((c) => c.path === p)
  if (hit.length === 0) return '无本地改动'
  const LABEL: Record<string, string> = {
    modified: '已修改',
    added: '已暂存新增',
    untracked: '未跟踪(新文件)',
    deleted: '已删除',
    renamed: '已移动',
  }
  if (props.node.type === 'dir') return `${hit.length} 处未提交变更`
  return LABEL[hit[0].kind] ?? '有未提交变更'
})

const rows = computed(() => {
  const i = info.value
  if (!i) return []
  const out: { k: string; v: string; mono?: boolean }[] = [
    { k: '类型', v: typeLabel.value },
    { k: '位置', v: dirOf(i.path) || '(文库根目录)' },
    { k: '大小', v: i.isDir ? `${fmtSize(i.size)}(子项合计)` : fmtSize(i.size) },
  ]
  if (i.isDir) {
    out.push({ k: '包含', v: `${i.fileCount ?? 0} 个文件 · ${i.dirCount ?? 0} 个子文件夹` })
  }
  if (i.lines !== undefined) {
    out.push({ k: '行数', v: `${i.lines} 行` })
    out.push({ k: '字数', v: `${i.chars ?? 0} 字` })
  }
  out.push({ k: '修改时间', v: fmtTime(i.mtime) })
  out.push({ k: '创建时间', v: fmtTime(i.ctime) })
  out.push({ k: '本地状态', v: gitLabel.value })
  out.push({ k: '绝对路径', v: i.absPath, mono: true })
  return out
})

async function copyAbs(): Promise<void> {
  if (!info.value) return
  try {
    await copyText(info.value.absPath)
    toast(`已复制路径:${info.value.absPath}`)
  } catch (e) {
    toast(`复制失败:${errMsg(e)}`, true)
  }
}
</script>

<style scoped>
.fi-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
}
.fi-icon {
  display: inline-flex;
  color: var(--accent);
  flex-shrink: 0;
}
.fi-name {
  font-family: var(--font-serif);
  font-size: 16px;
  font-weight: 600;
  color: var(--t1);
  word-break: break-all;
  line-height: 1.4;
}

.fi-hint {
  padding: 18px 2px;
  font-size: 13px;
  color: var(--t3);
}
.fi-hint--err {
  color: #b04a4a;
}

.fi-row {
  display: flex;
  gap: 14px;
  padding: 11px 0;
  border-bottom: 1px solid var(--line);
  font-size: 13px;
}
.fi-row:last-child {
  border-bottom: none;
}
.fi-k {
  flex-shrink: 0;
  width: 72px;
  color: var(--t3);
}
.fi-v {
  flex: 1;
  min-width: 0;
  color: var(--t1);
  word-break: break-all;
  line-height: 1.6;
}
.fi-v--path {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--t2);
}

@media (max-width: 900px) {
  .fi-name {
    font-size: 17px;
  }
  .fi-row {
    padding: 14px 0;
    font-size: 14.5px;
  }
  .fi-k {
    width: 84px;
  }
  .fi-v--path {
    font-size: 12.5px;
  }
}
</style>
