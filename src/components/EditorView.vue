<template>
  <div class="editor-wrap">
    <div v-if="loadError" class="editor-error">{{ loadError }}</div>
    <div ref="host" class="editor-host"></div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Vditor from 'vditor'
import 'vditor/dist/index.css'
import { backend } from '@/core/backend'
import { useSettings } from '@/stores/settings'
import { toast } from '@/core/toast'

const props = defineProps<{
  repoId: string
  path: string
}>()

const emit = defineEmits<{
  saved: []
  ready: []
  dirty: [dirty: boolean]
}>()

const settings = useSettings()
const host = ref<HTMLElement | null>(null)
const loadError = ref('')

let vditor: Vditor | null = null
let original = ''
let editorReady = false
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null

function isDirty(): boolean {
  if (!vditor || !editorReady) return false
  return vditor.getValue() !== original
}

async function save(silent = false): Promise<boolean> {
  if (!vditor || !editorReady) return false
  const value = vditor.getValue()
  if (value === original) return true
  try {
    await backend.writeFile(props.repoId, props.path, value)
    original = value
    emit('dirty', false)
    if (!silent) toast('已保存')
    emit('saved')
    return true
  } catch (e) {
    toast(`保存失败:${(e as Error).message}`, true)
    return false
  }
}

function onInput(): void {
  emit('dirty', isDirty())
  if (settings.autoSave) {
    if (autoSaveTimer) clearTimeout(autoSaveTimer)
    autoSaveTimer = setTimeout(() => void save(true), 2000)
  }
}

onMounted(async () => {
  try {
    const file = await backend.readFile(props.repoId, props.path)
    original = file.content
    vditor = new Vditor(host.value as HTMLElement, {
      mode: 'ir',
      cdn: '/vditor',
      value: file.content,
      height: '100%',
      theme: settings.isDark ? 'dark' : 'classic',
      icon: 'material',
      cache: { enable: false },
      preview: {
        theme: { current: settings.isDark ? 'dark' : 'light', path: '/vditor/dist/css/content-theme' },
        hljs: { lineNumber: false },
        math: { engine: 'KaTeX' },
      },
      toolbar: [
        'headings', 'bold', 'italic', 'strike', 'link', '|',
        'list', 'ordered-list', 'check', '|',
        'quote', 'code', 'inline-code', 'table', '|',
        'undo', 'redo', 'outline',
      ],
      counter: { enable: false },
      input: () => onInput(),
      after: () => {
        editorReady = true
        emit('dirty', false)
        emit('ready')
      },
    })
  } catch (e) {
    loadError.value = `编辑器加载失败:${(e as Error).message}`
  }
})

watch(
  () => settings.isDark,
  (dark) => {
    vditor?.setTheme(dark ? 'dark' : 'classic', dark ? 'dark' : 'light')
  },
)

onBeforeUnmount(() => {
  if (autoSaveTimer) clearTimeout(autoSaveTimer)
  try {
    vditor?.destroy()
  } catch {
    /* vditor 未完成初始化时 destroy 可能报错,忽略 */
  }
  vditor = null
})

defineExpose({ save, isDirty })
</script>

<style scoped>
.editor-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.editor-host {
  flex: 1;
  min-height: 0;
}
.editor-error {
  padding: 20px;
  color: var(--t2);
  font-size: 14px;
}
:deep(.vditor) {
  border: none;
  border-radius: 0;
}
:deep(.vditor-toolbar) {
  background: var(--bg-side);
  border-bottom: 1px solid var(--line);
  padding-left: 18px !important;
}
:deep(.vditor-ir .vditor-reset) {
  font-size: var(--prose-size);
  max-width: 52em;
  margin: 0 auto;
  padding: 24px 40px 80px !important;
}
</style>
