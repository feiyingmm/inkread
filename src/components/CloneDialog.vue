<template>
  <div class="mask mask--center" @click.self="!cloning && emit('close')">
    <div class="clone-card">
      <h3>克隆远程仓库</h3>
      <div class="set-group">
        <div class="set-label">HTTPS 仓库地址</div>
        <input v-model="url" class="palette-input" style="width: 100%" placeholder="https://gitee.com/xxx/claude-docs.git" :disabled="cloning" />
      </div>
      <div class="set-group">
        <div class="set-label">访问令牌(私有仓库必填,公开仓库留空)</div>
        <input v-model="token" class="palette-input" style="width: 100%" type="password" placeholder="Gitee/GitHub Personal Access Token" :disabled="cloning" />
      </div>
      <div class="set-row" style="justify-content: flex-end">
        <button class="opt" :disabled="cloning" @click="emit('close')">取消</button>
        <button class="opt is-on" :disabled="cloning || !url.trim()" @click="doClone">
          {{ cloning ? '克隆中,请稍候…' : '开始克隆' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { backend } from '@/core/backend'
import { toast } from '@/core/toast'

const emit = defineEmits<{ close: []; done: [repoId: string] }>()

const url = ref('')
const token = ref('')
const cloning = ref(false)

async function doClone(): Promise<void> {
  cloning.value = true
  try {
    const meta = await backend.addRepoClone(url.value.trim(), token.value.trim() || undefined)
    toast('克隆完成')
    emit('done', meta.id)
    emit('close')
  } catch (e) {
    toast((e as Error).message, true)
  } finally {
    cloning.value = false
  }
}
</script>

<style scoped>
.clone-card {
  width: min(440px, calc(100vw - 50px));
  margin-top: 110px;
  background: var(--bg-card);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
  padding: 20px 22px;
}
.clone-card h3 {
  margin: 0 0 14px;
  font-family: var(--font-serif);
  font-size: 16px;
  color: var(--t1);
}
@media (max-width: 900px) {
  .clone-card {
    margin-top: 16px;
    width: calc(100vw - 24px);
  }
}
</style>
