<template>
  <div ref="scroller" class="content" @click="onClick">
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
    <div v-if="lightboxSrc" class="lightbox" @click="lightboxSrc = ''">
      <img :src="lightboxSrc" alt="" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { backend } from '@/core/backend'
import { dirOf, extOf, fileKind } from '@/core/paths'
import { renderMarkdown, renderPlainText, type TocItem } from '@/core/markdown/pipeline'
import { transformInfoCards } from '@/core/markdown/infocard'
import { renderMermaidBlocks } from '@/core/markdown/mermaid'
import { useSettings } from '@/stores/settings'
import { toast } from '@/core/toast'

const props = defineProps<{
  repoId: string
  path: string
}>()

const emit = defineEmits<{
  toc: [items: TocItem[]]
  active: [slug: string]
  open: [path: string, anchor?: string]
  rendered: []
}>()

const settings = useSettings()

const scroller = ref<HTMLElement | null>(null)
const proseEl = ref<HTMLElement | null>(null)
const html = ref('')
const errorMsg = ref('')
const lightboxSrc = ref('')

let headings: HTMLElement[] = []
let loadSeq = 0
let currentKind = ''
let scrollSaveTimer: ReturnType<typeof setTimeout> | null = null

function scrollKey(): string {
  return `inkread:scroll:${props.repoId}:${props.path}`
}

function clearHighlights(): void {
  try {
    CSS.highlights?.delete('inkread-search')
  } catch {
    /* 不支持 Highlight API 时忽略 */
  }
}

async function load(): Promise<void> {
  const seq = ++loadSeq
  errorMsg.value = ''
  headings = []
  clearHighlights()
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
      const result = renderMarkdown(file.content, {
        docDir: dirOf(props.path),
        assetUrl: (p) => backend.assetUrl(props.repoId, p),
      })
      html.value = result.html
      emit('toc', result.toc)
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
    errorMsg.value = `文档读取失败:${(e as Error).message}`
    return
  }
  await nextTick()
  if (seq !== loadSeq) return
  afterRender()
}

function afterRender(): void {
  const root = proseEl.value
  if (!root) return
  if (currentKind === 'markdown') {
    transformInfoCards(root)
    void renderMermaidBlocks(root, settings.isDark)
    headings = Array.from(root.querySelectorAll<HTMLElement>('h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]'))
  }
  const saved = Number(localStorage.getItem(scrollKey()) ?? 0)
  if (scroller.value) scroller.value.scrollTop = saved
  emit('rendered')
}

function onScroll(): void {
  const el = scroller.value
  if (!el) return
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

function scrollToSlug(slug: string): void {
  const root = proseEl.value
  if (!root) return
  let target: HTMLElement | null = null
  try {
    target = root.querySelector<HTMLElement>(`[id="${CSS.escape(slug)}"]`)
  } catch {
    target = null
  }
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/** 全文搜索跳转:高亮所有命中并滚动到第一处 */
function highlightText(rawQuery: string): void {
  const root = proseEl.value
  const query = rawQuery.trim().toLowerCase()
  if (!root || !query) return
  clearHighlights()
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
  try {
    if (CSS.highlights) {
      CSS.highlights.set('inkread-search', new Highlight(...ranges))
    }
  } catch {
    /* 不支持 Highlight API 时仅滚动 */
  }
  const first = ranges[0].startContainer.parentElement
  first?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

function onClick(e: MouseEvent): void {
  const el = e.target as HTMLElement

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

  if (el.tagName === 'IMG' && el.closest('.prose') && !el.closest('.mermaid-target')) {
    lightboxSrc.value = (el as HTMLImageElement).src
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
    if (currentKind === 'markdown' && proseEl.value) {
      void renderMermaidBlocks(proseEl.value, settings.isDark)
    }
  },
)

watch(scroller, (el, old) => {
  old?.removeEventListener('scroll', onScroll)
  el?.addEventListener('scroll', onScroll, { passive: true })
})

onBeforeUnmount(() => {
  scroller.value?.removeEventListener('scroll', onScroll)
  if (scrollSaveTimer) clearTimeout(scrollSaveTimer)
})

defineExpose({ scrollToSlug, highlightText, reload: load })
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
