<template>
  <MobilePage title="大纲" flush @back="emit('close')">
    <template #actions>
      <button
        v-if="branches.length > 0"
        class="ts-act"
        :title="allCollapsed ? '展开全部' : '折叠全部'"
        :aria-label="allCollapsed ? '展开全部' : '折叠全部'"
        @click="toggleAll"
      >
        <Icon :name="allCollapsed ? 'expand-all' : 'collapse-all'" :size="19" />
      </button>
    </template>

    <div class="toc-list">
      <div v-if="items.length === 0" class="palette-empty">本文没有标题</div>
      <TocTree
        v-else
        :nodes="tree"
        :active-slug="activeSlug"
        :collapsed="collapsed"
        :trail="trail"
        @jump="onJump"
        @toggle="toggle"
      />
    </div>
  </MobilePage>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import Icon from '@/components/Icon.vue'
import MobilePage from '@/components/MobilePage.vue'
import TocTree from '@/components/TocTree.vue'
import { ancestorSlugs, branchSlugs, buildTocTree } from '@/core/toc-tree'
import type { TocItem } from '@/core/markdown/pipeline'

const props = defineProps<{
  items: TocItem[]
  activeSlug: string
}>()

const emit = defineEmits<{ jump: [slug: string]; close: [] }>()

const tree = computed(() => buildTocTree(props.items))
const branches = computed(() => branchSlugs(tree.value))
const trail = computed(() => ancestorSlugs(tree.value, props.activeSlug))

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

function onJump(slug: string): void {
  emit('jump', slug)
  emit('close')
}
</script>

<style scoped>
.toc-list {
  padding: 8px 8px calc(16px + var(--safe-bottom));
}
.ts-act {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border: none;
  border-radius: 50%;
  background: none;
  color: var(--t2);
  cursor: pointer;
}
.ts-act:active {
  background: var(--bg-hover);
}
</style>
