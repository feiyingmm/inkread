<template>
  <div class="mask mask--center" @click.self="emit('cancel')">
    <div class="conflict">
      <h3>同步冲突</h3>
      <p>本地与远端修改了相同内容,无法自动合并。选择保留哪个版本:</p>
      <div class="conflict-actions">
        <button class="opt opt--danger" @click="emit('resolve', 'local')">以本地为准</button>
        <button class="opt" @click="emit('resolve', 'remote')">以远端为准</button>
        <button class="opt" @click="emit('cancel')">取消</button>
      </div>
      <p class="conflict-note">以本地为准:冲突处保留这台设备的修改;以远端为准:冲突处采用远端(如 Claude 推送)的版本。</p>
    </div>
  </div>
</template>

<script setup lang="ts">
const emit = defineEmits<{
  resolve: [strategy: 'local' | 'remote']
  cancel: []
}>()
</script>

<style scoped>
.conflict {
  width: min(430px, calc(100vw - 60px));
  margin-top: 120px;
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
  margin: 0 0 14px;
  font-size: 13.5px;
  color: var(--t2);
  line-height: 1.7;
}
.conflict-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
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
</style>
