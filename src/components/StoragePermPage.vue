<template>
  <MobilePage title="存储权限" lead="close" :mask-close="false" @back="dismiss">
    <div class="sp">
      <div class="sp-ic"><Icon name="shield" :size="32" /></div>
      <h4 class="sp-h">墨阅需要「所有文件访问」</h4>
      <p class="sp-p">
        你的文库是手机里的 git 仓库目录。Android 11 起收紧了外部存储访问——
        <b>没有这个权限时,墨阅只能看见目录名,读不到里面任何一个文件</b>:
        文件树会只剩空目录、git 状态显示不可用、新建文档会失败。
      </p>
      <p class="sp-p sp-p--muted">
        墨阅只读写你亲手选中的文库目录,不上传、不扫描其它内容。
      </p>
      <div class="sp-state" :class="{ 'is-ok': granted }">
        <Icon :name="granted ? 'check' : 'info'" :size="15" />
        <span>{{ granted ? '已授权,可以正常使用' : '当前未授权' }}</span>
      </div>
    </div>

    <template #footer>
      <button class="opt" @click="dismiss">以后再说</button>
      <button class="opt is-on sp-go" @click="go">{{ granted ? '完成' : '去开启权限' }}</button>
    </template>
  </MobilePage>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from '@/components/Icon.vue'
import MobilePage from '@/components/MobilePage.vue'
import { checkStorageAccess, markPrompted, requestStorageAccess } from '@/core/storage-perm'
import { errMsg } from '@/core/errmsg'
import { toast } from '@/core/toast'

const emit = defineEmits<{ close: [] }>()

const granted = ref(false)

async function refresh(): Promise<void> {
  granted.value = await checkStorageAccess()
}

async function go(): Promise<void> {
  if (granted.value) {
    dismiss()
    return
  }
  try {
    await requestStorageAccess()
  } catch (e) {
    toast(errMsg(e), true)
  }
}

function dismiss(): void {
  markPrompted()
  emit('close')
}

/** 从系统授权页切回来时复查:开好了就直接放行,省得用户再点一次 */
function onVisible(): void {
  if (document.visibilityState !== 'visible') return
  void checkStorageAccess().then((ok) => {
    granted.value = ok
    if (ok) {
      toast('存储权限已开启')
      dismiss()
    }
  })
}

onMounted(() => {
  void refresh()
  document.addEventListener('visibilitychange', onVisible)
})
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisible))
</script>

<style scoped>
.sp {
  text-align: center;
  padding: 10px 4px;
}
.sp-ic {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 66px;
  height: 66px;
  border-radius: 20px;
  background: var(--accent-soft);
  color: var(--accent-deep);
  margin-bottom: 14px;
}
.sp-h {
  margin: 0 0 12px;
  font-family: var(--font-serif);
  font-size: 17px;
  color: var(--t1);
}
.sp-p {
  margin: 0 0 12px;
  font-size: 13.5px;
  line-height: 1.9;
  color: var(--t2);
  text-align: left;
}
.sp-p--muted {
  color: var(--t3);
  font-size: 12.5px;
}
.sp-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  background: var(--bg-side);
  font-size: 12.5px;
  color: var(--t3);
}
.sp-state.is-ok {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-deep);
}
.sp-go {
  flex: 1;
}
</style>
