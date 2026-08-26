<template>
  <div class="mask mask--center mask--sheet" @click.self="emit('close')">
    <div class="conflict">
      <h3>{{ mode === 'pull' ? '拉取失败' : '推送失败' }}</h3>
      <p v-if="mode === 'pull'">
        本地有未同步的修改,与远端更新相互阻碍。墨阅不代为合并内容。
      </p>
      <p v-else>
        本地提交与远端修改存在冲突。墨阅不会覆盖远程内容,也不代为合并。
      </p>
      <p class="conflict-detail" v-if="detail">{{ detail }}</p>
      <p>
        建议:用 git 工具(命令行 / TortoiseGit 等)在仓库目录完成合并后,回到墨阅继续同步;
        或选择放弃本地修改,直接与远端保持一致。
      </p>
      <div class="conflict-actions">
        <button class="opt" @click="emit('close')">稍后用 git 工具处理</button>
        <button class="opt opt--danger" @click="emit('discard')">放弃本地修改,与远端一致</button>
      </div>
      <p class="conflict-note">「放弃本地修改」会把本仓库未推送的改动重置为远端版本(新建且未跟踪的文件保留),不可恢复。</p>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  mode: 'pull' | 'push'
  detail?: string
}>()

const emit = defineEmits<{
  close: []
  discard: []
}>()
</script>

<style scoped>
.conflict {
  width: min(460px, calc(100vw - 60px));
  margin-top: 110px;
  background: var(--bg-card);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
  padding: 20px 22px;
}
.conflict h3 {
  margin: 0 0 10px;
  font-family: var(--font-serif);
  font-size: 16px;
  color: var(--t1);
}
.conflict p {
  margin: 0 0 12px;
  font-size: 13.5px;
  color: var(--t2);
  line-height: 1.7;
}
.conflict-detail {
  font-size: 12px !important;
  color: var(--t3) !important;
  background: var(--bg-side);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  word-break: break-all;
}
.conflict-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.opt--danger {
  border-color: var(--code-fg);
  color: var(--code-fg);
}
.conflict-note {
  font-size: 12px !important;
  color: var(--t3) !important;
  margin-bottom: 0 !important;
}
@media (max-width: 900px) {
  .conflict {
    margin: 0;
    width: 100vw;
    border: none;
    border-radius: 18px 18px 0 0;
    box-shadow: 0 -8px 40px rgba(5, 12, 20, 0.35);
    padding: 20px 18px calc(18px + var(--safe-bottom));
    animation: sheet-up 0.22s ease;
  }
  .conflict h3 {
    font-size: 17px;
    text-align: center;
  }
}
</style>
