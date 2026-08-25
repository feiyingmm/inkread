<template>
  <div class="shell">
    <div class="card">
      <div v-if="sideOpen && isNarrow" class="side-mask" @click="sideOpen = false"></div>
      <aside class="side" :class="{ 'is-closed': !sideOpen }" :style="sideStyle">
        <div class="side-head">
          <div class="side-logo">墨</div>
          <button class="repo-switch" title="切换 / 添加文库" @click="repoMenuOpen = !repoMenuOpen">
            <div class="side-title">墨阅</div>
            <div class="side-repo">{{ repo.currentRepoId || '添加文库…' }} <span class="repo-caret">▾</span></div>
          </button>
          <button class="side-close" title="收起文库" @click="sideOpen = false">×</button>
          <template v-if="repoMenuOpen">
            <div class="repo-menu-mask" @click="repoMenuOpen = false"></div>
            <div class="repo-menu">
              <div class="repo-menu-label">文库</div>
              <button
                v-for="r in repo.repos"
                :key="r.id"
                class="repo-item"
                :class="{ 'is-on': r.id === repo.currentRepoId }"
                @click="switchRepo(r.id)"
              >
                {{ r.name }}<span v-if="r.id === repo.currentRepoId" class="repo-check">✓</span>
              </button>
              <div class="repo-menu-sep"></div>
              <button v-if="!isAndroid" class="repo-item" @click="onAddLocal">＋ 添加本地仓库…</button>
              <button class="repo-item" @click="onAddClone">⇩ 克隆远程仓库…</button>
            </div>
          </template>
        </div>
        <div class="side-body">
          <div v-if="repo.error" class="tree-empty">{{ repo.error }}</div>
          <div v-else-if="repo.loading" class="tree-empty">加载中…</div>
          <div v-else-if="repo.tree.length === 0" class="tree-empty">仓库为空</div>
          <FileTree v-else :nodes="repo.tree" :current="currentPath" @open="onOpenNode" />
        </div>
      </aside>

      <main class="main">
        <div
          v-if="sideOpen && !isNarrow"
          class="resizer resizer--left"
          :class="{ 'is-active': resizing === 'side' }"
          title="拖动调整文库宽度"
          @mousedown="startResize('side', $event)"
        ></div>
        <div
          v-if="tocOpen && toc.length > 0 && !isNarrow"
          class="resizer resizer--right"
          :class="{ 'is-active': resizing === 'toc' }"
          title="拖动调整大纲宽度"
          @mousedown="startResize('toc', $event)"
        ></div>
        <TopBar
          :repo-name="repo.currentRepoId"
          :path="currentPath"
          :pulling="repo.pulling"
          :toc-open="tocOpen"
          :can-back="canBack"
          :can-forward="canForward"
          :can-edit="canEdit"
          :edit-mode="editMode"
          :dirty="editorDirty"
          @toggle-side="sideOpen = !sideOpen"
          @toggle-toc="tocOpen = !tocOpen"
          @pull="doPull"
          @open-settings="settingsOpen = true"
          @back="router.back()"
          @forward="router.forward()"
          @open-palette="openPalette('files')"
          @set-edit="setEdit"
          @save="editorRef?.save()"
        />
        <div v-if="!currentPath" class="welcome">
          <div class="big">墨阅</div>
          <div class="sub">让每一篇 Markdown 静静展开,如书页般被阅读</div>
          <div v-if="repo.repos.length === 0 && isTauri" class="sub" style="display: flex; gap: 10px">
            <button v-if="!isAndroid" class="opt" style="height: 36px; font-size: 13.5px" @click="pickLocalRepo">
              添加本地 git 仓库…
            </button>
            <button class="opt is-on" style="height: 36px; font-size: 13.5px" @click="cloneOpen = true">
              克隆远程仓库…
            </button>
          </div>
          <div v-else class="sub" style="opacity: 0.7">从左侧文库选择一篇文档开始</div>
        </div>
        <MarkdownView
          v-else-if="!editMode"
          ref="mdView"
          :repo-id="repo.currentRepoId"
          :path="currentPath"
          @toc="toc = $event"
          @active="activeSlug = $event"
          @open="onOpenLink"
          @rendered="onRendered"
        />
        <EditorView
          v-else
          ref="editorRef"
          :repo-id="repo.currentRepoId"
          :path="currentPath"
          @saved="onEditorSaved"
          @dirty="editorDirty = $event"
        />
        <StatusBar
          :status="repo.status"
          :syncing="syncing"
          :edit-mode="editMode"
          :auto-save="settings.autoSave"
          @sync="doSync"
        />
      </main>

      <TocPanel
        :items="toc"
        :active-slug="activeSlug"
        :open="tocOpen && toc.length > 0"
        :style="tocStyle"
        @jump="onTocJump"
      />
    </div>

    <SettingsPanel v-if="settingsOpen" @close="settingsOpen = false" />
    <Palette
      v-if="paletteOpen"
      :repo-id="repo.currentRepoId"
      :tree="repo.tree"
      :initial-mode="paletteMode"
      @close="paletteOpen = false"
      @open="onPaletteOpen"
    />
    <SyncIssueDialog
      v-if="issueMode"
      :mode="issueMode"
      :detail="issueDetail"
      @close="issueMode = ''"
      @discard="onDiscardLocal"
    />
    <CloneDialog v-if="cloneOpen" @close="cloneOpen = false" @done="onCloneDone" />

    <button
      v-if="isNarrow && !editMode && currentPath && toc.length > 0"
      class="fab-toc"
      title="目录"
      @click="tocSheetOpen = true"
    >
      ☰
    </button>
    <MobileTocSheet
      v-if="tocSheetOpen"
      :items="toc"
      :active-slug="activeSlug"
      @jump="onTocJump"
      @close="tocSheetOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import FileTree from '@/components/FileTree.vue'
