<template>
  <div class="statusbar">
    <template v-if="status">
      <span class="sb-item sb-branch">⎇ {{ status.branch }}</span>
      <span v-if="status.behind > 0" class="sb-item" title="远端领先,建议先拉取">↓{{ status.behind }}</span>
      <span v-if="status.ahead > 0" class="sb-item" title="本地有未推送的提交">↑{{ status.ahead }}</span>
      <span v-if="status.dirtyCount > 0" class="sb-item sb-dirty" :title="status.dirtyFiles.join('\n')">
        ● {{ status.dirtyCount }} 个未提交变更
      </span>
      <span v-else-if="status.ahead === 0" class="sb-item sb-clean">✓ 已同步</span>
    </template>
    <span v-else class="sb-item">git 状态不可用</span>
    <span class="sb-flex"></span>
    <span v-if="editMode" class="sb-item sb-hint">{{
      autoSave ? '编辑模式 · 自动保存已开启 · Ctrl+E 返回阅读' : '编辑模式 · Ctrl+S 或顶栏按钮保存 · Ctrl+E 返回阅读'
    }}</span>
    <button
      v-if="status && (status.dirtyCount > 0 || status.ahead > 0)"
      class="sb-sync"
      :disabled="syncing"
      @click="emit('sync')"
    >
      {{ syncing ? '同步中…' : '提交并推送' }}
    </button>
  </div>
</template>

<script setup lang="ts">
import type { GitStatus } from '@/core/backend'

defineProps<{
  status: GitStatus | null
  syncing: boolean
  editMode: boolean
  autoSave: boolean
}>()

const emit = defineEmits<{ sync: [] }>()
</script>
