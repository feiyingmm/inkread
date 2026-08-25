<template>
  <div class="mask mask--center" @click.self="!busy && emit('close')">
    <div class="clone-card">
      <h3>添加本地仓库</h3>

      <div v-if="permChecked && !permOk" class="perm-warn">
        未获得「所有文件访问」权限,无法读取应用外目录。请到:系统设置 → 应用 → 墨阅(Inkread)→ 权限 → 允许管理所有文件,开启后回来重试。
      </div>

      <div class="set-row" style="margin-bottom: 12px">
        <button class="opt is-on" style="height: 40px; flex: 1" :disabled="busy" @click="pickDir">
          <Icon name="folder" :size="16" style="display: inline-block; vertical-align: -3px" />
          选择文件夹…
        </button>
      </div>

      <div class="set-group">
        <div class="set-label">或手动输入仓库目录绝对路径(须包含 .git)</div>
        <input
          v-model="path"
          class="palette-input"
          style="width: 100%"
          placeholder="/storage/emulated/0/Documents/claude-docs"
          :disabled="busy"
        />
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
import { onMounted, ref } from 'vue'
import { backend, isTauri } from '@/core/backend'
import { toast } from '@/core/toast'
import Icon from '@/components/Icon.vue'

const emit = defineEmits<{ close: []; done: [repoId: string] }>()

const path = ref('')
const busy = ref(false)
const permChecked = ref(false)
const permOk = ref(true)

const isAndroid = /android/i.test(navigator.userAgent)

onMounted(async () => {
  if (isTauri && isAndroid) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      permOk.value = await invoke<boolean>('check_storage_access')
    } catch {
      permOk.value = true
    }
    permChecked.value = true
  }
})

/** Android SAF 目录选择返回 content:// tree URI,主存储卷可解析为真实路径 */
function contentUriToPath(uri: string): string | null {
  if (uri.startsWith('/')) return uri
  const m = uri.match(/tree\/([^/]+)$/) ?? uri.match(/tree\/([^/]+)/)
  if (!m) return null
  const decoded = decodeURIComponent(m[1])
  const [volume, rel] = decoded.split(':', 2)
  if (volume === 'primary') return `/storage/emulated/0/${rel ?? ''}`.replace(/\/$/, '')
  if (/^[0-9A-F]{4}-[0-9A-F]{4}$/i.test(volume)) return `/storage/${volume}/${rel ?? ''}`.replace(/\/$/, '')
  return null
}

async function pickDir(): Promise<void> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const picked = await open({ directory: true, title: '选择仓库目录' })
    if (typeof picked !== 'string' || !picked) return
    const real = contentUriToPath(picked)
    if (!real) {
      toast('该位置无法直接访问,请手动输入路径', true)
      return
    }
    path.value = real
    await doAdd()
  } catch (e) {
    toast(typeof e === 'string' ? e : (e as Error).message, true)
  }
}

async function doAdd(): Promise<void> {
  busy.value = true
  try {
    const meta = await backend.addRepoLocal(path.value.trim())
    toast('已添加文库')
    emit('done', meta.id)
    emit('close')
  } catch (e) {
    const msg = typeof e === 'string' ? e : (e as Error).message
    toast(permOk.value ? msg : `${msg}(可能未开启「所有文件访问」权限)`, true)
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.clone-card {
  width: min(460px, calc(100% - 40px));
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
.perm-warn {
  background: #fbe9e0;
  color: #8a3d1d;
  border: 1px solid #edc4ad;
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  font-size: 12.5px;
  line-height: 1.7;
  margin-bottom: 12px;
}
:root[data-mode='dark'] .perm-warn {
  background: #3a2317;
  color: #e8a37d;
  border-color: #5c3a26;
}
</style>
