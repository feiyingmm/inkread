<template>
  <MobilePage :title="`本地变更(${changes.length})`" flush :wide="!isNarrow" :no-scroll="!isNarrow" @back="emit('close')">
    <div class="cp" :class="{ 'cp--split': !isNarrow }">
      <div class="cp-list">
        <div v-if="changes.length === 0" class="palette-empty">工作区干净,没有未提交的修改</div>
        <div
          v-for="c in changes"
          :key="c.path"
          class="change-row"
          :class="{ 'is-on': !isNarrow && selected?.path === c.path }"
        >
          <button class="chg-main" title="查看改动" @click="selected = c">
            <span class="chg-badge" :class="`chg--${c.kind}`">{{ KIND_LABEL[c.kind] }}</span>
            <span class="chg-path">{{ c.path }}</span>
          </button>
          <button
            class="chg-undo"
            :title="c.kind === 'untracked' ? '撤销:删除该新增文件' : '撤销修改,恢复到最近提交版本'"
            @click="emit('discard', c)"
          >
            <Icon name="undo" :size="15" />
          </button>
        </div>
      </div>

      <!-- 桌面:右侧直接看改动;手机屏幕放不下两栏,改动是叠上去的二级页(见下) -->
      <div v-if="!isNarrow" class="cp-diff">
        <DiffView
          v-if="selected"
          :key="selected.path"
          :repo-id="repoId"
          :change="selected"
          @open="emit('open', selected.path)"
          @discard="emit('discard', selected)"
        />
        <div v-else class="cp-empty">点左侧的文件查看改动内容</div>
      </div>
    </div>

    <template #footer>
      <span class="chg-hint">「提交并推送」会包含以上全部变更</span>
      <button class="sb-sync" :disabled="changes.length === 0 || syncing" @click="emit('sync')">
        {{ syncing ? '同步中…' : '提交并推送' }}
      </button>
    </template>
  </MobilePage>

  <!-- 手机:改动详情是叠在列表之上的二级整屏页,系统返回键先退它、再退列表 -->
  <MobilePage v-if="isNarrow && selected" :title="fileName(selected.path)" flush no-scroll @back="selected = null">
    <DiffView
      :key="selected.path"
      :repo-id="repoId"
      :change="selected"
      @open="emit('open', selected.path)"
      @discard="emit('discard', selected)"
    />
  </MobilePage>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type { GitChange, GitChangeKind } from '@/core/backend'
import Icon from '@/components/Icon.vue'
import MobilePage from '@/components/MobilePage.vue'
import DiffView from '@/components/DiffView.vue'

const props = defineProps<{
  repoId: string
  changes: GitChange[]
  syncing: boolean
}>()

const emit = defineEmits<{
  close: []
  open: [path: string]
  sync: []
  discard: [change: GitChange]
}>()

const KIND_LABEL: Record<GitChangeKind, string> = {
  modified: '改',
  added: '增',
  untracked: '新',
  deleted: '删',
  renamed: '移',
}

const narrowMq = window.matchMedia('(max-width: 900px)')
const isNarrow = ref(narrowMq.matches)
narrowMq.addEventListener('change', (e) => (isNarrow.value = e.matches))

/** 正在看改动的那个文件;桌面端打开面板就默认选中第一个,省一次点击 */
const selected = ref<GitChange | null>(null)

watch(
  () => props.changes,
  (list) => {
    // 撤销 / 提交之后列表刷新,选中的那条可能已经不在了
    if (selected.value && !list.some((c) => c.path === selected.value!.path)) selected.value = null
    if (!isNarrow.value && !selected.value && list.length > 0) selected.value = list[0]!
  },
  { immediate: true },
)

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}
</script>

<style scoped>
.cp {
  flex: 1;
  min-width: 0;
  min-height: 0;
}
.cp--split {
  display: flex;
}
.cp-list {
  padding: 8px 10px;
}
.cp--split .cp-list {
  width: 250px;
  flex-shrink: 0;
  overflow-y: auto;
  border-right: 1px solid var(--line);
  padding: 8px 6px;
}
.cp-diff {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.cp-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--t3);
  font-size: 13px;
}
.change-row {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  border-radius: var(--radius-sm);
}
.change-row:hover {
  background: var(--bg-hover);
}
.change-row.is-on {
  background: var(--accent-soft);
}
.chg-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  border: none;
  background: none;
  text-align: left;
  padding: 7px 10px;
  cursor: pointer;
}
.chg-undo {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  margin-right: 4px;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--t3);
  cursor: pointer;
}
.chg-undo:hover {
  background: var(--accent-soft);
  color: var(--accent-deep);
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
.chg-hint {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--t3);
}
@media (max-width: 900px) {
  .chg-main {
    padding: 12px 10px;
  }
  .chg-undo {
    width: 40px;
    height: 40px;
  }
  .chg-hint {
    display: none;
  }
  .sb-sync {
    flex: 1;
    height: 42px;
    font-size: 14px;
  }
}
</style>
