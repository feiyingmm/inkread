<template>
  <router-view />
  <div class="toasts">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="{ 'is-error': t.error }">{{ t.text }}</div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, watchEffect } from 'vue'
import { useSettings } from '@/stores/settings'
import { toasts } from '@/core/toast'
import { backend } from '@/core/backend'
import { registerFontFaces } from '@/core/fonts'

const settings = useSettings()

// 已下载的扩展字体每次启动都要重新登记 @font-face —— 字体文件在应用数据目录里,
// WebView 不会自己知道它们的存在。登记失败不该挡住阅读,静默跳过即可
// (选中的字体加载不出来时,--font-body 里排在后面的系统字体链会自动接住,不会出豆腐块)。
onMounted(async () => {
  try {
    const list = await backend.fontInstalled()
    if (list.length > 0) registerFontFaces(list, backend.fontUrl)
  } catch {
    /* 忽略 */
  }
})

if (/android/i.test(navigator.userAgent)) {
  document.documentElement.dataset.android = '1'
}

watchEffect(() => {
  const el = document.documentElement
  el.dataset.brand = settings.brand
  el.dataset.mode = settings.isDark ? 'dark' : 'light'
  el.dataset.paper = settings.paper
  el.style.setProperty('--prose-size', `${settings.fontSize}px`)
  // 空字体名 = 跟随系统,交回给 tokens.css 里的 --font-sans;
  // 选了具体字体则把它排在系统字体链前面,缺字时仍能回退,不会出现豆腐块
  el.style.setProperty('--font-body', settings.bodyFont ? `"${settings.bodyFont}", var(--font-sans)` : 'var(--font-sans)')
  el.style.setProperty('--prose-line', String(settings.lineHeight))
  el.style.setProperty('--prose-para', `${settings.paraGap}em`)
  el.style.setProperty('--prose-ls', `${settings.letterSpacing}em`)
  el.style.setProperty('--prose-indent', settings.indent ? '2em' : '0')
})
</script>
