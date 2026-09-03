<template>
  <div ref="scroller" class="content" @click="onClick">
    <div class="read-progress"><div class="read-progress__bar" :style="{ width: progress + '%' }"></div></div>

    <FindBar
      v-if="findOpen"
      :key="findKey"
      :total="findTotal"
      :index="findIndex"
      :busy="findBusy"
      :initial="findInitial"
      :whole-label="wholeMode ? `全书 ${bookHits.length} 章` : '全书'"
      :whole-active="wholeMode"
      @search="runFind"
      @step="stepFind"
      @whole="toggleWhole"
      @close="closeFind"
    />

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
import FindBar from '@/components/FindBar.vue'
import { clearHighlights, findRanges, paintHighlights, revealRange, stepIndex } from '@/core/find-in-dom'

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
  /** 点到正文空白(不是链接 / 章节条 / 回顶 / 查找条):手机端用它切换沉浸阅读 */
  'tap-blank': []
}>()

const settings = useSettings()

interface LoadedChapter {
  index: number
  html: string
}

/** DOM 里最多同时留几章。3 章足够让上下滚动都不见空白,又不至于把节点树撑爆 */
const MAX_LOADED = 3
/**
 * 窗口至少要有几屏高。
 *
 * 往后接章的阈值是"离底不到 1 屏",往前是"离顶不到半屏" —— 两者**不能同时成立**,否则每次滚动
 * 都先命中 appendNext,窗口只会往后走、永远回不到前面的章(实测 30 章 × 65px 的书:
 * scrollTop=0 时 bottomGap=65 照样 < clientHeight,向上滚反而把内容往后推)。
 * 1(视口)+ 1(底部预留)+ 0.5(顶部预留)= 2.5 屏是让二者互斥的下限,补屏与摘章都以它为准。
 * MAX_LOADED 只是节点数上限:章节短到 3 章凑不够 2.5 屏时,以本条为准多留几章。
 */
const MIN_WINDOW_SCREENS = 2.5

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
/** fillViewport 的代次:补齐途中又换了章(目录跳转 / 重开书)就让旧循环自己退出 */
let fillSeq = 0

// ---- 文内 / 全书查找 ----
const findOpen = ref(false)
const findInitial = ref('')
const findKey = ref(0)
const findBusy = ref(false)
/** true = 结果按"哪些章有命中"给,上下键在章之间跳;false = 只搜当前窗口里的几章 */
const wholeMode = ref(false)
/** 全书模式下有命中的章序号 */
const bookHits = ref<number[]>([])
const bookHitAt = ref(0)
/**
 * 当前窗口 DOM 里的命中。
 * 必须是 ref:`findTotal` 这个 computed 依赖它的长度,放在普通变量里
 * computed 永远追踪不到变化,查找条的计数会一直停在 0(显示"无结果")。
 */
const domRanges = shallowRef<Range[]>([])
const domIndex = ref(0)
let findQuery = ''

const findTotal = computed(() => (wholeMode.value ? bookHits.value.length : domRanges.value.length))
const findIndex = computed(() => (wholeMode.value ? bookHitAt.value : domIndex.value))

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
  const seq = ++fillSeq
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
        box.scrollTop = chapterTop(box, index) + top
      }
    } else {
      // `top` 是"章内偏移"(persist 存的就是它),要加上这一章在容器里的起点。
      // 直接 `scrollTop = top` 会少掉 prose-wrap 的顶部 padding + 首段 margin(实测 48px),
      // 而且每开一次书就再少一次 —— 读者感觉是"每次打开都比上次退了两行"
      box.scrollTop = chapterTop(box, index) + top
    }
    afterRender()
    emit('rendered')
    void fillViewport(seq)
  })
}

/** 某一章的顶边在滚动内容里的位置(= 让它贴住视口顶部所需的 scrollTop) */
function chapterTop(box: HTMLElement, index: number): number {
  const el = proseEl.value?.querySelector<HTMLElement>(`.chap[data-index="${index}"]`)
  if (!el) return 0
  return el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop
}

function windowShort(box: HTMLElement): boolean {
  return box.scrollHeight < box.clientHeight * MIN_WINDOW_SCREENS
}

/**
 * 把窗口接到至少 MIN_WINDOW_SCREENS 屏高。
 *
 * 自动接章**只由 scroll 事件驱动**,而窗口里只有一章、这章又不满一屏时容器根本不可滚动 ——
 * scroll 事件永不触发,于是"继续下滑,自动接下一章…"就那么挂着,怎么划都不动;
 * 手动点目录跳到一个够长的章节才恢复正常(2026-09-03 用户反馈:《极简理财指南》
 * 开篇是 337px 的版权页,视口 731px,开局即卡死)。所以渲染完先自己接够。
 *
 * 先往后接,到了书尾就往前接 —— 停在最后一个短章时也得能往回滚。
 * 除了 resetTo,视口变高 / 字号调小让内容缩回不够时也会由 ResizeObserver 再调一次。
 * 次数上限只是防呆:章节极短的书(语录 / 诗集)一屏要接好几章,但也不该无限接下去。
 */
