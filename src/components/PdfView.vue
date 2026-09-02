<template>
  <div ref="scroller" class="content pdf-view">
    <div class="read-progress"><div class="read-progress__bar" :style="{ width: progress + '%' }"></div></div>

    <FindBar
      v-if="findOpen"
      :key="findKey"
      :total="hitPages.length"
      :index="hitAt"
      :busy="findBusy"
      :initial="findInitial"
      placeholder="在本 PDF 中查找…"
      @search="runFind"
      @step="stepFind"
      @close="closeFind"
    />

    <div v-if="errorMsg" class="prose-wrap"><div class="doc-error">{{ errorMsg }}</div></div>
    <div v-else-if="loading" class="prose-wrap"><div class="doc-error">正在打开《{{ fileName }}》…</div></div>

    <div v-else class="pdf-pages">
      <div
        v-for="p in pages"
        :key="p.num"
        class="pdf-page"
        :data-page="p.num"
        :style="{ width: p.w + 'px', height: p.h + 'px', '--total-scale-factor': String(scale) }"
      >
        <canvas :ref="(el) => setCanvas(p.num, el as HTMLCanvasElement | null)" />
        <!-- 文本层:透明的字摆在位图上,才能选中、复制、查找 -->
        <div class="textLayer" :ref="(el) => setTextLayer(p.num, el as HTMLElement | null)"></div>
        <span v-if="!p.painted" class="pdf-page-num">{{ p.num }}</span>
      </div>
    </div>

    <!-- 缩放条:PDF 是固定版式,排版旋钮对它无效,能调的只有大小 -->
    <div v-if="!loading && !errorMsg" class="pdf-bar">
      <button class="opt pdf-btn" title="缩小" :disabled="scale <= MIN_SCALE" @click="zoom(-1)">−</button>
      <span class="pdf-scale">{{ Math.round(scale * 100) }}%</span>
      <button class="opt pdf-btn" title="放大" :disabled="scale >= MAX_SCALE" @click="zoom(1)">+</button>
      <button class="opt pdf-btn pdf-btn--fit" title="按宽度适应" @click="fitWidth()">适宽</button>
      <span class="pdf-pos">{{ current }} / {{ total }}</span>
    </div>

    <button v-show="showBackTop" class="back-top" title="回到顶部" @click="toTop()">
      <Icon name="up" :size="19" />
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * PDF 阅读视图。
 *
 * **只渲染视口附近的几页**:一本 300 页的 PDF 全渲成 canvas 是几百 MB 显存,
 * 手机上必崩。这里先按页面尺寸把占位撑开(滚动条长度正确、位置可记),
 * 再用 IntersectionObserver 只画进入视野的页,离场的把 canvas 尺寸归零释放。
 */
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { backend } from '@/core/backend'
import { errMsg } from '@/core/errmsg'
import { loadPdfjs, parsePdfTocSlug, pdfTocSlug, readOutline } from '@/core/pdf'
import { loadPos, savePos } from '@/core/reading-pos'
import type { TocItem } from '@/core/markdown/pipeline'
import Icon from '@/components/Icon.vue'
import FindBar from '@/components/FindBar.vue'
import { clearHighlights, findRanges, paintHighlights, revealRange, stepIndex } from '@/core/find-in-dom'

const props = defineProps<{
  repoId: string
  path: string
}>()

const emit = defineEmits<{
  toc: [items: TocItem[]]
  rendered: []
  title: [text: string]
}>()

interface PageBox {
  num: number
  /** CSS 像素尺寸(已含缩放) */
  w: number
  h: number
  painted: boolean
}

const MIN_SCALE = 0.4
const MAX_SCALE = 4
/** 视口外也预渲染这么多页,滚动时不至于看到空白 */
const PRERENDER = 1

const scroller = ref<HTMLElement | null>(null)
const errorMsg = ref('')
const loading = ref(false)
const progress = ref(0)
const showBackTop = ref(false)
const scale = ref(1)
const pages = ref<PageBox[]>([])
const current = ref(1)

