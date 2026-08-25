<template>
  <div class="mask mask--center" @click.self="!busy && emit('close')">
    <div class="clone-card">
      <h3>添加本地仓库(输入路径)</h3>
      <div class="set-group">
        <div class="set-label">仓库目录的绝对路径(须包含 .git)</div>
        <input
          v-model="path"
          class="palette-input"
          style="width: 100%"
          placeholder="/storage/emulated/0/Documents/claude-docs"
          :disabled="busy"
        />
      </div>
      <div class="set-hint" style="margin-bottom: 12px">
        Android 11+ 访问应用外目录需要「所有文件访问」权限:系统设置 → 应用 → 墨阅 → 权限 → 允许管理所有文件。若添加失败请先开启该权限。
      </div>
      <div class="set-row" style="justify-content: flex-end">
        <button class="opt" :disabled="busy" @click="emit('close')">取消</button>
        <button class="opt is-on" :disabled="busy || !path.trim()" @click="doAdd">
          {{ busy ? '添加中…' : '添加' }}
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

const path = ref('')
const busy = ref(false)

async function doAdd(): Promise<void> {
  busy.value = true
  try {
    const meta = await backend.addRepoLocal(path.value.trim())
    toast('已添加文库')
    emit('done', meta.id)
    emit('close')
  } catch (e) {
    toast(typeof e === 'string' ? e : (e as Error).message, true)
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.clone-card {
  width: min(460px, calc(100vw - 40px));
  margin-top: 90px;
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
</style>