async function fillViewport(seq: number): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const box = scroller.value
    if (!box || seq !== fillSeq || !book.value) return
    if (!windowShort(box)) return
    if (shifting) {
      // 正好撞上 onScroll 触发的那次接章,等一帧让它落地再看(nextTick 在这儿会空转)
      await new Promise((r) => setTimeout(r, 16))
      continue
    }
    if (await appendNext()) continue
    if (await prependPrev()) continue
    return
  }
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

/**
 * 以某一章为锚,在 DOM 增删前后保持它在视口里的位置不变。
 *
 * 比"加减被增删那块的高度"可靠:摘掉首章时第二章还会一并失去 `.chap + .chap` 的
 * 上边距 / 上边框(41px),按 offsetHeight 减必然差这一截;而且 scrollTop 在中途那次 layout
 * 里可能已被夹到新的最大值,再做加减就错位。锚元素由 Vue 按 key 复用,引用一直有效。
 */
async function keepAnchored(box: HTMLElement, anchorIndex: number, mutate: () => void): Promise<void> {
  const anchor = proseEl.value?.querySelector<HTMLElement>(`.chap[data-index="${anchorIndex}"]`)
  const before = anchor?.getBoundingClientRect().top ?? 0
  mutate()
  await nextTick()
  if (anchor) box.scrollTop += anchor.getBoundingClientRect().top - before
}

/**
 * 窗口超出 MAX_LOADED 时从某一端摘章,但**不许摘到不够 MIN_WINDOW_SCREENS 屏**。
 * 摘完再量、不够就整章放回:章节极短的书(语录 / 诗集)3 章凑不满 2.5 屏,
 * 摘了就回到"滚动条消失 / 前后接章打架"那两种死法。MAX_LOADED 是防节点树撑爆的上限,
 * 不该拿可滚动性去换它。两次 nextTick 之间没有渲染机会,放回去不会闪。
 */
async function trim(box: HTMLElement, side: 'head' | 'tail'): Promise<void> {
  while (loaded.value.length > MAX_LOADED) {
    const kept = loaded.value
    const keptTop = box.scrollTop
    // 还在视口里的章绝不能摘:补屏时读者往往就停在窗口的这一端(开书在首章顶部、视口变高时更是),
    // 摘了它锚点补偿会被夹到 0,眼前内容直接跳成下一章
    const edge = side === 'head' ? kept[0]! : kept[kept.length - 1]!
    const edgeEl = proseEl.value?.querySelector<HTMLElement>(`.chap[data-index="${edge.index}"]`)
    if (edgeEl) {
      const r = edgeEl.getBoundingClientRect()
      const b = box.getBoundingClientRect()
      if (side === 'head' ? r.bottom > b.top : r.top < b.bottom) return
    }
    // 摘头部要以第二章为锚补 scrollTop;摘尾部在视口下方,位置不受影响
    const anchorIndex = side === 'head' ? kept[1]!.index : kept[0]!.index
    await keepAnchored(box, anchorIndex, () => {
      loaded.value = side === 'head' ? kept.slice(1) : kept.slice(0, -1)
    })
    if (windowShort(box)) {
      loaded.value = kept
      await nextTick()
      box.scrollTop = keptTop
      return
    }
  }
}

/** 往后接一章;窗口满了就从头部摘。返回是否真接上了 */
async function appendNext(): Promise<boolean> {
  const box = scroller.value
  const last = loaded.value[loaded.value.length - 1]
  if (shifting || !box || !last || last.index >= total.value - 1) return false
  const next = makeChapter(last.index + 1)
  if (!next) return false
  shifting = true
  loaded.value = [...loaded.value, next]
  await nextTick()
  await trim(box, 'head')
  afterRender()
  shifting = false
  return true
}

