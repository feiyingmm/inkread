<template>
  <MobilePage title="目录" flush @back="emit('close')">
    <div class="toc-list">
      <div v-if="items.length === 0" class="palette-empty">本文没有标题</div>
      <button
        v-for="item in items"
        :key="item.slug"
        class="toc-item"
        :class="{ 'is-active': item.slug === activeSlug }"
        :style="{ paddingLeft: `${16 + (item.level - minLevel) * 16}px` }"
        @click="onJump(item.slug)"
      >
        {{ item.title }}
      </button>
    </div>
  </MobilePage>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { TocItem } from '@/core/markdown/pipeline'
import MobilePage from '@/components/MobilePage.vue'

const props = defineProps<{
  items: TocItem[]
  activeSlug: string
}>()

const emit = defineEmits<{ jump: [slug: string]; close: [] }>()

const minLevel = computed(() => (props.items.length ? Math.min(...props.items.map((i) => i.level)) : 1))

function onJump(slug: string): void {
  emit('jump', slug)
  emit('close')
}
</script>

<style scoped>
.toc-list {
  padding: 8px 6px;
}
.toc-list .toc-item {
  font-size: 14.5px;
  padding-top: 11px;
  padding-bottom: 11px;
  padding-right: 14px;
  white-space: normal;
  line-height: 1.6;
}
</style>
