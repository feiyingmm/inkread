<template>
  <div class="sheet-mask" @click.self="emit('close')">
    <div class="sheet">
      <div class="sheet-grip"></div>
      <div class="sheet-title">目录</div>
      <div class="sheet-body">
        <button
          v-for="item in items"
          :key="item.slug"
          class="toc-item"
          :class="{ 'is-active': item.slug === activeSlug }"
          :style="{ paddingLeft: `${12 + (item.level - minLevel) * 16}px` }"
          @click="onJump(item.slug)"
        >
          {{ item.title }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { TocItem } from '@/core/markdown/pipeline'

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
.sheet-mask {
  position: fixed;
  inset: 0;
  background: rgba(8, 15, 24, 0.45);
  z-index: 60;
}
.sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  max-height: 62vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-card);
  border-radius: 18px 18px 0 0;
  box-shadow: 0 -8px 40px rgba(5, 12, 20, 0.35);
  animation: sheet-up 0.22s ease;
  padding-bottom: env(safe-area-inset-bottom, 8px);
}
@keyframes sheet-up {
  from {
    transform: translateY(30%);
    opacity: 0.6;
  }
  to {
    transform: none;
    opacity: 1;
  }
}
.sheet-grip {
  width: 40px;
  height: 4px;
  border-radius: 2px;
  background: var(--line-strong);
  margin: 10px auto 4px;
  flex-shrink: 0;
}
.sheet-title {
  font-size: 13px;
  color: var(--t3);
  padding: 4px 18px 8px;
  flex-shrink: 0;
}
.sheet-body {
  overflow-y: auto;
  padding: 0 10px 16px;
}
.sheet-body .toc-item {
  font-size: 14px;
  padding-top: 9px;
  padding-bottom: 9px;
  white-space: normal;
}
</style>
