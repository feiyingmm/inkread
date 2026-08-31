<template>
  <MobilePage title="克隆远程仓库" :busy="cloning" :mask-close="!cloning" @back="emit('close')">
    <div class="set-group">
      <div class="set-label">HTTPS 仓库地址</div>
      <input
        v-model="url"
        class="palette-input full"
        placeholder="https://gitee.com/xxx/claude-docs.git"
        :disabled="cloning"
      />
    </div>
    <div class="set-group">
      <div class="set-label">访问令牌(私有仓库必填,公开仓库留空)</div>
      <input
        v-model="token"
        class="palette-input full"
        type="password"
        placeholder="Gitee/GitHub Personal Access Token"
        :disabled="cloning"
      />
    </div>
    <p class="hint">克隆下来的文库存放在应用私有目录,离线可读;后续拉取会复用这里保存的令牌。</p>

    <template #footer>
      <span class="foot-flex"></span>
      <button class="opt" :disabled="cloning" @click="emit('close')">取消</button>
      <button class="opt is-on" :disabled="cloning || !url.trim()" @click="doClone">
        {{ cloning ? '克隆中,请稍候…' : '开始克隆' }}
      </button>
    </template>
  </MobilePage>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { errMsg } from '@/core/errmsg'
import { backend } from '@/core/backend'
import { toast } from '@/core/toast'
import MobilePage from '@/components/MobilePage.vue'

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
    toast(errMsg(e), true)
  } finally {
    cloning.value = false
  }
}
</script>

<style scoped>
.full {
  width: 100%;
}
.hint {
  margin: 4px 0 0;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--t3);
}
.foot-flex {
  flex: 1;
}
@media (max-width: 900px) {
  .full {
    height: 46px;
    font-size: 15px;
  }
  .foot-flex {
    display: none;
  }
}
</style>
