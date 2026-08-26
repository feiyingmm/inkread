<template>
  <div ref="scroller" class="content" @click="onClick">
    <div class="read-progress"><div class="read-progress__bar" :style="{ width: progress + '%' }"></div></div>

    <div v-if="searchNav" class="search-nav">
      <span class="sn-count">{{ searchNav.idx + 1 }}/{{ searchNav.total }}</span>
      <button class="sn-btn" title="上一处" @click="stepHit(-1)"><Icon name="chevron-up" :size="16" /></button>
      <button class="sn-btn" title="下一处" @click="stepHit(1)"><Icon name="chevron-down" :size="16" /></button>
      <button class="sn-btn" title="清除高亮" @click="clearSearch()"><Icon name="close" :size="15" /></button>
    </div>

    <div class="prose-wrap">
      <div v-if="errorMsg" class="doc-error">{{ errorMsg }}</div>
      <div
        v-else
        ref="proseEl"
        class="prose"
        :class="{ 'is-wide': settings.width === 'wide', 'is-serif': settings.serifBody }"
        v-html="html"
      ></div>
    </div>

    <button v-show="showBackTop" class="back-top" title="回到顶部" @click="toTop()"><Icon name="up" :size="19" /></button>

    <div v-if="lightboxSrc || lightboxSvg" class="lightbox" @click="closeLightbox">
      <img v-if="lightboxSrc" :src="lightboxSrc" alt="" />
      <div v-else class="lightbox-svg" v-html="lightboxSvg"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { errMsg } from '@/core/errmsg'
import { backend } from '@/core/backend'
import { dirOf, extOf, fileKind } from '@/core/paths'
import { renderMarkdown, renderPlainText, type TocItem } from '@/core/markdown/pipeline'
import { transformInfoCards } from '@/core/markdown/infocard'
import { renderMermaidBlocks } from '@/core/markdown/mermaid'
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
  open: [path: string, anchor?: string]
  rendered: []
  'source-mode': [on: boolean]
  'tap-blank': []
}>()

const settings = useSettings()

const scroller = ref<HTMLElement | null>(null)
const proseEl = ref<HTMLElement | null>(null)
const html = ref('')
const errorMsg = ref('')
const lightboxSrc = ref('')
const lightboxSvg = ref('')
const progress = ref(0)
const showBackTop = ref(false)
const searchNav = ref<{ total: number; idx: number } | null>(null)

let headings: HTMLElement[] = []
let loadSeq = 0
let currentKind = ''
let rawContent = ''
const sourceMode = ref(false)
let scrollSaveTimer: ReturnType<typeof setTimeout> | null = null
let searchRanges: Range[] = []

function scrollKey(): string {
  return `inkread:scroll:${props.repoId}:${props.path}`
}

function clearHighlights(): void {
  try {
    CSS.highlights?.delete('inkread-search')
    CSS.highlights?.delete('inkread-search-current')
  } catch {
    /* 不支持 Highlight API 时忽略 */
  }
}

function clearSearch(): void {
  clearHighlights()
  searchRanges = []
  searchNav.value = null
}

/** markdown 内容按当前视图模式(渲染/源码)生成 html */
function renderNow(): void {
  if (sourceMode.value) {
    html.value = renderPlainText(rawContent, 'markdown')
    emit('toc', [])
  } else {
    const result = renderMarkdown(rawContent, {
      docDir: dirOf(props.path),
      assetUrl: (p) => backend.assetUrl(props.repoId, p),
    })
    html.value = result.html
    emit('toc', result.toc)
  }
}

async function load(): Promise<void> {
  const seq = ++loadSeq
  errorMsg.value = ''
  headings = []
  clearSearch()
  sourceMode.value = false
  emit('source-mode', false)
  emit('toc', [])
  emit('active', '')
  if (!props.path) {
    html.value = ''
    return
  }
  const kind = (currentKind = fileKind(props.path))
  try {
    if (kind === 'image') {
      html.value = `<p style="text-align:center"><img src="${backend.assetUrl(props.repoId, props.path)}" alt=""></p>`
    } else if (kind === 'markdown') {
      const file = await backend.readFile(props.repoId, props.path)
      if (seq !== loadSeq) return
      rawContent = file.content
      renderNow()
    } else if (kind === 'text') {
      const file = await backend.readFile(props.repoId, props.path)
      if (seq !== loadSeq) return
      html.value = renderPlainText(file.content, extOf(props.path))
    } else {
      errorMsg.value = '暂不支持预览该文件类型'
      return
    }
  } catch (e) {
    if (seq !== loadSeq) return
    errorMsg.value = `文档读取失败:${errMsg(e)}`
    return
  }
  await nextTick()
  if (seq !== loadSeq) return
  afterRender()
}

