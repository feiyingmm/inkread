<template>
  <div ref="scroller" class="content" @click="onClick">
    <div class="read-progress"><div class="read-progress__bar" :style="{ width: progress + '%' }"></div></div>

    <div class="prose-wrap">
      <div v-if="errorMsg" class="doc-error">{{ errorMsg }}</div>
      <div v-else-if="loading" class="doc-error">正在打开《{{ fileName }}》…</div>
      <template v-else>
        <div ref="proseEl" class="prose" :class="{ 'is-wide': settings.width === 'wide' }">
          <!-- 一段一章:滚到底自动往后接,滚到顶自动往前接 -->
          <section v-for="c in loaded" :key="c.index" class="chap" :data-index="c.index" v-html="c.html"></section>
        </div>

        <div class="chap-foot" :class="{ 'is-wide': settings.width === 'wide' }">
          <span v-if="atEnd" class="chap-end">—— 全书完 ——</span>
          <span v-else class="chap-more">继续下滑,自动接下一章…</span>
        </div>
      </template>
    </div>

    <!-- 读到第几章:无限滚动下没有"翻页"动作,位置只能常驻显示 -->
    <div v-if="!loading && !errorMsg && total > 0" class="chap-bar">
      <button class="chap-jump" title="上一章开头" :disabled="topIndex <= 0" @click="jumpTo(topIndex - 1)">
        <Icon name="chevron-up" :size="14" />
      </button>
      <span class="chap-pos">{{ topIndex + 1 }} / {{ total }}</span>
      <button class="chap-jump" title="下一章开头" :disabled="topIndex >= total - 1" @click="jumpTo(topIndex + 1)">
        <Icon name="chevron-down" :size="14" />
      </button>
    </div>

    <button v-show="showBackTop" class="back-top" title="回到顶部" @click="toTop()">
      <Icon name="up" :size="19" />
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * 电子书阅读视图,EPUB 与 MOBI 共用。
 *
 * 两种格式的差别只在"怎么把一章取出来",都收敛到 core/ebook.ts 的 `Ebook` 接口后面了,
 * 这里只管滚动、目录和位置。
 *
 * **滑动窗口式的无限滚动**:读网文不该每章点一次"下一章"(手机上尤其别扭),
 * 所以滚到底自动往后接、滚到顶自动往前接;但也不能一路追加下去 ——
 * 一本 2469 章的书全铺进 DOM 是几十 MB 的节点树。折中是 DOM 里只留相邻几章,
 * 挤出窗口的那端摘掉,并**同步把 scrollTop 补回去**,否则内容会在眼前跳一下。
 */
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { backend } from '@/core/backend'
import { errMsg } from '@/core/errmsg'
import { ANCHOR_ATTR, CHAPTER_ATTR, EXTERNAL_ATTR, parseTocSlug, tocSlug, type Ebook } from '@/core/ebook'
import { openEpub } from '@/core/epub'
import { openMobi } from '@/core/mobi'
import { extOf } from '@/core/paths'
import { loadPos, savePos } from '@/core/reading-pos'
import { setupCodeBlocks } from '@/core/markdown/enhance'
import type { TocItem } from '@/core/markdown/pipeline'
import { useSettings } from '@/stores/settings'
import { toast } from '@/core/toast'
import Icon from '@/components/Icon.vue'

const props = defineProps<{
  repoId: string
  path: string
}>()

const emit = defineEmits<{
  toc: [items: TocItem[]]
  active: [slug: string]
  rendered: []
  /** 书名/章名给标题栏用 */
  title: [text: string]
}>()

const settings = useSettings()

interface LoadedChapter {
  index: number
  html: string
}

/** DOM 里最多同时留几章。3 章足够让上下滚动都不见空白,又不至于把节点树撑爆 */
const MAX_LOADED = 3

