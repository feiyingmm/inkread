<template>
  <div class="mask mask--center" @click.self="emit('close')">
    <div class="palette">
      <div class="palette-head">
        <button class="opt" :class="{ 'is-on': mode === 'files' }" @click="switchMode('files')">文件</button>
        <button class="opt" :class="{ 'is-on': mode === 'search' }" @click="switchMode('search')">全文</button>
        <input
          ref="inputEl"
          v-model="query"
          class="palette-input"
          :placeholder="mode === 'files' ? '输入文件名模糊匹配…' : '输入关键字搜索全库…'"
          @keydown="onKeydown"
        />
      </div>

      <div ref="listEl" class="palette-body">
        <template v-if="mode === 'files'">
          <div v-if="showingRecent" class="palette-group">最近阅读</div>
          <div v-if="fileHits.length === 0" class="palette-empty">无匹配文件</div>
          <button
            v-for="(f, i) in fileHits"
            :key="f"
            class="palette-item"
            :class="{ 'is-sel': i === selected }"
            :data-idx="i"
            @click="pickFile(f)"
            @mousemove="selected = i"
          >
            <span class="pi-name">{{ nameOf(f) }}</span>
            <span class="pi-path">{{ dirOfPath(f) }}</span>
          </button>
        </template>

        <template v-else>
          <div v-if="searching" class="palette-empty">搜索中…</div>
          <div v-else-if="query.trim() && groups.length === 0" class="palette-empty">无命中</div>
          <div v-else-if="!query.trim()" class="palette-empty">输入关键字,回车或稍候即可搜索</div>
          <template v-for="g in groups" :key="g.path">
            <div class="palette-group">{{ g.path }}</div>
            <button
              v-for="hit in g.hits"
              :key="g.path + ':' + hit.idx"
              class="palette-item palette-item--hit"
              :class="{ 'is-sel': hit.idx === selected }"
              :data-idx="hit.idx"
              @click="pickHit(hit)"
              @mousemove="selected = hit.idx"
            >
              <span class="pi-line">{{ hit.nameMatch ? '文件名' : ':' + hit.line }}</span>
              <span class="pi-preview" v-html="highlightPreview(hit.preview)"></span>
            </button>
          </template>
        </template>
      </div>

      <div class="palette-foot">↑↓ 选择 · Enter 打开 · Esc 关闭 · Tab 切换模式</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { backend, type SearchHit, type TreeNode } from '@/core/backend'
import { fuzzyFilter } from '@/core/fuzzy'
import { fileKind } from '@/core/paths'

interface FlatHit extends SearchHit {
  idx: number
}

const props = defineProps<{
  repoId: string
  tree: TreeNode[]
  initialMode: 'files' | 'search'
  recent: string[]
}>()

const emit = defineEmits<{
  close: []
  open: [path: string, highlight?: string]
}>()

const mode = ref<'files' | 'search'>(props.initialMode)
const query = ref('')
const selected = ref(0)
const searching = ref(false)
const inputEl = ref<HTMLInputElement | null>(null)
const listEl = ref<HTMLElement | null>(null)
const searchHits = ref<SearchHit[]>([])
let searchTimer: ReturnType<typeof setTimeout> | null = null
let searchSeq = 0

const allFiles = computed(() => {
  const out: string[] = []
  function walk(nodes: TreeNode[]) {
    for (const n of nodes) {
      if (n.type === 'dir') walk(n.children ?? [])
      else if (fileKind(n.path) !== 'other') out.push(n.path)
    }
  }
  walk(props.tree)
  return out
})

// 空输入先展示最近阅读,有输入才做全库模糊匹配
const fileHits = computed(() => {
  if (!query.value.trim() && props.recent.length > 0) return props.recent.slice(0, 20)
  return fuzzyFilter(query.value, allFiles.value, (p) => p, 60)
})
const showingRecent = computed(() => !query.value.trim() && props.recent.length > 0)

const flatSearch = computed<FlatHit[]>(() => searchHits.value.map((h, idx) => ({ ...h, idx })))

const groups = computed(() => {
  const map = new Map<string, FlatHit[]>()
  for (const h of flatSearch.value) {
    const arr = map.get(h.path)
    if (arr) arr.push(h)
    else map.set(h.path, [h])
  }
  return Array.from(map.entries()).map(([path, hits]) => ({ path, hits }))
})

const totalCount = computed(() => (mode.value === 'files' ? fileHits.value.length : flatSearch.value.length))

function nameOf(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1)
}
function dirOfPath(p: string): string {
  const i = p.lastIndexOf('/')
  return i < 0 ? '' : p.slice(0, i)
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function highlightPreview(preview: string): string {
  const q = query.value.trim()
  if (!q) return escapeHtml(preview)
  const lower = preview.toLowerCase()
  const idx = lower.indexOf(q.toLowerCase())
  if (idx < 0) return escapeHtml(preview)
  return (
    escapeHtml(preview.slice(0, idx)) +
    '<mark>' +
    escapeHtml(preview.slice(idx, idx + q.length)) +
    '</mark>' +
    escapeHtml(preview.slice(idx + q.length))
  )
}

function switchMode(m: 'files' | 'search'): void {
  mode.value = m
  selected.value = 0
  inputEl.value?.focus()
  if (m === 'search') scheduleSearch()
}

function scheduleSearch(): void {
  if (searchTimer) clearTimeout(searchTimer)
  const q = query.value.trim()
  if (!q) {
    searchHits.value = []
    return
  }
  searchTimer = setTimeout(() => void doSearch(), 280)
}

async function doSearch(): Promise<void> {
  const q = query.value.trim()
  if (!q) return
  const seq = ++searchSeq
  searching.value = true
  try {
    const hits = await backend.search(props.repoId, q)
    if (seq !== searchSeq) return
    searchHits.value = hits
    selected.value = 0
  } finally {
    if (seq === searchSeq) searching.value = false
  }
}

function pickFile(path: string): void {
  emit('open', path)
  emit('close')
}

function pickHit(hit: SearchHit): void {
  emit('open', hit.path, hit.nameMatch ? undefined : query.value.trim())
  emit('close')
}

function pickSelected(): void {
  if (mode.value === 'files') {
    const f = fileHits.value[selected.value]
    if (f) pickFile(f)
  } else {
    const h = flatSearch.value[selected.value]
    if (h) pickHit(h)
  }
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    selected.value = Math.min(selected.value + 1, Math.max(totalCount.value - 1, 0))
    scrollSelIntoView()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selected.value = Math.max(selected.value - 1, 0)
    scrollSelIntoView()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (mode.value === 'search' && searchTimer) {
      clearTimeout(searchTimer)
      void doSearch()
      return
    }
    pickSelected()
  } else if (e.key === 'Tab') {
    e.preventDefault()
    switchMode(mode.value === 'files' ? 'search' : 'files')
  }
}

function scrollSelIntoView(): void {
  void nextTick(() => {
    listEl.value?.querySelector(`[data-idx="${selected.value}"]`)?.scrollIntoView({ block: 'nearest' })
  })
}

watch(query, () => {
  selected.value = 0
  if (mode.value === 'search') scheduleSearch()
})

onMounted(() => {
  inputEl.value?.focus()
})

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
})
</script>
