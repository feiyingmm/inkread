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
    <!-- 普通文件夹文库没有分支/变更可言,别报"git 状态不可用"吓人 -->
    <span v-else-if="!isGit" class="sb-item"><Icon name="folder" :size="13" />本地文库</span>
    <span v-else class="sb-item">git 状态不可用</span>
    <span class="sb-flex"></span>
    <!-- 编辑模式的字数统计:选中时改报选中量(与语雀 / Typora 一致) -->
    <span v-if="editMode && stats" class="sb-item sb-stats" title="字数不含空白字符">
      {{ stats.selected > 0 ? `选中 ${stats.selected} 字` : `${stats.chars} 字` }} · {{ stats.lines }} 行
    </span>
    <span v-if="editMode" class="sb-item sb-hint">{{
      autoSave ? '编辑模式 · 自动保存已开启 · Ctrl+E 返回阅读' : '编辑模式 · Ctrl+S 保存 · Ctrl+F 查找 · Ctrl+E 返回阅读'
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
import type { DocStats } from '@/core/doc-stats'
import Icon from '@/components/Icon.vue'

defineProps<{
  status: GitStatus | null
  /** 当前文库是不是 git 仓库;false 时状态栏不谈 git */
  isGit: boolean
  syncing: boolean
  editMode: boolean
  autoSave: boolean
  stats?: DocStats | null
}>()

const emit = defineEmits<{ sync: []; 'show-changes': [] }>()
</script>