const scroller = ref<HTMLElement | null>(null)
const proseEl = ref<HTMLElement | null>(null)
const errorMsg = ref('')
const loading = ref(false)
const progress = ref(0)
const showBackTop = ref(false)
/** 当前 DOM 里的章节(按 index 升序) */
const loaded = ref<LoadedChapter[]>([])
/** 视口顶部落在第几章 —— 标题、进度、阅读位置都以它为准 */
const topIndex = ref(0)

const book = shallowRef<Ebook | null>(null)
let loadSeq = 0
let scrollSaveTimer: ReturnType<typeof setTimeout> | null = null
/** 正在增删章节:DOM 更新是异步的,期间别再触发,否则会连着追加好几章 */
let shifting = false
/** 目录点进来要滚到的锚点 */
let pendingAnchor = ''

const total = computed(() => book.value?.chapters.length ?? 0)
const fileName = computed(() => props.path.split('/').pop() ?? '')
const atEnd = computed(() => {
  const last = loaded.value[loaded.value.length - 1]
  return !!last && last.index >= total.value - 1
})

function closeBook(): void {
  book.value?.dispose()
  book.value = null
  loaded.value = []
  topIndex.value = 0
}

async function load(): Promise<void> {
  const seq = ++loadSeq
  closeBook()
  errorMsg.value = ''
  emit('toc', [])
  if (!props.path || !props.repoId) return

  loading.value = true
  try {
    // 走 repo 协议直接取字节,不过 IPC —— 一本几十 MB 的书转 base64 会把内存翻倍
    const res = await fetch(backend.assetUrl(props.repoId, props.path))
    if (!res.ok) throw new Error(`读取失败(HTTP ${res.status})`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (seq !== loadSeq) return
    const ext = extOf(props.path)
    const opened = ext === 'epub' ? await openEpub(bytes) : await openMobi(bytes)
    if (seq !== loadSeq) {
      opened.dispose()
      return
    }
    book.value = opened
    emit('title', opened.title || fileName.value)
    emit(
      'toc',
      opened.toc.map((t, i) => ({ level: t.level, title: t.title, slug: tocSlug(t, i) })),
    )
    const saved = loadPos(props.repoId, props.path)
    loading.value = false
    resetTo(Math.min(saved.chapter ?? 0, opened.chapters.length - 1), saved.top)
  } catch (e) {
    if (seq !== loadSeq) return
    errorMsg.value = `打开失败:${errMsg(e)}`
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

function makeChapter(index: number): LoadedChapter | null {
  const b = book.value
  const chapter = b?.chapters[index]
  if (!b || !chapter) return null
  return { index, html: b.renderChapter(chapter.id).html }
}

/** 丢掉现有窗口,从某一章重新开始(打开书、目录跳转、章节跳转都走这里) */
function resetTo(index: number, top = 0): void {
  const b = book.value
  if (!b) return
  b.releaseAssets()
  const first = makeChapter(index)
  if (!first) return
  loaded.value = [first]
  topIndex.value = index
  void nextTick(() => {
    const box = scroller.value
    if (!box) return
    if (pendingAnchor) {
      const target = anchorTarget(proseEl.value, pendingAnchor)
      pendingAnchor = ''
      if (target) {
        box.scrollTop += target.getBoundingClientRect().top - box.getBoundingClientRect().top - 12
      } else {
        box.scrollTop = top
      }
    } else {
      box.scrollTop = top
    }
    afterRender()
    emit('rendered')
  })
}

function afterRender(): void {
  const root = proseEl.value
  if (root) setupCodeBlocks(root)
  updateProgress()
}

/**
 * 找章内锚点。EPUB2 时代的书常写成 `<a name="x">` 而不是 `id="x"`,两种都要认;
 * 锚点名可能不是合法 CSS 标识符(数字开头之类),所以走属性选择器 + CSS.escape。
 */
function anchorTarget(root: HTMLElement | null, anchor: string): HTMLElement | null {
  if (!root || !anchor) return null
  try {
    const esc = CSS.escape(anchor)
    return root.querySelector<HTMLElement>(`[id="${esc}"], [name="${esc}"]`)
  } catch {
    return null
  }
}

/** 往后接一章;窗口满了就摘掉最前面那章,并把 scrollTop 补回去 */
async function appendNext(): Promise<void> {
  const box = scroller.value
  const last = loaded.value[loaded.value.length - 1]
  if (shifting || !box || !last || last.index >= total.value - 1) return
  const next = makeChapter(last.index + 1)
  if (!next) return
  shifting = true
  loaded.value = [...loaded.value, next]
  await nextTick()
  if (loaded.value.length > MAX_LOADED) {
    const head = loaded.value[0]!
    const el = proseEl.value?.querySelector<HTMLElement>(`.chap[data-index="${head.index}"]`)
    const h = el?.offsetHeight ?? 0
    loaded.value = loaded.value.slice(1)
    await nextTick()
    // 摘掉的是上方内容,浏览器不会自动补 scrollTop,不减就等于原地跳了一章
    box.scrollTop -= h
  }
  afterRender()
  shifting = false
}

/** 往前接一章;新内容加在上方,必须把 scrollTop 加上它的高度才不跳 */
async function prependPrev(): Promise<void> {
  const box = scroller.value
  const first = loaded.value[0]
  if (shifting || !box || !first || first.index <= 0) return
  const prev = makeChapter(first.index - 1)
  if (!prev) return
  shifting = true
  const before = box.scrollHeight
  loaded.value = [prev, ...loaded.value]
  await nextTick()
  box.scrollTop += box.scrollHeight - before
  if (loaded.value.length > MAX_LOADED) {
    loaded.value = loaded.value.slice(0, MAX_LOADED)
    await nextTick()
  }
  afterRender()
  shifting = false
}

/** 视口顶部落在哪一章 */
function pickTopIndex(): void {
  const box = scroller.value
  const root = proseEl.value
  if (!box || !root) return
  const boxTop = box.getBoundingClientRect().top
  let found = loaded.value[0]?.index ?? 0
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('.chap'))) {
    // 章底还在视口上沿之下 = 顶部就落在这一章里
    if (el.getBoundingClientRect().bottom > boxTop + 40) {
      found = Number(el.dataset.index) || 0
      break
    }
  }
  if (found !== topIndex.value) {
    topIndex.value = found
    const b = book.value
    const chapter = b?.chapters[found]
    if (b && chapter) emit('title', chapter.title || b.title || fileName.value)
  }
}

/** 全书进度 = 已读完的章 + 当前章读了多少,按章数均摊 */
function updateProgress(): void {
  const box = scroller.value
  const root = proseEl.value
  if (!box) return
  let within = 0
  const el = root?.querySelector<HTMLElement>(`.chap[data-index="${topIndex.value}"]`)
  if (el && el.offsetHeight > 0) {
    const boxTop = box.getBoundingClientRect().top
    const passed = boxTop - el.getBoundingClientRect().top
    within = Math.min(1, Math.max(0, passed / el.offsetHeight))
  }
  progress.value = total.value > 0 ? Math.min(100, ((topIndex.value + within) / total.value) * 100) : 0
  showBackTop.value = box.scrollTop > 600
}

function persist(): void {
  const box = scroller.value
  const root = proseEl.value
  if (!box || !book.value) return
  // 位置 = 第几章 + 该章内滚过多少像素。章内偏移要减掉这一章在容器里的起点,
  // 否则窗口里前面还挂着别的章时,存下来的 scrollTop 换个窗口就完全对不上了
  const el = root?.querySelector<HTMLElement>(`.chap[data-index="${topIndex.value}"]`)
  const boxRect = box.getBoundingClientRect()
  const within = el ? Math.max(0, boxRect.top - el.getBoundingClientRect().top) : box.scrollTop
  savePos(props.repoId, props.path, { top: within, pct: progress.value, chapter: topIndex.value })
}

function onScroll(): void {
  const box = scroller.value
  if (!box) return
  pickTopIndex()
  updateProgress()
  // 离底一屏就开始接下一章,读者滚到底时内容已经在了
  const bottomGap = box.scrollHeight - box.clientHeight - box.scrollTop
  if (bottomGap < box.clientHeight) void appendNext()
  else if (box.scrollTop < box.clientHeight * 0.5) void prependPrev()
  if (scrollSaveTimer) clearTimeout(scrollSaveTimer)
  scrollSaveTimer = setTimeout(persist, 250)
}

/** 跳到某一章开头 */
function jumpTo(index: number): void {
  if (index < 0 || index >= total.value) return
  resetTo(index)
  persist()
}

/** 目录点击。slug 由 core/ebook.ts 编码,含章节 id 与章内锚点 */
function scrollToSlug(slug: string): void {
  const b = book.value
  if (!b) return
  const { chapterId, anchor } = parseTocSlug(slug)
  if (!chapterId) return
  const i = b.chapters.findIndex((c) => c.id === chapterId)
  if (i < 0) {
    toast('这一节不在正文里,可能是封面或版权页', true)
    return
  }
  pendingAnchor = anchor
  resetTo(i)
  persist()
}

function toTop(): void {
  scroller.value?.scrollTo({ top: 0, behavior: 'smooth' })
}

/** 书内链接与外链都在这儿接管 —— 渲染时已经把 href 摘掉了,不会有原生跳转 */
function onClick(e: MouseEvent): void {
  const el = (e.target as HTMLElement | null)?.closest('a')
  if (!el) return
  const inner = el.getAttribute(CHAPTER_ATTR)
  if (inner) {
    e.preventDefault()
    const anchor = el.getAttribute(ANCHOR_ATTR) ?? ''
    scrollToSlug(`0|${inner}|${anchor}`)
    return
  }
  if (el.getAttribute(EXTERNAL_ATTR) === '1') {
    e.preventDefault()
    const href = el.getAttribute('href')
    if (href) void backend.openExternal(href)
  }
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
  if (scrollSaveTimer) clearTimeout(scrollSaveTimer)
  persist()
  scroller.value?.removeEventListener('scroll', onScroll)
  closeBook()
})