import TopBar from '@/components/TopBar.vue'
import TocPanel from '@/components/TocPanel.vue'
import MarkdownView from '@/components/MarkdownView.vue'
import SettingsPanel from '@/components/SettingsPanel.vue'
import Palette from '@/components/Palette.vue'
import EditorView from '@/components/EditorView.vue'
import StatusBar from '@/components/StatusBar.vue'
import SyncIssueDialog from '@/components/SyncIssueDialog.vue'
import CloneDialog from '@/components/CloneDialog.vue'
import MobileTocSheet from '@/components/MobileTocSheet.vue'
import { backend, isTauri } from '@/core/backend'
import { useRepoStore } from '@/stores/repo'
import { useSettings } from '@/stores/settings'
import { dirOf, fileKind } from '@/core/paths'
import { resolvePath } from '@/core/paths'
import type { TocItem } from '@/core/markdown/pipeline'
import type { TreeNode } from '@/core/backend'
import { toast } from '@/core/toast'

const route = useRoute()
const router = useRouter()
const repo = useRepoStore()
const settings = useSettings()

const sideOpen = ref(window.matchMedia('(max-width: 900px)').matches ? false : localStorage.getItem('inkread:side') !== '0')
const tocOpen = ref(localStorage.getItem('inkread:toc') !== '0')
const settingsOpen = ref(false)
const paletteOpen = ref(false)
const paletteMode = ref<'files' | 'search'>('files')
const canBack = ref(false)
const canForward = ref(false)
const toc = ref<TocItem[]>([])
const activeSlug = ref('')
const mdView = ref<InstanceType<typeof MarkdownView> | null>(null)
const editorRef = ref<InstanceType<typeof EditorView> | null>(null)
const editMode = ref(false)
const editorDirty = ref(false)
const syncing = ref(false)
const issueMode = ref<'' | 'pull' | 'push'>('')
const issueDetail = ref('')
const cloneOpen = ref(false)
let pendingAnchor = ''
let pendingHighlight = ''

const isAndroid = /android/i.test(navigator.userAgent)
const narrowMq = window.matchMedia('(max-width: 900px)')
const isNarrow = ref(narrowMq.matches)
narrowMq.addEventListener('change', (e) => (isNarrow.value = e.matches))
const tocSheetOpen = ref(false)

const currentPath = computed(() => String(route.query.f ?? ''))
// 手机端纯阅读:Android 上不提供编辑入口
const canEdit = computed(() => fileKind(currentPath.value) === 'markdown' && !isAndroid)

function setEdit(on: boolean): void {
  if (on) {
    if (canEdit.value) editMode.value = true
    return
  }
  if (editMode.value && editorRef.value?.isDirty()) {
    if (!window.confirm('有未保存的修改,放弃并返回阅读视图?')) return
  }
  editMode.value = false
}