function afterRender(): void {
  const root = proseEl.value
  if (!root) return
  if (currentKind === 'markdown' && !sourceMode.value) {
    transformInfoCards(root)
    void renderMermaidBlocks(root, settings.isDark)
    setupFolding(root)
    headings = Array.from(root.querySelectorAll<HTMLElement>('h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]'))
  } else {
    headings = []
  }
  const saved = Number(localStorage.getItem(scrollKey()) ?? 0)
  if (scroller.value) scroller.value.scrollTop = saved
  updateProgress()
  emit('rendered')
}

/** 切换 源码 ↔ 渲染 视图(仅 markdown) */
async function toggleSource(): Promise<void> {
  if (currentKind !== 'markdown') return
  sourceMode.value = !sourceMode.value
  emit('source-mode', sourceMode.value)
  clearSearch()
  renderNow()
  await nextTick()
  afterRender()
}

// ---------- 标题折叠 ----------
function levelOf(h: Element): number {
  return Number(h.tagName.slice(1))
}

function sectionSiblings(h: Element): Element[] {
  const lv = levelOf(h)
  const out: Element[] = []
  let n = h.nextElementSibling
  while (n) {
    if (/^H[1-6]$/.test(n.tagName) && levelOf(n) <= lv) break
    out.push(n)
    n = n.nextElementSibling
  }
  return out
}

function setupFolding(root: HTMLElement): void {
  for (const h of Array.from(root.querySelectorAll('h2, h3'))) {
    if (sectionSiblings(h).length === 0) continue
    const btn = document.createElement('button')
    btn.className = 'fold-btn'
    btn.type = 'button'
    btn.title = '折叠 / 展开本节'
    btn.textContent = '▾'
    h.prepend(btn)
  }
}

function toggleFold(h: Element): void {
  const folded = h.classList.toggle('is-folded')
  for (const el of sectionSiblings(h)) el.classList.toggle('fold-hidden', folded)
}

function unfoldFor(target: HTMLElement): void {
  const root = proseEl.value
  if (!root) return
  for (const h of Array.from(root.querySelectorAll('.is-folded'))) {
    if (sectionSiblings(h).includes(target) || sectionSiblings(h).some((el) => el.contains(target))) {
      toggleFold(h)
    }
  }
}

// ---------- 滚动 ----------
function updateProgress(): void {
  const el = scroller.value
  if (!el) return
  const max = el.scrollHeight - el.clientHeight
  progress.value = max > 10 ? Math.min(100, (el.scrollTop / max) * 100) : 0
  showBackTop.value = el.scrollTop > 600
}

function onScroll(): void {
  const el = scroller.value
  if (!el) return
  updateProgress()
  if (scrollSaveTimer) clearTimeout(scrollSaveTimer)
  scrollSaveTimer = setTimeout(() => {
    if (el.scrollTop > 40) localStorage.setItem(scrollKey(), String(el.scrollTop))
    else localStorage.removeItem(scrollKey())
  }, 250)
  if (headings.length) {
    const top = el.scrollTop + 90
    let active = headings[0]
    for (const h of headings) {
      if (h.offsetTop <= top) active = h
      else break
    }
    emit('active', active.id)
  }
}

function toTop(): void {
  scroller.value?.scrollTo({ top: 0, behavior: 'smooth' })
}

