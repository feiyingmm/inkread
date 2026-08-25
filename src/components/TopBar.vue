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
        <span class="seg">{{ seg }}</span>
      </template>
    </div>

    <div v-if="canEdit" class="seg-group">
      <button :class="{ 'is-on': !editMode }" title="阅读视图 (Ctrl+E)" @click="emit('set-edit', false)">阅读</button>
      <button :class="{ 'is-on': editMode }" title="编辑模式 (Ctrl+E)" @click="emit('set-edit', true)">编辑</button>
    </div>

    <button
      class="tbtn"
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
    <button class="tbtn" title="大纲" :class="{ 'is-on': tocOpen }" @click="emit('toggle-toc')">☰›</button>
    <button class="tbtn" title="设置" @click="emit('open-settings')">⚙</button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
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
}>()

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
