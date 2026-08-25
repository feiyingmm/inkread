<template>
  <div class="topbar">
    <button class="tbtn" title="文库 (Ctrl+B)" @click="emit('toggle-side')">☰</button>
    <button class="tbtn" title="后退 (Alt+←)" :disabled="!canBack" @click="emit('back')">←</button>
    <button class="tbtn" title="前进 (Alt+→)" :disabled="!canForward" @click="emit('forward')">→</button>
    <button class="tbtn" title="搜索 (Ctrl+P 文件 / Ctrl+Shift+F 全文)" @click="emit('open-palette')">🔍</button>
    <div class="crumbs">
      <span class="seg">{{ repoName }}</span>
      <template v-for="(seg, i) in segments" :key="i">
        <span class="sep">/</span>
        <button
          v-if="i < segments.length - 1"
          class="seg seg-link"
          title="在文库中定位该目录"
          @click="emit('crumb', segments.slice(0, i + 1).join('/'))"
        >
          {{ seg }}
        </button>
        <span v-else class="seg">{{ seg }}</span>
      </template>
    </div>

    <button
      v-if="editMode"
      class="tbtn save-btn"
      :class="{ 'is-on': dirty }"
      :title="dirty ? '有未保存修改 (Ctrl+S)' : '已保存'"
      @click="emit('save')"
    >
      {{ dirty ? '● 保存' : '已保存' }}
    </button>
    <div v-if="canEdit" class="seg-group">
      <button :class="{ 'is-on': !editMode }" title="阅读视图 (Ctrl+E)" @click="emit('set-edit', false)">阅读</button>
      <button :class="{ 'is-on': editMode }" title="编辑模式 (Ctrl+E)" @click="emit('set-edit', true)">编辑</button>
    </div>

    <button
      class="tbtn hide-narrow"
      :class="{ 'is-on': settings.width === 'wide' }"
      :title="settings.width === 'book' ? '展开宽页显示' : '收窄为书卷版心'"
      @click="settings.width = settings.width === 'book' ? 'wide' : 'book'"
    >
      ⇔
    </button>
    <button class="tbtn" :title="modeTitle" @click="cycleMode()">{{ modeIcon }}</button>
    <button class="tbtn" title="拉取最新 (git pull)" :disabled="pulling" @click="emit('pull')">
      <span :class="{ spin: pulling }">⟳</span>
    </button>
    <button
      v-if="canEdit && !editMode"
      class="tbtn"
      :class="{ 'is-on': sourceMode }"
      :title="sourceMode ? '返回渲染视图 (Ctrl+/)' : '查看 Markdown 源码 (Ctrl+/)'"
      @click="emit('toggle-source')"
    >
      &lt;/&gt;
    </button>
    <div v-if="canEdit && !editMode" style="position: relative">
      <button class="tbtn" title="导出" @click="exportOpen = !exportOpen">⤓</button>
      <template v-if="exportOpen">
        <div class="repo-menu-mask" @click="exportOpen = false"></div>
        <div class="export-menu">
          <button class="repo-item" @click="doExport('html')">导出 HTML(自包含)</button>
          <button class="repo-item" @click="doExport('print')">打印 / 另存 PDF</button>
        </div>
      </template>
    </div>
    <button class="tbtn hide-narrow" title="大纲" :class="{ 'is-on': tocOpen }" @click="emit('toggle-toc')">☰›</button>
    <button class="tbtn" title="设置" @click="emit('open-settings')">⚙</button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSettings } from '@/stores/settings'

const props = defineProps<{
  repoName: string
  path: string
  pulling: boolean
  tocOpen: boolean
  canBack: boolean
  canForward: boolean
  canEdit: boolean
  editMode: boolean
  dirty: boolean
  sourceMode: boolean
}>()

const emit = defineEmits<{
  'toggle-side': []
  'toggle-toc': []
  pull: []
  'open-settings': []
  back: []
  forward: []
  'open-palette': []
  'set-edit': [on: boolean]
  save: []
  'toggle-source': []
  export: [type: 'html' | 'print']
  crumb: [dirPath: string]
}>()

const exportOpen = ref(false)

function doExport(type: 'html' | 'print'): void {
  exportOpen.value = false
  emit('export', type)
}

const settings = useSettings()

const segments = computed(() => (props.path ? props.path.split('/') : []))

const modeIcon = computed(() => (settings.mode === 'auto' ? '◐' : settings.mode === 'light' ? '☀' : '☾'))
const modeTitle = computed(
  () => `明暗模式:${settings.mode === 'auto' ? '跟随系统' : settings.mode === 'light' ? '浅色' : '深色'}(点击切换)`,
)

function cycleMode(): void {
  settings.mode = settings.mode === 'auto' ? 'light' : settings.mode === 'light' ? 'dark' : 'auto'
}
</script>
