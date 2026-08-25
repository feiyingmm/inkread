<template>
  <div class="statusbar">
    <template v-if="status">
      <span class="sb-item sb-branch"><Icon name="branch" :size="13" />{{ status.branch }}</span>
      <span v-if="status.behind > 0" class="sb-item" title="远端领先,建议先拉取"
        ><Icon name="arrow-down-sm" :size="12" />{{ status.behind }}</span
      >
      <span v-if="status.ahead > 0" class="sb-item" title="本地有未推送的提交"
        ><Icon name="arrow-up-sm" :size="12" />{{ status.ahead }}</span
      >
      <button
        v-if="status.dirtyCount > 0"
        class="sb-item sb-dirty sb-dirty-btn"
        :title="status.changes.slice(0, 8).map((c) => c.path).join('\n') + '\n点击查看全部变更'"
        @click="emit('show-changes')"
      >
        <span class="sb-dot"></span>{{ status.dirtyCount }} 个未提交变更
      </button>
      <span v-else-if="status.ahead === 0" class="sb-item sb-clean"><Icon name="check" :size="13" />已同步</span>
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
import Icon from '@/components/Icon.vue'

defineProps<{
  status: GitStatus | null
  syncing: boolean
  editMode: boolean
  autoSave: boolean
}>()

const emit = defineEmits<{ sync: []; 'show-changes': [] }>()
</script>
