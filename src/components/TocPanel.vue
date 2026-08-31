<template>
  <div class="toc" :class="{ 'is-closed': !open }">
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
import { computed, reactive, ref, watch } from 'vue'
import Icon from '@/components/Icon.vue'
import TocTree from '@/components/TocTree.vue'
import { ancestorSlugs, branchSlugs, buildTocTree } from '@/core/toc-tree'
import type { TocItem } from '@/core/markdown/pipeline'

const props = defineProps<{
  items: TocItem[]
  activeSlug: string
  open: boolean
}>()

const emit = defineEmits<{ jump: [slug: string] }>()

const tree = computed(() => buildTocTree(props.items))
const branches = computed(() => branchSlugs(tree.value))
const trail = computed(() => ancestorSlugs(tree.value, props.activeSlug))

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
