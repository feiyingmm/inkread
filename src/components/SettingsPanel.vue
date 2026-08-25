<template>
  <div class="mask" @click.self="emit('close')">
    <div class="settings">
      <h3>设置</h3>

      <div class="set-group">
        <div class="set-label">品牌主题</div>
        <div class="set-row">
          <button
            class="swatch swatch--ink"
            :class="{ 'is-on': settings.brand === 'ink' }"
            title="墨青黛蓝"
            @click="settings.brand = 'ink'"
          ></button>
          <button
            class="swatch swatch--violet"
            :class="{ 'is-on': settings.brand === 'violet' }"
            title="紫罗兰"
            @click="settings.brand = 'violet'"
          ></button>
          <span style="font-size: 12px; color: var(--t3)">{{ settings.brand === 'ink' ? '墨青黛蓝' : '紫罗兰' }}</span>
        </div>
      </div>

      <div class="set-group">
        <div class="set-label">明暗模式</div>
        <div class="set-row">
          <button class="opt" :class="{ 'is-on': settings.mode === 'auto' }" @click="settings.mode = 'auto'">跟随系统</button>
          <button class="opt" :class="{ 'is-on': settings.mode === 'light' }" @click="settings.mode = 'light'">浅色</button>
          <button class="opt" :class="{ 'is-on': settings.mode === 'dark' }" @click="settings.mode = 'dark'">深色</button>
        </div>
      </div>

      <div class="set-group">
        <div class="set-label">阅读宽度</div>
        <div class="set-row">
          <button class="opt" :class="{ 'is-on': settings.width === 'book' }" @click="settings.width = 'book'">书卷版心</button>
          <button class="opt" :class="{ 'is-on': settings.width === 'wide' }" @click="settings.width = 'wide'">宽页展开</button>
        </div>
      </div>

      <div class="set-group">
        <div class="set-label">正文字号:{{ settings.fontSize }}px</div>
        <input v-model.number="settings.fontSize" type="range" min="14" max="20" step="1" class="set-range" />
      </div>

      <div class="set-group">
        <div class="set-label">正文字体</div>
        <div class="set-row">
          <button class="opt" :class="{ 'is-on': !settings.serifBody }" @click="settings.serifBody = false">系统黑体</button>
          <button class="opt" :class="{ 'is-on': settings.serifBody }" @click="settings.serifBody = true">霞鹜文楷</button>
        </div>
      </div>

      <div class="set-group">
        <div class="set-label">同步</div>
        <div class="set-row">
          <button class="opt" :class="{ 'is-on': settings.autoPull }" @click="settings.autoPull = !settings.autoPull">
            启动时自动拉取 {{ settings.autoPull ? '开' : '关' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSettings } from '@/stores/settings'

const emit = defineEmits<{ close: [] }>()
const settings = useSettings()
</script>