defineExpose({ scrollToSlug })
</script>

<style scoped>
/* 章与章之间给一道浅浅的分隔,连续下滑时看得出换章了 */
.chap + .chap {
  margin-top: 18px;
  padding-top: 22px;
  border-top: 1px solid var(--line);
}

.chap-foot {
  max-width: 46em;
  margin: 10px auto 0;
  text-align: center;
  font-size: 12.5px;
  color: var(--t3);
}
.chap-foot.is-wide {
  max-width: none;
}
.chap-end {
  letter-spacing: 0.1em;
}

/* 右下角常驻的章节位置 + 跳章 */
.chap-bar {
  position: absolute;
  right: 18px;
  bottom: 18px;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 6px;
  border-radius: 999px;
  background: var(--bg-card);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-md);
  opacity: 0.55;
  transition: opacity 0.15s ease;
}
.chap-bar:hover {
  opacity: 1;
}
.chap-jump {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 50%;
  background: none;
  color: var(--t2);
  cursor: pointer;
}
.chap-jump:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--accent-deep);
}
.chap-jump:disabled {
  opacity: 0.35;
  cursor: default;
}
.chap-pos {
  font-size: 12px;
  color: var(--t3);
  font-variant-numeric: tabular-nums;
  padding: 0 4px;
  min-width: 62px;
  text-align: center;
}
@media (max-width: 900px) {
  .chap-bar {
    right: 12px;
    bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  }
  .chap-jump {
    width: 32px;
    height: 32px;
  }
}
</style>