const doc = shallowRef<PDFDocumentProxy | null>(null)
const canvases = new Map<number, HTMLCanvasElement>()
const textHosts = new Map<number, HTMLElement>()
const tasks = new Map<number, RenderTask>()
/** 已渲染的文本层,换页/缩放时要 cancel 掉,否则它会往已经清空的容器里继续塞 span */
const textLayers = new Map<number, { cancel: () => void }>()
/** 页原始尺寸(scale=1),缩放时据此重算占位 */
const baseSizes = new Map<number, { w: number; h: number }>()
let observer: IntersectionObserver | null = null
let loadSeq = 0
let saveTimer: ReturnType<typeof setTimeout> | null = null

// ---- 查找 ----
const findOpen = ref(false)
const findInitial = ref('')
const findKey = ref(0)
const findBusy = ref(false)
/** 命中的页号(1 起);PDF 没有"当前窗口"的概念,结果一律按页聚合 */
const hitPages = ref<number[]>([])
const hitAt = ref(0)
/** 每页的纯文本,取一次就缓存 —— 206 页逐页问 worker 要一两秒,不该每次搜都重来 */
const pageTexts = new Map<number, string>()
let findQuery = ''

const total = computed(() => pages.value.length)
const fileName = computed(() => props.path.split('/').pop() ?? '')

function setCanvas(num: number, el: HTMLCanvasElement | null): void {
  if (el) canvases.set(num, el)
  else canvases.delete(num)
}

function setTextLayer(num: number, el: HTMLElement | null): void {
  if (el) textHosts.set(num, el)
  else textHosts.delete(num)
}

function close(): void {
  observer?.disconnect()
  observer = null
  for (const t of tasks.values()) t.cancel()
  tasks.clear()
  for (const t of textLayers.values()) t.cancel()
  textLayers.clear()
  for (const host of textHosts.values()) host.replaceChildren()
  textHosts.clear()
  for (const c of canvases.values()) {
    c.width = 0
    c.height = 0
  }
  canvases.clear()
  baseSizes.clear()
  pageTexts.clear()
  hitPages.value = []
  // pdf.js v6 的文档代理没有 destroy(),要经 loadingTask 关(它会连 worker 一起收)
  void doc.value?.loadingTask.destroy()
  doc.value = null
  pages.value = []
}

async function load(): Promise<void> {
  const seq = ++loadSeq
  close()
  errorMsg.value = ''
  emit('toc', [])
  if (!props.path || !props.repoId) return

  loading.value = true
  try {
    const pdfjs = await loadPdfjs()
    const res = await fetch(backend.assetUrl(props.repoId, props.path))
    if (!res.ok) throw new Error(`读取失败(HTTP ${res.status})`)
    const data = new Uint8Array(await res.arrayBuffer())
    if (seq !== loadSeq) return
    const d = await pdfjs.getDocument({ data }).promise
    if (seq !== loadSeq) {
      void d.loadingTask.destroy()
      return
    }
    doc.value = d

    // 逐页问尺寸太慢(几百次 IPC),按首页尺寸铺占位,各页渲染时再校正自己的高度
    const first = await d.getPage(1)
    const vp = first.getViewport({ scale: 1 })
    baseSizes.set(1, { w: vp.width, h: vp.height })
    const boxes: PageBox[] = []
    for (let i = 1; i <= d.numPages; i++) {
      boxes.push({ num: i, w: Math.round(vp.width * scale.value), h: Math.round(vp.height * scale.value), painted: false })
    }
    pages.value = boxes

    const meta = await d.getMetadata().catch(() => null)
    const info = meta?.info as { Title?: string } | undefined
    emit('title', (info?.Title ?? '').trim() || fileName.value)

    const outline = await readOutline(d)
    if (seq !== loadSeq) return
    emit(
      'toc',
      outline.map((o, i) => ({ level: o.level, title: o.title, slug: pdfTocSlug(o.page, i) })),
    )

    // 先把「上次读到第几页」写进 current,再 fitWidth ——
    // fitWidth 会按 current 这一页重新定位(缩放一变 scrollTop 就没意义了),
    // 顺序反过来的话它的 nextTick 会把恢复出来的位置又拽回第 1 页
    const saved = loadPos(props.repoId, props.path)
    const savedPage = saved.chapter ?? 0
    if (savedPage > 1) current.value = Math.min(savedPage, d.numPages)
    loading.value = false
    await nextTick()
    fitWidth()
    startObserving()
    emit('rendered')
  } catch (e) {
    if (seq !== loadSeq) return
    errorMsg.value = `打开 PDF 失败:${errMsg(e)}`
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

/** 只画进入视野(含预留)的页,离场即释放 canvas 像素 */
function startObserving(): void {
  observer?.disconnect()
  const box = scroller.value
  if (!box) return
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const num = Number((e.target as HTMLElement).dataset.page)
        if (!num) continue
        if (e.isIntersecting) void paint(num)
        else release(num)
      }
    },
    // 上下各留一屏 × PRERENDER,滚动时提前画好
    { root: box, rootMargin: `${PRERENDER * 100}% 0px` },
  )
  for (const el of Array.from(box.querySelectorAll<HTMLElement>('.pdf-page'))) observer.observe(el)
}