function onEditorSaved(): void {
  repo.refreshStatus()
}

async function doSync(): Promise<void> {
  if (syncing.value) return
  syncing.value = true
  try {
    const files = repo.status?.dirtyFiles ?? []
    const msg = files.length
      ? `docs: 更新 ${files.slice(0, 3).join('、')}${files.length > 3 ? ` 等 ${repo.status?.dirtyCount ?? files.length} 处` : ''}`
      : 'docs: 更新文档'
    const r = await backend.gitSync(repo.currentRepoId, msg)
    if (r.conflict) {
      issueDetail.value = r.message
      issueMode.value = 'push'
    } else {
      toast(r.message, !r.ok)
    }
  } catch (e) {
    toast(`同步失败:${(e as Error).message}`, true)
  } finally {
    syncing.value = false
    repo.refreshStatus()
  }
}

async function pickLocalRepo(): Promise<void> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const dir = await open({ directory: true, title: '选择本地 git 仓库目录' })
    if (typeof dir !== 'string' || !dir) return
    const added = await backend.addRepoLocal(dir)
    await repo.init()
    await switchRepo(added.id)
  } catch (e) {
    toast((e as Error).message, true)
  }
}

const repoMenuOpen = ref(false)

// ---- 侧栏宽度拖拽 ----
const sideWidth = ref(Number(localStorage.getItem('inkread:sidew')) || 264)
const tocWidth = ref(Number(localStorage.getItem('inkread:tocw')) || 232)
const resizing = ref<'' | 'side' | 'toc'>('')

const sideStyle = computed(() =>
  sideOpen.value && !isNarrow.value
    ? { width: `${sideWidth.value}px`, transition: resizing.value === 'side' ? 'none' : undefined }
    : undefined,
)
const tocStyle = computed(() =>
  tocOpen.value && toc.value.length > 0 && !isNarrow.value
    ? { width: `${tocWidth.value}px`, transition: resizing.value === 'toc' ? 'none' : undefined }
    : undefined,
)

function startResize(which: 'side' | 'toc', e: MouseEvent): void {
  e.preventDefault()
  resizing.value = which
  const startX = e.clientX
  const startW = which === 'side' ? sideWidth.value : tocWidth.value
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
  const onMove = (ev: MouseEvent) => {
    const delta = ev.clientX - startX
    if (which === 'side') sideWidth.value = clamp(startW + delta, 180, 480)
    else tocWidth.value = clamp(startW - delta, 160, 420)
  }
  const onUp = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    resizing.value = ''
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    localStorage.setItem('inkread:sidew', String(sideWidth.value))
    localStorage.setItem('inkread:tocw', String(tocWidth.value))
  }
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

async function switchRepo(id: string): Promise<void> {
  repoMenuOpen.value = false
  if (id === repo.currentRepoId) return
  if (editMode.value) {
    if (editorRef.value?.isDirty() && !window.confirm('有未保存的修改,放弃并切换文库?')) return
    editMode.value = false
  }
  await repo.setCurrent(id)
  await router.replace({ query: {} })
  if (repo.exists('INDEX.md')) openFile('INDEX.md')
}

function onAddLocal(): void {
  repoMenuOpen.value = false
  if (!isTauri) {
    toast('开发模式请编辑 dev-server/repos.local.json 后刷新', true)
    return
  }
  void pickLocalRepo()
}

function onAddClone(): void {
  repoMenuOpen.value = false
  if (!isTauri) {
    toast('开发模式请编辑 dev-server/repos.local.json 后刷新', true)
    return
  }
  cloneOpen.value = true
}

async function onCloneDone(repoId: string): Promise<void> {
  await repo.init()
  await switchRepo(repoId)
}

/** 用户确认放弃本地修改:强制与远端一致,并刷新树与当前文档 */
async function onDiscardLocal(): Promise<void> {
  issueMode.value = ''
  try {
    const r = await backend.gitPullForce(repo.currentRepoId)
    toast(r.message, !r.ok)
    if (r.ok) {
      editMode.value = false
      await repo.refresh()
      mdView.value?.reload()
    }
  } catch (e) {
    toast(`操作失败:${(e as Error).message}`, true)
  } finally {
    repo.refreshStatus()
  }
}

