<template>
  <div class="editor-wrap">
    <div v-if="loadError" class="editor-error">{{ loadError }}</div>

    <!-- 查找 / 替换(Ctrl+F / Ctrl+H);浮在编辑区右上角,不挤走正文 -->
    <div v-if="findOpen" class="fr-bar">
      <div class="fr-row">
        <input
          ref="findInputEl"
          v-model="findQuery"
          class="fr-input"
          placeholder="查找"
          spellcheck="false"
          @keydown.enter.exact.prevent="stepHit(1)"
          @keydown.enter.shift.prevent="stepHit(-1)"
        />
        <span class="fr-count" :class="{ 'is-none': findQuery && hits.length === 0 }">
          {{ findQuery ? (hits.length ? `${hitIdx + 1}/${hits.length}` : '无结果') : '' }}
        </span>
        <button class="fr-btn fr-btn--txt" :class="{ 'is-on': caseSensitive }" title="区分大小写" @click="toggleCase">
          Aa
        </button>
        <button class="fr-btn" title="上一处 (Shift+Enter)" :disabled="hits.length === 0" @click="stepHit(-1)">
          <Icon name="chevron-up" :size="15" />
        </button>
        <button class="fr-btn" title="下一处 (Enter)" :disabled="hits.length === 0" @click="stepHit(1)">
          <Icon name="chevron-down" :size="15" />
        </button>
        <button
          class="fr-btn fr-btn--txt"
          :class="{ 'is-on': replaceOpen }"
          title="替换 (Ctrl+H)"
          @click="toggleReplace"
        >
          替换
        </button>
        <button class="fr-btn" title="关闭 (Esc)" @click="closeFind"><Icon name="close" :size="15" /></button>
      </div>
      <div v-if="replaceOpen" class="fr-row">
        <input
          ref="replaceInputEl"
          v-model="replaceText"
          class="fr-input"
          placeholder="替换为"
          spellcheck="false"
          @keydown.enter.prevent="doReplaceOne"
        />
        <button class="fr-btn fr-btn--txt" :disabled="hits.length === 0" @click="doReplaceOne">替换本处</button>
        <button class="fr-btn fr-btn--txt" :disabled="hits.length === 0" @click="doReplaceAll">全部替换</button>
      </div>
    </div>

    <div ref="host" class="editor-host"></div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { errMsg } from '@/core/errmsg'
import Vditor from 'vditor'
import 'vditor/dist/index.css'
import { backend } from '@/core/backend'
import { dirOf } from '@/core/paths'
import { useSettings } from '@/stores/settings'
import { toast } from '@/core/toast'
import { useBackLayerWhen } from '@/core/backstack'
import { extractHeadings } from '@/core/markdown/headings'
import { formatJsonFences } from '@/core/json-format'
import { findAll, replaceAll, replaceAt } from '@/core/find-replace'
import { docStats, type DocStats } from '@/core/doc-stats'
import Icon from '@/components/Icon.vue'
import type { TocItem } from '@/core/markdown/pipeline'

const props = defineProps<{
  repoId: string
  path: string
}>()

const emit = defineEmits<{
  saved: []
  ready: []
  dirty: [dirty: boolean]
  toc: [items: TocItem[]]
  active: [slug: string]
  stats: [stats: DocStats]
}>()

const settings = useSettings()
const host = ref<HTMLElement | null>(null)
const loadError = ref('')

let vditor: Vditor | null = null
let original = ''
let editorReady = false
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null
let tocTimer: ReturnType<typeof setTimeout> | null = null

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
  if (tocTimer) clearTimeout(tocTimer)
  tocTimer = setTimeout(() => {
    refreshToc()
    refreshStats()
    // 改过内容,命中位置与高亮都得重算(查找条开着时)
    refreshFind()
  }, 400)
}

/** 底部状态条的字数 / 行数(选中时报选中量) */
function refreshStats(): void {
  if (!vditor) return
  emit('stats', docStats(vditor.getValue(), vditor.getSelection()))
}

let selTimer: ReturnType<typeof setTimeout> | null = null

/** 拖选文字也要更新"选中 N 字",光标移动不改内容却要改数字,只能听 selectionchange */
function onSelectionChange(): void {
  if (selTimer) clearTimeout(selTimer)
  selTimer = setTimeout(refreshStats, 150)
}

// ---------- 大纲联动(编辑视图) ----------
// 阅读视图的大纲是渲染时顺手收的;编辑视图没有渲染这一步,改用扫源码取标题,
// 点击时按"第几个标题"落到编辑区里对应的 h 元素上。
let tocItems: TocItem[] = []
let tocKey = ''

