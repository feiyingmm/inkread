<template>
  <router-view />
  <div class="toasts">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="{ 'is-error': t.error }">{{ t.text }}</div>
  </div>
</template>

<script setup lang="ts">
import { watchEffect } from 'vue'
import { useSettings } from '@/stores/settings'
import { toasts } from '@/core/toast'

const settings = useSettings()

watchEffect(() => {
  const el = document.documentElement
  el.dataset.brand = settings.brand
  el.dataset.mode = settings.isDark ? 'dark' : 'light'
  el.style.setProperty('--prose-size', `${settings.fontSize}px`)
})
</script>