async function paint(num: number): Promise<void> {
  const d = doc.value
  const canvas = canvases.get(num)
  const box = pages.value.find((p) => p.num === num)
  if (!d || !canvas || !box || tasks.has(num) || box.painted) return
  try {
    const page = await d.getPage(num)
    if (!doc.value) return
    const base = page.getViewport({ scale: 1 })
    baseSizes.set(num, { w: base.width, h: base.height })
    // 各页尺寸可能不同(插页/横页),按实际尺寸校正占位
    box.w = Math.round(base.width * scale.value)
    box.h = Math.round(base.height * scale.value)
    // 高分屏按 dpr 放大位图,否则字发虚
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const vp = page.getViewport({ scale: scale.value * dpr })
    canvas.width = Math.round(vp.width)
    canvas.height = Math.round(vp.height)
    canvas.style.width = `${box.w}px`
    canvas.style.height = `${box.h}px`
    // v6 起首选直接传 canvas(传 canvasContext 是兼容路径,还要求 canvas 为 null)
    const task = page.render({ canvas, viewport: vp })
    tasks.set(num, task)
    await task.promise
    box.painted = true

    // 文本层用 **CSS 比例**的 viewport(它是 DOM 不是位图,不该乘 dpr),
    // 否则字的位置会按 dpr 整体放大、和画面错开
    const host = textHosts.get(num)
    if (host && doc.value) {
      const pdfjs = await loadPdfjs()
      textLayers.get(num)?.cancel()
      host.replaceChildren()
      pdfjs.setLayerDimensions(host as HTMLDivElement, page.getViewport({ scale: scale.value }))
      const layer = new pdfjs.TextLayer({
        textContentSource: page.streamTextContent(),
        container: host,
        viewport: page.getViewport({ scale: scale.value }),
      })
      textLayers.set(num, layer)
      await layer.render()
    }
  } catch {
    /* 取消或渲染失败:留占位,下次进入视野再试 */
  } finally {
    tasks.delete(num)
  }
}

function release(num: number): void {
  tasks.get(num)?.cancel()
  tasks.delete(num)
  textLayers.get(num)?.cancel()
  textLayers.delete(num)
  textHosts.get(num)?.replaceChildren()
  const canvas = canvases.get(num)
  if (canvas) {
    // 宽高归零才真正释放位图内存,单纯 clearRect 不会
    canvas.width = 0
    canvas.height = 0
  }
  const box = pages.value.find((p) => p.num === num)
  if (box) box.painted = false
}

/** 缩放:占位按新比例重算,已画的全部作废重画 */
function applyScale(next: number): void {
  const box = scroller.value
  const anchor = current.value
  scale.value = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next))
  for (const p of pages.value) {
    const base = baseSizes.get(p.num) ?? baseSizes.get(1)
    if (base) {
      p.w = Math.round(base.w * scale.value)
      p.h = Math.round(base.h * scale.value)
    }
    p.painted = false
  }
  for (const t of tasks.values()) t.cancel()
  tasks.clear()
  for (const t of textLayers.values()) t.cancel()
  textLayers.clear()
  for (const host of textHosts.values()) host.replaceChildren()
  void nextTick(() => {
    // 缩放后 scrollTop 全乱了,按缩放前那一页重新定位
    goToPage(anchor)
    if (box) startObserving()
  })
}