watch(
  () => route.fullPath,
  () => {
    const st = window.history.state as { back?: unknown; forward?: unknown } | null
    canBack.value = !!st?.back
    canForward.value = !!st?.forward
  },
  { immediate: true },
)

function openPalette(mode: 'files' | 'search'): void {
  paletteMode.value = mode
  paletteOpen.value = true
}

function onPaletteOpen(path: string, highlight?: string): void {
  pendingHighlight = highlight ?? ''
  if (path === currentPath.value) {
    if (pendingHighlight) {
      mdView.value?.highlightText(pendingHighlight)
      pendingHighlight = ''
    }
    return
  }
  openFile(path)
}

watch(sideOpen, (v) => localStorage.setItem('inkread:side', v ? '1' : '0'))
watch(tocOpen, (v) => localStorage.setItem('inkread:toc', v ? '1' : '0'))

function openFile(path: string, anchor?: string): void {
  if (editMode.value) {
    if (editorRef.value?.isDirty() && !window.confirm('有未保存的修改,放弃并打开其他文档?')) return
    editMode.value = false
  }
  pendingAnchor = anchor ?? ''
  if (isNarrow.value) sideOpen.value = false
  if (path === currentPath.value) {
    if (pendingAnchor) {
      mdView.value?.scrollToSlug(pendingAnchor)
      pendingAnchor = ''
    }
    return
  }
  void router.push({ query: { ...route.query, f: path } })
}

function onOpenNode(node: TreeNode): void {
  if (fileKind(node.path) === 'other') {
    toast('暂不支持打开该类型文件', true)
    return
  }
  openFile(node.path)
}

function onOpenLink(rel: string, anchor?: string): void {
  const resolved = resolvePath(dirOf(currentPath.value), rel)
  if (!repo.exists(resolved)) {
    toast(`目标文件不存在:${resolved}`, true)
    return
  }
  openFile(resolved, anchor)
}

function onRendered(): void {
  if (pendingAnchor) {
    const slug = pendingAnchor
    pendingAnchor = ''
    setTimeout(() => mdView.value?.scrollToSlug(slug), 60)
  }
  if (pendingHighlight) {
    const q = pendingHighlight
    pendingHighlight = ''
    setTimeout(() => mdView.value?.highlightText(q), 80)
  }
}

function onTocJump(slug: string): void {
  mdView.value?.scrollToSlug(slug)
}

async function doPull(): Promise<void> {
  const r = await repo.pull()
  if (!r.ok && r.divergent) {
    issueDetail.value = r.message
    issueMode.value = 'pull'
    return
  }
  toast(r.message, !r.ok)
}

function onKeydown(e: KeyboardEvent): void {
  const key = e.key.toLowerCase()
  if (e.ctrlKey && !e.shiftKey && !e.altKey && key === 'b') {
    e.preventDefault()
    sideOpen.value = !sideOpen.value
  } else if (e.ctrlKey && !e.shiftKey && !e.altKey && key === 'p') {
    e.preventDefault()
    openPalette('files')
  } else if (e.ctrlKey && e.shiftKey && !e.altKey && key === 'f') {
    e.preventDefault()
    openPalette('search')
  } else if (e.ctrlKey && !e.shiftKey && !e.altKey && key === 'e') {
    e.preventDefault()
    if (canEdit.value) setEdit(!editMode.value)
  } else if (e.ctrlKey && !e.shiftKey && !e.altKey && key === 's') {
    if (editMode.value) {
      e.preventDefault()
      void editorRef.value?.save()
    }
  } else if (e.altKey && e.key === 'ArrowLeft') {
    e.preventDefault()
    router.back()
  } else if (e.altKey && e.key === 'ArrowRight') {
    e.preventDefault()
    router.forward()
  } else if (e.key === 'Escape' && paletteOpen.value) {
    paletteOpen.value = false
  } else if (e.key === 'Escape' && settingsOpen.value) {
    settingsOpen.value = false
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  await repo.init()
  if (!currentPath.value && repo.exists('INDEX.md')) {
    openFile('INDEX.md')
  }
  if (settings.autoPull && repo.currentRepoId) {
    const r = await repo.pull()
    if (r.ok && r.changed) toast('文档已更新到最新')
    else if (!r.ok) toast(`自动拉取失败:${r.message}`, true)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>
