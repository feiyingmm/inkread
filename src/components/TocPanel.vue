<template>
  <div ref="rootEl" class="toc" :class="{ 'is-closed': !open, 'is-peek': peek }">
    <template v-if="open">
      <div class="toc-head">
        <div class="toc-title">大纲</div>
        <button
          v-if="branches.length > 0"
          class="toc-act"
          :title="allCollapsed ? '一键展开全部层级' : '一键折叠全部层级'"
          :aria-label="allCollapsed ? '展开全部' : '折叠全部'"
          @click="toggleAll"
        >
          <Icon :name="allCollapsed ? 'expand-all' : 'collapse-all'" :size="15" />
        </button>
        <!-- 边缘悬浮态专属:把这次临时浮出转成常驻展开 -->
        <button v-if="peek" class="toc-act" title="钉住大纲(常驻显示)" aria-label="钉住大纲" @click="emit('pin')">
          <Icon name="pin" :size="15" />
        </button>
      </div>
      <TocTree
        :nodes="tree"
        :active-slug="activeSlug"
        :collapsed="collapsed"
        :trail="trail"
        @jump="emit('jump', $event)"
        @toggle="toggle"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import Icon from '@/components/Icon.vue'
import TocTree from '@/components/TocTree.vue'
import { ancestorSlugs, branchSlugs, buildTocTree } from '@/core/toc-tree'
import type { TocItem } from '@/core/markdown/pipeline'

const props = withDefaults(
  defineProps<{
    items: TocItem[]
    activeSlug: string
    open: boolean
    /** 边缘悬浮态:浮层覆盖正文,头部多一颗「钉住」 */
    peek?: boolean
  }>(),
  { peek: false },
)

const emit = defineEmits<{ jump: [slug: string]; pin: [] }>()

const tree = computed(() => buildTocTree(props.items))
const branches = computed(() => branchSlugs(tree.value))
const trail = computed(() => ancestorSlugs(tree.value, props.activeSlug))

const rootEl = ref<HTMLElement | null>(null)
// 边缘悬浮的去留判定要拿这个面板的矩形(见 core/edge-peek.ts)
defineExpose({ rootEl })

/**
 * 长文档的大纲比面板高得多,当前标题很容易落在可视区外 —— 高亮了却看不见。
 * 这里只在它确实跑出视野时才滚,滚到面板中间偏上;正在视野内就不动,免得读者
 * 一边滚正文一边看着大纲抽动。
 */
watch(
  () => [props.activeSlug, props.open] as const,
  () => {
    if (!props.open || !props.activeSlug) return
    void nextTick(() => {
      const box = rootEl.value
      const row = box?.querySelector<HTMLElement>('.tt-row.is-active')
      if (!box || !row) return
      const top = row.getBoundingClientRect().top - box.getBoundingClientRect().top
      const pad = 48
      if (top >= pad && top <= box.clientHeight - pad) return
      // 瞬时定位而不是平滑滚动:正文平滑滚动期间 activeSlug 会连续变几十次,
      // 每次都启动一段平滑动画的话互相打断,读者停下来了大纲还在慢慢追
      box.scrollTop = box.scrollTop + top - box.clientHeight * 0.35
    })
  },
  // immediate:打开面板/切回阅读时,当前项本来就在视野外的话也要先亮出来
  { immediate: true },
)

/** slug → 折叠。换文档就清空(默认全展开,不折叠是老行为) */
const collapsed = reactive<Record<string, boolean>>({})
const allCollapsed = ref(false)

watch(
  () => props.items,
  () => {
    for (const k of Object.keys(collapsed)) delete collapsed[k]
    allCollapsed.value = false
  },
)

function toggle(slug: string): void {
  collapsed[slug] = !collapsed[slug]
  allCollapsed.value = branches.value.every((s) => collapsed[s])
}

function toggleAll(): void {
  const next = !allCollapsed.value
  for (const s of branches.value) collapsed[s] = next
  allCollapsed.value = next
}
</script>
