<template>
  <div class="mask mask--center" @click.self="emit('close')">
    <div class="changes-card">
      <h3>本地变更({{ changes.length }})</h3>
      <div class="changes-body">
        <div v-if="changes.length === 0" class="palette-empty">工作区干净,没有未提交的修改</div>
        <button
          v-for="c in changes"
          :key="c.path"
          class="change-row"
          :disabled="c.kind === 'deleted'"
          :title="c.kind === 'deleted' ? '文件已删除' : '打开查看'"
          @click="emit('open', c.path)"
        >
          <span class="chg-badge" :class="`chg--${c.kind}`">{{ KIND_LABEL[c.kind] }}</span>
          <span class="chg-path">{{ c.path }}</span>
        </button>
      </div>
      <div class="changes-foot">
        <span class="chg-hint">「提交并推送」会包含以上全部变更</span>
        <button class="sb-sync" :disabled="changes.length === 0 || syncing" @click="emit('sync')">
          {{ syncing ? '同步中…' : '提交并推送' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { GitChange, GitChangeKind } from '@/core/backend'

defineProps<{
  changes: GitChange[]
  syncing: boolean
}>()

const emit = defineEmits<{
  close: []
  open: [path: string]
  sync: []
}>()

const KIND_LABEL: Record<GitChangeKind, string> = {
  modified: '改',
  added: '增',
  untracked: '新',
  deleted: '删',
  renamed: '移',
}
</script>

<style scoped>
.changes-card {
  width: min(560px, calc(100vw - 50px));
  max-height: min(540px, calc(100vh - 120px));
  display: flex;
  flex-direction: column;
  margin-top: 90px;
  background: var(--bg-card);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
  overflow: hidden;
}
.changes-card h3 {
  margin: 0;
  padding: 16px 20px 12px;
  font-family: var(--font-serif);
  font-size: 16px;
  color: var(--t1);
  flex-shrink: 0;
}
.changes-body {
  flex: 1;
  overflow-y: auto;
  padding: 0 10px 10px;
}
.change-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  border: none;
  background: none;
  text-align: left;
  padding: 7px 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.change-row:hover:not(:disabled) {
  background: var(--bg-hover);
}
.change-row:disabled {
  cursor: default;
  opacity: 0.7;
}
.chg-badge {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  font-size: 11.5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
}
.chg--modified {
  background: #f7edd8;
  color: #8a5f0b;
}
.chg--added,
.chg--untracked {
  background: #e2f2e4;
  color: #2c6e35;
}
.chg--deleted {
  background: #fbe4e4;
  color: #a33636;
}
.chg--renamed {
  background: #e2edf8;
  color: #2b5f8e;
}
:root[data-mode='dark'] .chg--modified {
  background: #3a2f14;
  color: #d9ab4e;
}
:root[data-mode='dark'] .chg--added,
:root[data-mode='dark'] .chg--untracked {
  background: #16311a;
  color: #7ec98a;
}
:root[data-mode='dark'] .chg--deleted {
  background: #3a1a1a;
  color: #e08585;
}
:root[data-mode='dark'] .chg--renamed {
  background: #16283a;
  color: #7fb2dc;
}
.chg-path {
  font-size: 13px;
  color: var(--t1);
  word-break: break-all;
  line-height: 1.5;
}
.changes-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 16px;
  border-top: 1px solid var(--line);
  flex-shrink: 0;
}
.chg-hint {
  font-size: 12px;
  color: var(--t3);
}
</style>
