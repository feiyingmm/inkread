<template>
  <div class="editor-wrap">
    <div v-if="loadError" class="editor-error">{{ loadError }}</div>
    <div ref="host" class="editor-host"></div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { errMsg } from '@/core/errmsg'
import Vditor from 'vditor'
import 'vditor/dist/index.css'
import { backend } from '@/core/backend'
import { dirOf } from '@/core/paths'
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
    toast(`保存失败:${errMsg(e)}`, true)
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

/** 粘贴/拖入图片:存入文档同级 assets/ 并插入相对链接 */
async function saveImages(files: File[]): Promise<void> {
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue
    try {
      const dataUrl = await new Promise<string>((ok, err) => {
        const fr = new FileReader()
        fr.onload = () => ok(String(fr.result))
        fr.onerror = err
        fr.readAsDataURL(f)
      })
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
      const ext = (f.type.split('/')[1] ?? 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg')
      const t = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      const name = `img_${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}_${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}_${Math.floor(Math.random() * 90 + 10)}.${ext}`
      const dir = dirOf(props.path)
      const repoRel = `${dir ? dir + '/' : ''}assets/${name}`
      await backend.writeBinary(props.repoId, repoRel, base64)
      vditor?.insertValue(`![](assets/${name})`)
      toast('图片已存入 assets/')
      onInput()
    } catch (e) {
      toast(`图片保存失败:${errMsg(e)}`, true)
    }
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
      // Typora 式纯所见即所得:不显示富文本工具栏,全部经 Markdown 语法与「/」命令输入
      toolbar: [],
      toolbarConfig: { hide: true },
      // 输入「/」唤起块插入菜单(代码块 /json /sql、表格、任务列表等,语雀/Typora 同款习惯)
      hint: {
        delay: 120,
        extend: [
          {
            key: '/',
            hint: (value: string) => {
              const langs = ['json', 'sql', 'java', 'javascript', 'typescript', 'python', 'bash', 'yaml', 'xml', 'html', 'css']
              const items = [
                ...langs.map((l) => ({ value: '```' + l + '\n\n```', html: `代码块 · ${l}` })),
                { value: '```\n\n```', html: '代码块 · 纯文本' },
                { value: '| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n|  |  |  |', html: '表格' },
                { value: '- [ ] ', html: '任务列表' },
                { value: '> ', html: '引用' },
                { value: '---\n', html: '分割线' },
                { value: '$$\n\n$$', html: '数学公式块' },
              ]
              const q = value.toLowerCase()
              return items.filter((i) => !q || i.html.toLowerCase().includes(q) || i.value.toLowerCase().includes(q)).slice(0, 10)
            },
          },
        ],
      },
      counter: { enable: false },
      upload: {
        accept: 'image/*',
        handler: (files: File[]) => {
          void saveImages(files)
          return null
        },
      },
      input: () => onInput(),
      after: () => {
        editorReady = true
        emit('dirty', false)
        emit('ready')
      },
    })
  } catch (e) {
    loadError.value = `编辑器加载失败:${errMsg(e)}`
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
/* Typora 式:无富文本工具栏(toolbarConfig.hide 在部分版本不生效,CSS 兜底) */
:deep(.vditor-toolbar) {
  display: none !important;
}
:deep(.vditor-content) {
  height: 100%;
}
:deep(.vditor-ir .vditor-reset) {
  font-size: var(--prose-size);
  max-width: 52em;
  margin: 0 auto;
  padding: 24px 40px 80px !important;
}
</style>
