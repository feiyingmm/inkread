<template>
  <div class="toc" :class="{ 'is-closed': !open }">
    <template v-if="open">
      <div class="toc-title">目录</div>
      <button
        v-for="item in items"
        :key="item.slug"
        class="toc-item"
        :class="{ 'is-active': item.slug === activeSlug }"
        :style="{ paddingLeft: `${10 + (item.level - minLevel) * 14}px` }"
        :title="item.title"
        @click="emit('jump', item.slug)"
      >
        {{ item.title }}
      </button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { TocItem } from '@/core/markdown/pipeline'

const props = defineProps<{
  items: TocItem[]
  activeSlug: string
  open: boolean
}>()

const emit = defineEmits<{ jump: [slug: string] }>()

const minLevel = computed(() => (props.items.length ? Math.min(...props.items.map((i) => i.level)) : 1))
</script>
