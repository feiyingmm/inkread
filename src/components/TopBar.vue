<template>
  <div class="topbar">
    <button class="tbtn" title="文库 (Ctrl+B)" @click="emit('toggle-side')"><Icon name="menu" /></button>
    <button class="tbtn" title="后退 (Alt+←)" :disabled="!canBack" @click="emit('back')"><Icon name="back" /></button>
    <button class="tbtn" title="前进 (Alt+→)" :disabled="!canForward" @click="emit('forward')"><Icon name="forward" /></button>
    <button class="tbtn" title="搜索 (Ctrl+P 文件 / Ctrl+Shift+F 全文)" @click="emit('open-palette')"><Icon name="search" /></button>
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
      <Icon name="save" :size="16" /><span class="save-txt">{{ dirty ? '保存' : '已存' }}</span>
    </button>
    <div v-if="canEdit" class="seg-group">
      <button :class="{ 'is-on': !editMode }" title="阅读视图 (Ctrl+E)" @click="emit('set-edit', false)">阅读</button>
      <button :class="{ 'is-on': editMode }" title="编辑模式 (Ctrl+E)" @click="emit('set-edit', true)">编辑</button>
    </div>
    <button
      v-if="canEdit && !editMode"
      class="tbtn hide-narrow"
      :class="{ 'is-on': sourceMode }"
      :title="sourceMode ? '返回渲染视图 (Ctrl+/)' : '查看 Markdown 源码 (Ctrl+/)'"
      @click="emit('toggle-source')"
    >
      <Icon name="code" />
    </button>
    <div v-if="canEdit && !editMode" class="hide-narrow" style="position: relative">
      <button class="tbtn" title="导出" @click="exportOpen = !exportOpen"><Icon name="export" /></button>
      <template v-if="exportOpen">
        <div class="repo-menu-mask" @click="exportOpen = false"></div>
        <div class="export-menu">
          <button class="repo-item" @click="doExport('html')">导出 HTML(自包含)</button>
          <button class="repo-item" @click="doExport('print')">打印 / 另存 PDF</button>
        </div>
      </template>
    </div>
    <button
      class="tbtn hide-narrow"
      :class="{ 'is-on': settings.width === 'wide' }"
      :title="settings.width === 'book' ? '展开宽页显示' : '收窄为书卷版心'"
      @click="settings.width = settings.width === 'book' ? 'wide' : 'book'"
    >
      <Icon name="width" />
    </button>
    <button class="tbtn hide-narrow" title="大纲" :class="{ 'is-on': tocOpen }" @click="emit('toggle-toc')">
      <Icon name="toc" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSettings } from '@/stores/settings'
import Icon from '@/components/Icon.vue'

const props = defineProps<{
  repoName: string
  path: string
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
  back: []
  forward: []
  'open-palette': []
  'set-edit': [on: boolean]
  save: []
  'toggle-source': []
  export: [type: 'html' | 'print']
  crumb: [dirPath: string]
}>()

const settings = useSettings()

const segments = computed(() => (props.path ? props.path.split('/') : []))

const exportOpen = ref(false)

function doExport(type: 'html' | 'print'): void {
  exportOpen.value = false
  emit('export', type)
}
</script>
