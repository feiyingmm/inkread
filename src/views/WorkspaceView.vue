<template>
  <div class="shell">
    <div class="card">
      <aside class="side" :class="{ 'is-closed': !sideOpen }">
        <div class="side-head">
          <div class="side-logo">墨</div>
          <div style="min-width: 0">
            <div class="side-title">墨阅</div>
            <div class="side-repo">{{ repo.currentRepoId || '未选择仓库' }}</div>
          </div>
        </div>
        <div class="side-body">
          <div v-if="repo.error" class="tree-empty">{{ repo.error }}</div>
          <div v-else-if="repo.loading" class="tree-empty">加载中…</div>
          <div v-else-if="repo.tree.length === 0" class="tree-empty">仓库为空</div>
          <FileTree v-else :nodes="repo.tree" :current="currentPath" @open="onOpenNode" />
        </div>
      </aside>

      <main class="main">
        <TopBar
          :repo-name="repo.currentRepoId"
          :path="currentPath"
          :status="repo.status"
          :pulling="repo.pulling"
          :toc-open="tocOpen"
          @toggle-side="sideOpen = !sideOpen"
          @toggle-toc="tocOpen = !tocOpen"
          @pull="doPull"
          @open-settings="settingsOpen = true"
        />
        <div v-if="!currentPath" class="welcome">
          <div class="big">墨阅</div>
          <div class="sub">让每一篇 Markdown 静静展开,如书页般被阅读</div>
          <div class="sub" style="opacity: 0.7">从左侧文库选择一篇文档开始</div>
        </div>
        <MarkdownView
          v-else
          ref="mdView"
          :repo-id="repo.currentRepoId"
          :path="currentPath"
          @toc="toc = $event"
          @active="activeSlug = $event"
          @open="onOpenLink"
          @rendered="onRendered"
        />
      </main>

      <TocPanel :items="toc" :active-slug="activeSlug" :open="tocOpen && toc.length > 0" @jump="onTocJump" />
    </div>

    <SettingsPanel v-if="settingsOpen" @close="settingsOpen = false" />
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

const sideOpen = ref(localStorage.getItem('inkread:side') !== '0')
const tocOpen = ref(localStorage.getItem('inkread:toc') !== '0')
const settingsOpen = ref(false)
const toc = ref<TocItem[]>([])
const activeSlug = ref('')
const mdView = ref<InstanceType<typeof MarkdownView> | null>(null)
let pendingAnchor = ''

const currentPath = computed(() => String(route.query.f ?? ''))

watch(sideOpen, (v) => localStorage.setItem('inkread:side', v ? '1' : '0'))
watch(tocOpen, (v) => localStorage.setItem('inkread:toc', v ? '1' : '0'))

function openFile(path: string, anchor?: string): void {
  pendingAnchor = anchor ?? ''
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
}

function onTocJump(slug: string): void {
  mdView.value?.scrollToSlug(slug)
}

async function doPull(): Promise<void> {
  const r = await repo.pull()
  toast(r.message, !r.ok)
}

function onKeydown(e: KeyboardEvent): void {
  if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
    e.preventDefault()
    sideOpen.value = !sideOpen.value
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