function zoom(dir: number): void {
  applyScale(Number((scale.value + dir * 0.2).toFixed(2)))
}

function fitWidth(): void {
  const box = scroller.value
  const base = baseSizes.get(1)
  if (!box || !base) return
  // 两侧各留 24px 余量,别让页面贴着边
  applyScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, (box.clientWidth - 48) / base.w)))
}

function goToPage(num: number): void {
  const box = scroller.value
  if (!box) return
  const el = box.querySelector<HTMLElement>(`.pdf-page[data-page="${num}"]`)
  if (!el) return
  box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - 8
}

/** 目录点击:slug 里带的是页序号(0 起) */
function scrollToSlug(slug: string): void {
  const page = parsePdfTocSlug(slug)
  if (page < 0) return
  goToPage(page + 1)
  persist()
}

function toTop(): void {
  scroller.value?.scrollTo({ top: 0, behavior: 'smooth' })
}

function onScroll(): void {
  const el = scroller.value
  if (!el) return
  const max = el.scrollHeight - el.clientHeight
  progress.value = max > 10 ? Math.min(100, (el.scrollTop / max) * 100) : 0
  showBackTop.value = el.scrollTop > 600
  // 当前页 = 视口上沿落在哪一页里
  const top = el.getBoundingClientRect().top
  for (const p of Array.from(el.querySelectorAll<HTMLElement>('.pdf-page'))) {
    const r = p.getBoundingClientRect()
    if (r.bottom > top + 40) {
      current.value = Number(p.dataset.page) || 1
      break
    }
  }
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(persist, 250)
}

function persist(): void {
  const el = scroller.value
  if (!el || !doc.value) return
  // PDF 的位置以页号为准:缩放一变 scrollTop 就没有意义了
  savePos(props.repoId, props.path, { top: el.scrollTop, pct: progress.value, chapter: current.value })
}

watch(
  () => [props.repoId, props.path] as const,
  () => void load(),
  { immediate: true },
)

watch(scroller, (el, old) => {
  old?.removeEventListener('scroll', onScroll)
  el?.addEventListener('scroll', onScroll, { passive: true })
})

onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer)
  persist()
  scroller.value?.removeEventListener('scroll', onScroll)
  close()
})

// ---- 查找 ----

function openFind(initial = ''): void {
  findInitial.value = initial
  findKey.value++
  findOpen.value = true
}

function closeFind(): void {
  findOpen.value = false
  hitPages.value = []
  findQuery = ''
  clearHighlights()
}

/** 某页的纯文本(带缓存) */
async function textOf(num: number): Promise<string> {
  const cached = pageTexts.get(num)
  if (cached !== undefined) return cached
  const d = doc.value
  if (!d) return ''
  try {
    const page = await d.getPage(num)
    const content = await page.getTextContent()
    const text = content.items
      .map((it) => ('str' in it ? it.str : ''))
      .join('')
      .toLowerCase()
    pageTexts.set(num, text)
    return text
  } catch {
    pageTexts.set(num, '')
    return ''
  }
}

/**
 * 逐页找,结果按页聚合。
 *
 * 不做"第几处"的精确编号:`getTextContent` 给的字符偏移与文本层 DOM 里的
 * 节点切分并不一一对应,硬映射容易错位。跳到页上之后在该页的文本层里重新找一遍,
 * 位置自然就准了(见 `highlightOnPage`)。
 */
async function runFind(query: string): Promise<void> {
  findQuery = query
  clearHighlights()
  hitPages.value = []
  const needle = query.trim().toLowerCase()
  if (!needle || !doc.value) return
  findBusy.value = true
  const hits: number[] = []
  try {
    const count = doc.value.numPages
    for (let n = 1; n <= count; n++) {
      if ((await textOf(n)).includes(needle)) hits.push(n)
      // 每 20 页让出主线程,搜索期间界面不僵
      if (n % 20 === 0) await new Promise((r) => setTimeout(r, 0))
      if (!findOpen.value || findQuery.trim().toLowerCase() !== needle) return
    }
    hitPages.value = hits
    hitAt.value = 0
    if (hits.length > 0) await gotoHit(0)
  } finally {
    findBusy.value = false
  }
}