function scrollToSlug(slug: string): void {
  const root = proseEl.value
  if (!root) return
  let target: HTMLElement | null = null
  try {
    target = root.querySelector<HTMLElement>(`[id="${CSS.escape(slug)}"]`)
  } catch {
    target = null
  }
  if (target) {
    unfoldFor(target)
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

// ---------- 全文搜索命中导航 ----------
function highlightText(rawQuery: string): void {
  const root = proseEl.value
  const query = rawQuery.trim().toLowerCase()
  if (!root || !query) return
  clearSearch()
  const ranges: Range[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    const text = (node.textContent ?? '').toLowerCase()
    let idx = 0
    while ((idx = text.indexOf(query, idx)) >= 0) {
      const r = new Range()
      r.setStart(node, idx)
      r.setEnd(node, idx + query.length)
      ranges.push(r)
      idx += query.length
    }
  }
  if (ranges.length === 0) return
  searchRanges = ranges
  applyHit(0)
}

function applyHit(i: number): void {
  if (searchRanges.length === 0) return
  searchNav.value = { total: searchRanges.length, idx: i }
  try {
    if (CSS.highlights) {
      CSS.highlights.set('inkread-search', new Highlight(...searchRanges))
      CSS.highlights.set('inkread-search-current', new Highlight(searchRanges[i]))
    }
  } catch {
    /* 不支持时仅滚动 */
  }
  const el = searchRanges[i].startContainer.parentElement
  if (el) {
    unfoldFor(el)
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}

function stepHit(dir: number): void {
  if (!searchNav.value || searchRanges.length === 0) return
  const n = (searchNav.value.idx + dir + searchRanges.length) % searchRanges.length
  applyHit(n)
}

// ---------- 点击委托 ----------
function closeLightbox(): void {
  lightboxSrc.value = ''
  lightboxSvg.value = ''
}

function onClick(e: MouseEvent): void {
  const el = e.target as HTMLElement

  const foldBtn = el.closest<HTMLElement>('.fold-btn')
  if (foldBtn && foldBtn.parentElement) {
    toggleFold(foldBtn.parentElement)
    return
  }

  const copyBtn = el.closest<HTMLElement>('.code-copy')
  if (copyBtn) {
    const pre = copyBtn.closest('.code-block')?.querySelector('.code-pre')
    const text = pre?.textContent ?? ''
    navigator.clipboard.writeText(text).then(
      () => {
        copyBtn.textContent = '已复制'
        setTimeout(() => (copyBtn.textContent = '复制'), 1500)
      },
      () => toast('复制失败', true),
    )
    return
  }

  const link = el.closest<HTMLAnchorElement>('a[href]')
  if (link) {
    const href = link.getAttribute('href') ?? ''
    if (href.startsWith('#')) {
      e.preventDefault()
      let slug = href.slice(1)
      try {
        slug = decodeURIComponent(slug)
      } catch {
        /* 原样使用 */
      }
      scrollToSlug(slug)
      return
    }
    if (/^https?:\/\//i.test(href)) {
      e.preventDefault()
      void backend.openExternal(href)
      return
    }
    if (/^[a-z]+:/i.test(href)) return
    e.preventDefault()
    const [relRaw, anchorRaw] = href.split('#')
    let rel = relRaw
    try {
      rel = decodeURIComponent(relRaw)
    } catch {
      /* 原样使用 */
    }
    let anchor: string | undefined
    if (anchorRaw) {
      try {
        anchor = decodeURIComponent(anchorRaw)
      } catch {
        anchor = anchorRaw
      }
    }
    emit('open', rel, anchor)
    return
  }

  const mermaidSvg = el.closest<HTMLElement>('.mermaid-target')
  if (mermaidSvg && mermaidSvg.querySelector('svg')) {
    lightboxSvg.value = mermaidSvg.innerHTML
    return
  }

  if (el.tagName === 'IMG' && el.closest('.prose')) {
    lightboxSrc.value = (el as HTMLImageElement).src
    return
  }

  // 未命中任何交互元素:视为点击空白(手机端切换沉浸阅读)
  if (!el.closest('.lightbox') && !el.closest('.search-nav') && !el.closest('.back-top')) {
    emit('tap-blank')
  }
}

watch(
  () => [props.repoId, props.path],
  () => void load(),
  { immediate: true },
)

watch(
  () => settings.isDark,
  () => {
    if (currentKind === 'markdown' && !sourceMode.value && proseEl.value) {
      void renderMermaidBlocks(proseEl.value, settings.isDark)
    }
  },
)

// ---------- 手机双指捏合调字号 ----------
let pinchDist = 0

function touchDist(e: TouchEvent): number {
  const [a, b] = [e.touches[0], e.touches[1]]
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}

function onTouchStart(e: TouchEvent): void {
  if (e.touches.length === 2) pinchDist = touchDist(e)
}

function onTouchMove(e: TouchEvent): void {
  if (e.touches.length !== 2 || pinchDist === 0) return
  const d = touchDist(e)
  const ratio = d / pinchDist
  if (ratio > 1.12) {
    settings.fontSize = Math.min(22, settings.fontSize + 1)
    pinchDist = d
  } else if (ratio < 0.89) {
    settings.fontSize = Math.max(13, settings.fontSize - 1)
    pinchDist = d
  }
}

function onTouchEnd(): void {
  pinchDist = 0
}

watch(scroller, (el, old) => {
  old?.removeEventListener('scroll', onScroll)
  old?.removeEventListener('touchstart', onTouchStart)
  old?.removeEventListener('touchmove', onTouchMove)
  old?.removeEventListener('touchend', onTouchEnd)
  el?.addEventListener('scroll', onScroll, { passive: true })
  el?.addEventListener('touchstart', onTouchStart, { passive: true })
  el?.addEventListener('touchmove', onTouchMove, { passive: true })
  el?.addEventListener('touchend', onTouchEnd, { passive: true })
})

onBeforeUnmount(() => {
  const el = scroller.value
  el?.removeEventListener('scroll', onScroll)
  el?.removeEventListener('touchstart', onTouchStart)
  el?.removeEventListener('touchmove', onTouchMove)
  el?.removeEventListener('touchend', onTouchEnd)
  if (scrollSaveTimer) clearTimeout(scrollSaveTimer)
  clearHighlights()
})

defineExpose({ scrollToSlug, highlightText, reload: load, toggleSource })
</script>

<style scoped>
.doc-error {
  max-width: 46em;
  margin: 40px auto;
  padding: 18px 22px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  color: var(--t2);
  background: var(--bg-side);
  font-size: 14px;
}
</style>