function refreshToc(): void {
  if (!vditor) return
  const items = extractHeadings(vditor.getValue())
  const key = items.map((t) => `${t.level}:${t.slug}`).join('|')
  // 标题没变就不往上抛 —— 每次敲键都换一个新数组会把大纲的折叠状态冲掉
  if (key === tocKey) return
  tocKey = key
  tocItems = items
  emit('toc', items)
}

/** IR 模式下真正在滚的是 div.vditor-ir 里那个 pre.vditor-reset */
function scrollerEl(): HTMLElement | null {
  return host.value?.querySelector<HTMLElement>('.vditor-ir > .vditor-reset') ?? null
}

/**
 * 拿来做"这个 h 元素是不是那个标题"的比对键。
 * IR 模式把 markdown 标记原样显示(`## 标题`、`` `代码` ``、`**粗**`),而大纲里的
 * 标题是纯文字,所以两边都把标记去掉再比。
 */
function matchKey(text: string): string {
  return text
    .replace(/^\s*#+\s*/, '')
    .replace(/\s*#+\s*$/, '')
    .replace(/[`*~_]/g, '')
    .replace(/\s+/g, '')
}

/** 编辑区里的标题元素(按文档顺序) */
function headingEls(): { el: HTMLElement; key: string }[] {
  const root = scrollerEl()
  if (!root) return []
  return Array.from(root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6'))
    .filter((el) => !el.closest('.vditor-ir__preview, pre.vditor-ir__marker--pre'))
    .map((el) => ({ el, key: matchKey(el.textContent ?? '') }))
}

/** 大纲点击:滚到对应标题并闪一下(不移动光标,免得手一抖就打在别处) */
function scrollToSlug(slug: string): void {
  const scroller = scrollerEl()
  const idx = tocItems.findIndex((t) => t.slug === slug)
  if (!scroller || idx < 0) return
  const els = headingEls()
  const key = matchKey(tocItems[idx].title)
  let target = els[idx]?.el
  // 源码扫出来的标题数与 DOM 里对不上时(古怪 markdown),退化成按标题文字找第 k 个同名的
  if (!target || (key && els[idx].key !== key)) {
    const k = tocItems.slice(0, idx).filter((t) => matchKey(t.title) === key).length
    target = els.filter((h) => h.key === key)[k]?.el ?? target
  }
  if (!target) return
  const top = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 12
  scroller.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  target.classList.remove('ink-jump-flash')
  // 强制重排,连点同一项也能再闪一次
  void target.offsetWidth
  target.classList.add('ink-jump-flash')
  setTimeout(() => target?.classList.remove('ink-jump-flash'), 1000)
}

let activeRaf = 0

/** 滚动时回报"当前读到哪个标题",大纲跟着高亮(与阅读视图同款行为) */
function onEditorScroll(): void {
  if (activeRaf) return
  activeRaf = requestAnimationFrame(() => {
    activeRaf = 0
    const scroller = scrollerEl()
    const els = headingEls()
    if (!scroller || els.length === 0) return
    const base = scroller.getBoundingClientRect().top + 60
    let hit = 0
    for (let i = 0; i < els.length; i++) {
      if (els[i].el.getBoundingClientRect().top <= base) hit = i
      else break
    }
    const slug = tocItems[hit]?.slug
    if (slug) emit('active', slug)
  })
}

/**
 * 整篇重设内容(格式化 JSON、替换都走这里)。
 * setValue 自带 undo 栈,Ctrl+Z 可整体撤回;但它 enableInput:false,
 * 脏标记、大纲、滚动位置得自己补。
 */
function applyValue(next: string): void {
  if (!vditor) return
  const scroller = scrollerEl()
  const keep = scroller?.scrollTop ?? 0
  vditor.setValue(next)
  if (scroller) scroller.scrollTop = keep
  onInput()
  refreshToc()
}

/** 一键格式化文中所有 ```json 代码块(接口文档里粘进来的压缩报文最需要) */
function formatJsonBlocks(): void {
  if (!vditor || !editorReady) return
  const src = vditor.getValue()
  const r = formatJsonFences(src)
  if (r.done === 0 && r.failed === 0) {
    toast('文中没有 json 代码块', true)
    return
  }
  if (r.text === src) {
    toast(r.failed > 0 ? `${r.failed} 个 json 代码块不是合法 JSON,未改动` : 'json 代码块已经是格式化的了')
    return
  }
  applyValue(r.text)
  toast(r.failed > 0 ? `已格式化 ${r.done} 个 JSON 代码块,${r.failed} 个不合法已跳过` : `已格式化 ${r.done} 个 JSON 代码块`)
}

// ---------- 查找 / 替换 ----------
// 计数与替换一律以 Markdown 源码为准(见 core/find-replace.ts);高亮定位在 DOM 上做,
// 只借用"第几处"这个序号 —— 编辑器 DOM 里代码块/公式还带一份渲染副本,直接按 DOM 数会串位。
const findOpen = ref(false)
const replaceOpen = ref(false)
const findQuery = ref('')
const replaceText = ref('')
const caseSensitive = ref(false)
const hits = ref<number[]>([])
const hitIdx = ref(0)
const findInputEl = ref<HTMLInputElement | null>(null)
const replaceInputEl = ref<HTMLInputElement | null>(null)

useBackLayerWhen(
  computed(() => findOpen.value),
  () => closeFind(),
)

function clearFindHighlight(): void {
  try {
    CSS.highlights?.delete('inkread-search')
    CSS.highlights?.delete('inkread-search-current')
  } catch {
    /* 不支持 Highlight API 时忽略 */
  }
}

/** 编辑区里可见文字的命中范围;跳过渲染副本(那份不是源码) */
function domRanges(query: string): Range[] {
  const root = scrollerEl()
  if (!root || !query || query.includes('\n')) return []
  const needle = caseSensitive.value ? query : query.toLowerCase()
  const out: Range[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      (node.parentElement?.closest('.vditor-ir__preview') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  })
  let node: Node | null
  while ((node = walker.nextNode())) {
    const raw = node.textContent ?? ''
    const text = caseSensitive.value ? raw : raw.toLowerCase()
    let i = 0
    while ((i = text.indexOf(needle, i)) >= 0) {
      const r = new Range()
      r.setStart(node, i)
      r.setEnd(node, i + query.length)
      out.push(r)
      i += query.length
    }
  }
  return out
}

/** 把第 hitIdx 处高亮并滚到眼前 */
function paintHit(): void {
  clearFindHighlight()
  const ranges = domRanges(findQuery.value)
  if (ranges.length === 0) return
  const cur = ranges[Math.min(hitIdx.value, ranges.length - 1)]
  try {
    if (CSS.highlights) {
      CSS.highlights.set('inkread-search', new Highlight(...ranges))
      CSS.highlights.set('inkread-search-current', new Highlight(cur))
    }
  } catch {
    /* 不支持时只滚动 */
  }
  const scroller = scrollerEl()
  const rect = cur.getBoundingClientRect()
  if (!scroller || rect.height === 0) return
  const box = scroller.getBoundingClientRect()
  // 已经在视野中间地带就别动,免得每敲一个字画面就跳
  if (rect.top < box.top + 40 || rect.bottom > box.bottom - 40) {
    scroller.scrollTo({ top: scroller.scrollTop + rect.top - box.top - scroller.clientHeight * 0.35 })
  }
}

/** 重算命中(内容、查找词、大小写开关变了都要调) */
function refreshFind(): void {
  if (!vditor || !findOpen.value) return
  const found = findAll(vditor.getValue(), findQuery.value, caseSensitive.value)
  hits.value = found
  if (found.length === 0) {
    hitIdx.value = 0
    clearFindHighlight()
    return
  }
  hitIdx.value = Math.min(hitIdx.value, found.length - 1)
  paintHit()
}

function stepHit(dir: number): void {
  if (hits.value.length === 0) return
  hitIdx.value = (hitIdx.value + dir + hits.value.length) % hits.value.length
  paintHit()
}

function toggleCase(): void {
  caseSensitive.value = !caseSensitive.value
  hitIdx.value = 0
  refreshFind()
}

function toggleReplace(): void {
  replaceOpen.value = !replaceOpen.value
  if (replaceOpen.value) void nextTick(() => replaceInputEl.value?.focus())
}

/** 打开查找条;选中的文字自动带进查找框(Typora / VS Code 同款) */
function openFind(withReplace = false): void {
  const picked = (vditor?.getSelection() ?? '').trim()
  if (picked && !picked.includes('\n')) findQuery.value = picked
  findOpen.value = true
  if (withReplace) replaceOpen.value = true
  hitIdx.value = 0
  void nextTick(() => {
    findInputEl.value?.focus()
    findInputEl.value?.select()
    refreshFind()
  })
}

function closeFind(): void {
  findOpen.value = false
  clearFindHighlight()
  vditor?.focus()
}

function doReplaceOne(): void {
  if (!vditor || hits.value.length === 0) return
  const src = vditor.getValue()
  const start = hits.value[Math.min(hitIdx.value, hits.value.length - 1)]
  applyValue(replaceAt(src, start, findQuery.value.length, replaceText.value))
  // 下一处从插入内容之后找起:替换文本里含查找词时(a → aa)才不会原地打转
  const after = start + replaceText.value.length
  const found = findAll(vditor.getValue(), findQuery.value, caseSensitive.value)
  hits.value = found
  const nextIdx = found.findIndex((p) => p >= after)
  hitIdx.value = nextIdx >= 0 ? nextIdx : 0
  if (found.length === 0) clearFindHighlight()
  else void nextTick(paintHit)
}

function doReplaceAll(): void {
  if (!vditor || hits.value.length === 0) return
  const r = replaceAll(vditor.getValue(), findQuery.value, replaceText.value, caseSensitive.value)
  if (r.count === 0) return
  applyValue(r.text)
  toast(`已替换 ${r.count} 处`)
  hitIdx.value = 0
  void nextTick(() => refreshFind())
}

watch(findQuery, () => {
  hitIdx.value = 0
  refreshFind()
})

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
      // Typora 式纯所见即所得:工具栏用 CSS 藏掉不显示,但**数组不能为空** ——
      // Vditor 的快捷键是挂在 toolbar 条目上分发的(editorCommonEvent.ts 里
      // `options.toolbar.find(… matchHotKey …)`),给空数组等于 Ctrl+B / Ctrl+I / Ctrl+K
      // 全部失效。这里只列快捷键要用的条目,刻意排掉与本应用冲突的:
      // emoji(⌘E=阅读/编辑切换)、both(⌘P=快速打开)、headings(子菜单要弹面板)。
      // undo / redo 不列 —— Vditor 在没有对应按钮时走内建的 ⌘Z / ⌘Y 分支。
      toolbar: [
        'bold', // ⌘B 加粗
        'italic', // ⌘I 斜体
        'strike', // ⌘D 删除线
        'link', // ⌘K 链接
        'inline-code', // ⌘G 行内代码
        'code', // ⌘U 代码块
        'quote', // ⌘; 引用
        'list', // ⌘L 无序列表
        'ordered-list', // ⌘O 有序列表
        'check', // ⌘J 任务列表
        'line', // ⇧⌘H 分割线
        'table', // ⌘M 表格
        'outdent', // ⇧⌘I 减少缩进
        'indent', // ⇧⌘O 增加缩进
      ],
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
        refreshToc()
        refreshStats()
        scrollerEl()?.addEventListener('scroll', onEditorScroll, { passive: true })
        document.addEventListener('selectionchange', onSelectionChange)
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
  if (tocTimer) clearTimeout(tocTimer)
  if (activeRaf) cancelAnimationFrame(activeRaf)
  if (selTimer) clearTimeout(selTimer)
  clearFindHighlight()
  scrollerEl()?.removeEventListener('scroll', onEditorScroll)
  document.removeEventListener('selectionchange', onSelectionChange)
  try {
    vditor?.destroy()
  } catch {
    /* vditor 未完成初始化时 destroy 可能报错,忽略 */
  }
  vditor = null
})

defineExpose({ save, isDirty, scrollToSlug, formatJsonBlocks, openFind })
</script>

<style scoped>
.editor-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

/* ---------- 查找 / 替换条 ---------- */
.fr-bar {
  position: absolute;
  top: 10px;
  right: 18px;
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--bg-card);
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.14);
}
.fr-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.fr-input {
  width: 190px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--bg-side);
  color: var(--t1);
  font-size: 13px;
  font-family: inherit;
  outline: none;
}
.fr-input:focus {
  border-color: var(--accent);
}
.fr-count {
  min-width: 46px;
  text-align: center;
  font-size: 12px;
  color: var(--t3);
  font-variant-numeric: tabular-nums;
}
.fr-count.is-none {
  color: var(--danger, #c0392b);
}
.fr-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 26px;
  min-width: 26px;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--t2);
  font-size: 12.5px;
  font-family: inherit;
  cursor: pointer;
}
.fr-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--t1);
}
.fr-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.fr-btn.is-on {
  background: var(--accent-soft);
  border-color: var(--accent-line);
  color: var(--accent-deep);
}
.fr-btn--txt {
  white-space: nowrap;
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
  /* 字体与行高跟随「阅读」里的设置,写和读用同一套观感;
     字间距/首行缩进不跟随 —— 编辑时字符位置要和源码对得上,缩进会干扰定位 */
  font-family: var(--font-body);
  line-height: var(--prose-line);
  max-width: 52em;
  margin: 0 auto;
  /* 底部留一屏三成的空白(Typora / 语雀同款):最后几个标题也能被大纲滚到顶部,
     在文末打字时视线也不必贴着窗口底边 */
  padding: 24px 40px 35vh !important;
}
/* 大纲点过来的那个标题闪一下,眼睛好接上 */
:deep(.ink-jump-flash) {
  animation: ink-jump-flash 1s ease-out;
  border-radius: var(--radius-sm);
}
@keyframes ink-jump-flash {
  from {
    background: var(--accent-soft);
  }
  to {
    background: transparent;
  }
}
</style>