/** 等某页的文本层渲染出来(它由 IntersectionObserver 异步触发) */
async function waitTextLayer(num: number, tries = 40): Promise<HTMLElement | null> {
  for (let i = 0; i < tries; i++) {
    const host = textHosts.get(num)
    if (host && host.children.length > 0) return host
    await new Promise((r) => setTimeout(r, 50))
  }
  return textHosts.get(num) ?? null
}

async function gotoHit(n: number): Promise<void> {
  const num = hitPages.value[n]
  if (!num) return
  hitAt.value = n
  goToPage(num)
  const host = await waitTextLayer(num)
  if (!host) return
  const ranges = findRanges(host, findQuery)
  if (ranges.length === 0) return
  paintHighlights(ranges, 0)
  revealRange(ranges[0])
}

function stepFind(dir: number): void {
  if (hitPages.value.length === 0) return
  void gotoHit(stepIndex(hitPages.value.length, hitAt.value, dir))
}

defineExpose({ scrollToSlug, openFind })
</script>

<!--
  文本层的 span 由 pdf.js 在运行时创建,拿不到 scoped 的属性标记,所以这块样式
  必须非 scoped(靠 .pdf-page 前缀限定范围)。规则抄自 pdfjs-dist/web/pdf_viewer.css
  的 .textLayer 部分,只保留定位与字号所必需的那些,并展平了它的 CSS 嵌套写法。
-->
<style>
/* pdf.js 用 round(down, …, --scale-round-x) 做像素对齐,变量缺了整条 width 就失效 */
.pdf-page {
  --scale-round-x: 1px;
  --scale-round-y: 1px;
}
.pdf-page .textLayer {
  position: absolute;
  inset: 0;
  overflow: clip;
  opacity: 1;
  line-height: 1;
  text-align: initial;
  letter-spacing: normal;
  word-spacing: normal;
  text-size-adjust: none;
  forced-color-adjust: none;
  transform-origin: 0 0;
  caret-color: CanvasText;
  z-index: 1;
  --min-font-size: 1;
  --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
  --min-font-size-inv: calc(1 / var(--min-font-size));
}
/* 字本身透明:看到的是下面 canvas 画出来的字,选中时才现出选区 */
.pdf-page .textLayer span,
.pdf-page .textLayer br {
  color: transparent;
  position: absolute;
  white-space: pre;
  cursor: text;
  transform-origin: 0 0;
  user-select: text;
}
.pdf-page .textLayer > :not(.markedContent),
.pdf-page .textLayer .markedContent span:not(.markedContent) {
  z-index: 1;
  --font-height: 0;
  font-size: calc(var(--text-scale-factor) * var(--font-height));
  --scale-x: 1;
  --rotate: 0deg;
  transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
}
.pdf-page .textLayer .markedContent {
  display: contents;
}
.pdf-page .textLayer span[role='img'] {
  user-select: none;
  cursor: default;
}
.pdf-page .textLayer ::selection {
  background: var(--accent-soft);
}
</style>

<style scoped>
.pdf-view {
  background: var(--bg-app);
}
.pdf-pages {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 18px 0 32px;
}
.pdf-page {
  position: relative;
  background: #fff;
  box-shadow: var(--shadow-sm);
  border-radius: 2px;
  overflow: hidden;
  flex-shrink: 0;
}
.pdf-page canvas {
  display: block;
}
/* 还没画出来的页:给个页码占位,不然滚快了是一片空白 */
.pdf-page-num {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: var(--t3);
}

.pdf-bar {
  position: absolute;
  right: 18px;
  bottom: 18px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  background: var(--bg-card);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-md);
}
.pdf-btn {
  min-width: 30px;
  height: 28px;
  padding: 0 8px;
  font-size: 15px;
  line-height: 1;
}
.pdf-btn--fit {
  font-size: 12.5px;
}
.pdf-scale,
.pdf-pos {
  font-size: 12px;
  color: var(--t3);
  font-variant-numeric: tabular-nums;
  min-width: 42px;
  text-align: center;
}
@media (max-width: 900px) {
  .pdf-bar {
    right: 12px;
    bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  }
  .pdf-btn {
    height: 34px;
  }
}
</style>
