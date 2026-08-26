<template>
  <div class="mask mask--center mask--sheet" @click.self="!busy && emit('close')">
    <div class="clone-card">
      <h3>添加本地仓库</h3>

      <div v-if="permChecked && !permOk" class="perm-warn">
        <p class="pw-text">
          需要「所有文件访问」权限才能读取应用外目录。已为你打开系统授权页,
          找到墨阅(Inkread)并开启「允许管理所有文件」,返回后将自动继续。
        </p>
        <button class="opt" @click="requestPerm">再次打开授权页</button>
      </div>

      <template v-else>
        <div class="browse-bar">
          <button class="opt bb-up" :disabled="!listing?.parent || busy" @click="goUp">
            <Icon name="up" :size="13" style="display: inline-block; vertical-align: -2px" /> 上一级
          </button>
          <div class="bb-path" :title="listing?.path ?? startPath">{{ listing?.path ?? startPath }}</div>
        </div>

        <div class="browse-list">
          <div v-if="browseError" class="browse-empty">{{ browseError }}</div>
          <div v-else-if="!listing" class="browse-empty">读取中…</div>
          <div v-else-if="listing.dirs.length === 0" class="browse-empty">这里没有子文件夹</div>
          <button v-for="d in listing?.dirs ?? []" :key="d.name" class="browse-row" :disabled="busy" @click="enter(d)">
            <span class="br-ic"><Icon name="folder" :size="16" /></span>
            <span class="br-name">{{ d.name }}</span>
            <span v-if="d.hasGit" class="br-badge">git 仓库</span>
          </button>
        </div>

        <details class="manual-fold">
          <summary>手动输入路径</summary>
          <div class="set-row" style="margin-top: 8px; flex-wrap: nowrap">
            <input
              v-model="manualPath"
              class="palette-input"
              style="flex: 1; min-width: 0"
              placeholder="/storage/emulated/0/Documents/docs"
              :disabled="busy"
            />
            <button class="opt is-on" :disabled="busy || !manualPath.trim()" @click="addPath(manualPath.trim())">添加</button>
          </div>
        </details>
      </template>

      <div class="set-row" style="justify-content: flex-end; margin-top: 14px">
        <button class="opt" :disabled="busy" @click="emit('close')">取消</button>
        <button
          v-if="permOk"
          class="opt is-on"
          :disabled="busy || !listing?.isGit"
          :title="listing?.isGit ? '把当前打开的目录添加为文库' : '当前目录不是 git 仓库(缺少 .git)'"
          @click="listing && addPath(listing.path)"
        >
          {{ busy ? '添加中…' : '添加当前目录' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { backend, isTauri } from '@/core/backend'
import { toast } from '@/core/toast'
import Icon from '@/components/Icon.vue'

interface DirItem {
  name: string
  hasGit: boolean
}
interface DirListing {
  path: string
  parent: string | null
  dirs: DirItem[]
  isGit: boolean
}

const emit = defineEmits<{ close: []; done: [repoId: string] }>()

const busy = ref(false)
const permChecked = ref(false)
const permOk = ref(true)
const listing = ref<DirListing | null>(null)
const browseError = ref('')
const manualPath = ref('')

const isAndroid = /android/i.test(navigator.userAgent)
const startPath = isAndroid ? '/storage/emulated/0' : ''

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

async function load(path: string): Promise<void> {
  browseError.value = ''
  listing.value = null
  try {
    listing.value = await invoke<DirListing>('list_dirs', { path })
  } catch (e) {
    browseError.value = typeof e === 'string' ? e : (e as Error).message
  }
}

function enter(d: DirItem): void {
  if (!listing.value) return
  const next = `${listing.value.path.replace(/[/\\]$/, '')}/${d.name}`
  // 点到 git 仓库目录:直接作为文库添加;普通目录则进入继续浏览
  if (d.hasGit) {
    void addPath(next)
  } else {
    void load(next)
  }
}

function goUp(): void {
  if (listing.value?.parent) void load(listing.value.parent)
}

async function requestPerm(): Promise<void> {
  try {
    await invoke('request_storage_access')
  } catch (e) {
    toast(typeof e === 'string' ? e : (e as Error).message, true)
  }
}

async function recheckPerm(): Promise<void> {
  try {
    permOk.value = await invoke<boolean>('check_storage_access')
  } catch {
    permOk.value = true
  }
  permChecked.value = true
  if (permOk.value && !listing.value) {
    toast('存储权限已就绪')
    void load(startPath)
  }
}

function onVisible(): void {
  // 从系统授权页返回 App 时自动复查权限,通过则直接进入目录浏览
  if (document.visibilityState === 'visible' && permChecked.value && !permOk.value) {
    void recheckPerm()
  }
}

async function addPath(path: string): Promise<void> {
  if (!path) return
  busy.value = true
  try {
    const meta = await backend.addRepoLocal(path)
    toast('已添加文库')
    emit('done', meta.id)
    emit('close')
  } catch (e) {
    const msg = typeof e === 'string' ? e : (e as Error).message
    toast(msg, true)
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  document.addEventListener('visibilitychange', onVisible)
  if (!isTauri) {
    permChecked.value = true
    browseError.value = '开发模式不可用,请编辑 dev-server/repos.local.json'
    return
  }
  if (isAndroid) {
    try {
      permOk.value = await invoke<boolean>('check_storage_access')
    } catch {
      permOk.value = true
    }
    permChecked.value = true
    if (!permOk.value) {
      // 自动弹出系统授权页,用户开启后返回即继续
      void requestPerm()
      return
    }
  } else {
    permChecked.value = true
  }
  void load(startPath)
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisible)
})
</script>

<style scoped>
.clone-card {
  width: min(480px, calc(100% - 32px));
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
  padding: 12px;
  font-size: 12.5px;
  line-height: 1.7;
}
.perm-warn .pw-text {
  margin: 0 0 10px;
}
:root[data-mode='dark'] .perm-warn {
  background: #3a2317;
  color: #e8a37d;
  border-color: #5c3a26;
}
.browse-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.bb-up {
  flex-shrink: 0;
}
.bb-path {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--t3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  direction: rtl;
  text-align: left;
}
.browse-list {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  height: min(300px, 42dvh);
  overflow-y: auto;
  padding: 4px;
}
.browse-empty {
  padding: 30px 14px;
  text-align: center;
  font-size: 13px;
  color: var(--t3);
  line-height: 1.7;
}
.browse-row {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  border: none;
  background: none;
  text-align: left;
  padding: 10px 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 14px;
  color: var(--t1);
}
.browse-row:hover:not(:disabled) {
  background: var(--bg-hover);
}
.br-ic {
  display: inline-flex;
  color: var(--t3);
  flex-shrink: 0;
}
.br-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.br-badge {
  flex-shrink: 0;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent-deep);
  border: 1px solid var(--accent-line);
}
.manual-fold {
  margin-top: 10px;
}
.manual-fold summary {
  font-size: 12.5px;
  color: var(--t3);
  cursor: pointer;
  user-select: none;
}
.manual-fold summary:hover {
  color: var(--t1);
}
@media (max-width: 900px) {
  .clone-card {
    margin: 0;
    width: 100vw;
    border: none;
    border-radius: 18px 18px 0 0;
    box-shadow: 0 -8px 40px rgba(5, 12, 20, 0.35);
    padding: 20px 16px calc(18px + var(--safe-bottom));
    animation: sheet-up 0.22s ease;
  }
  .clone-card h3 {
    font-size: 17px;
    text-align: center;
  }
  .browse-list {
    height: min(340px, 46dvh);
  }
  .browse-row {
    padding: 12px 10px;
    font-size: 15px;
  }
}
</style>