/** 往前接一章;新内容加在上方,以原首章为锚补 scrollTop 才不跳。返回是否真接上了 */
async function prependPrev(): Promise<boolean> {
  const box = scroller.value
  const first = loaded.value[0]
  if (shifting || !box || !first || first.index <= 0) return false
  const prev = makeChapter(first.index - 1)
  if (!prev) return false
  shifting = true
  await keepAnchored(box, first.index, () => {
    loaded.value = [prev, ...loaded.value]
  })
  await trim(box, 'tail')
  afterRender()
  shifting = false
  return true
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
  // 离底一屏就开始接下一章,读者滚到底时内容已经在了。
  // 两个条件在 ≥ MIN_WINDOW_SCREENS 屏的窗口里互斥;窗口撑不到那么高(全书就几页)时
  // 两个都试 —— 接不上的那个立刻返回 false,不会打架
  const bottomGap = box.scrollHeight - box.clientHeight - box.scrollTop
  if (bottomGap < box.clientHeight) void appendNext()
  if (box.scrollTop < box.clientHeight * 0.5) void prependPrev()
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
  const target = e.target as HTMLElement | null
  const el = target?.closest('a')
  if (!el) {
    // 没点到链接也没点到章节条 / 回顶 / 查找条这些控件 = 点了正文空白:
    // 手机端靠这一下切换沉浸阅读(顶栏 / 状态条隐现),与 MarkdownView 同一套约定。
    // 此前电子书视图没发这个事件,导致"非 markdown 文档没有全屏阅读"(2026-09-02 用户反馈)。
    // 划选文字松手也会来一次 click,有选区时不当空白点
    if (
      target &&
      !target.closest('.chap-bar, .back-top, .find-bar, .lightbox') &&
      !(window.getSelection()?.toString() ?? '')
    ) {
      emit('tap-blank')
    }
    return
  }
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

/**
 * 视口变高(转屏 / 拉大窗口 / 进沉浸阅读)或正文变矮(调小字号 / 行距)都可能让原本够高的窗口
 * 缩回不够 MIN_WINDOW_SCREENS 屏 —— 那时 scroll 事件同样不会来,得有人主动补。
 * 补屏本身也会改正文高度触发回调,但 windowShort 一不成立就立刻返回,不会自激。
 */
let resizeObs: ResizeObserver | null = null
watch([scroller, proseEl], ([box, prose]) => {
  resizeObs?.disconnect()
  resizeObs = null
  if (!box) return
  resizeObs = new ResizeObserver(() => void fillViewport(fillSeq))
  resizeObs.observe(box)
  if (prose) resizeObs.observe(prose)
})

onBeforeUnmount(() => {
  if (scrollSaveTimer) clearTimeout(scrollSaveTimer)
  persist()
  scroller.value?.removeEventListener('scroll', onScroll)
  resizeObs?.disconnect()
  closeBook()
})

// ---- 查找 ----

/** 打开查找条(Ctrl+F / 从全库搜索跳转过来) */
function openFind(initial = ''): void {
  findInitial.value = initial
  findKey.value++
  findOpen.value = true
}

function closeFind(): void {
  findOpen.value = false
  wholeMode.value = false
  bookHits.value = []
  domRanges.value = []
  findQuery = ''
  clearHighlights()
}

/** 在当前窗口(DOM 里那几章)找 */
function findInDom(): void {
  domRanges.value = findRanges(proseEl.value, findQuery)
  domIndex.value = 0
  if (domRanges.value.length > 0) {
    paintHighlights(domRanges.value, 0)
    revealRange(domRanges.value[0])
  } else {
    clearHighlights()
  }
}

/**
 * 全书查找:逐章取纯文本粗筛,只记"哪些章有",不记具体位置。
 *
 * 不精确到"第几处"是有意的 —— 粗筛拿的是原始 HTML 剥标签后的文本,它的字符偏移
 * 和渲染出来的 DOM 并不对应,硬映射容易错位。跳到章里之后再在 DOM 里重新找一遍,
 * 位置就准了。2469 章逐章解压约 5 秒,所以只在点「全书」时才跑,不跟着输入走。
 */
async function findWholeBook(): Promise<void> {
  const b = book.value
  if (!b || !findQuery.trim()) return
  const needle = findQuery.trim().toLowerCase()
  findBusy.value = true
  bookHits.value = []
  const hits: number[] = []
  try {
    for (let i = 0; i < b.chapters.length; i++) {
      const chapter = b.chapters[i]
      if (chapter && b.chapterText(chapter.id).toLowerCase().includes(needle)) hits.push(i)
      // 每扫 200 章让出一次主线程,长书搜索期间界面不至于僵住
      if (i % 200 === 199) await new Promise((r) => setTimeout(r, 0))
      if (!findOpen.value || findQuery.trim().toLowerCase() !== needle) return
    }
    bookHits.value = hits
    bookHitAt.value = 0
    if (hits.length === 0) {
      toast('全书都没找到这个词', true)
      return
    }
    gotoBookHit(0)
  } finally {
    findBusy.value = false
  }
}

/** 跳到全书命中的第 n 章,渲染完再在 DOM 里精确定位 */
function gotoBookHit(n: number): void {
  const chapterIdx = bookHits.value[n]
  if (chapterIdx === undefined) return
  bookHitAt.value = n
  if (loaded.value.some((c) => c.index === chapterIdx)) {
    findInDom()
    return
  }
  resetTo(chapterIdx)
  // resetTo 的 DOM 更新在 nextTick 里,等它落地再找
  void nextTick(() => void nextTick(findInDom))
}

function runFind(query: string): void {
  findQuery = query
  clearHighlights()
  domRanges.value = []
  if (!query.trim()) {
    bookHits.value = []
    return
  }
  if (wholeMode.value) void findWholeBook()
  else findInDom()
}

function stepFind(dir: number): void {
  if (wholeMode.value) {
    if (bookHits.value.length === 0) return
    gotoBookHit(stepIndex(bookHits.value.length, bookHitAt.value, dir))
    return
  }
  if (domRanges.value.length === 0) return
  domIndex.value = stepIndex(domRanges.value.length, domIndex.value, dir)
  paintHighlights(domRanges.value, domIndex.value)
  revealRange(domRanges.value[domIndex.value])
}

function toggleWhole(): void {
  wholeMode.value = !wholeMode.value
  if (wholeMode.value) void findWholeBook()
  else findInDom()
}

defineExpose({ scrollToSlug, openFind })
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
