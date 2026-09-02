<template>
  <MobilePage title="添加本地文库" :busy="busy" :mask-close="!busy" @back="emit('close')">
    <!-- 没有「所有文件访问」时什么都别放行:Android 分区存储下目录列得出来、
         文件却读不到,放行只会得到一个"只有目录没有文件"的空壳文库 -->
    <div v-if="permChecked && !permOk" class="perm">
      <div class="perm-ic"><Icon name="shield" :size="30" /></div>
      <h4 class="perm-h">需要「所有文件访问」权限</h4>
      <p class="perm-p">
        墨阅要读取手机里的文库目录。Android 从 11 起把这类访问收紧了——
        <b>没有这个权限时,目录能列出来,但里面的文件一个都读不到</b>,
        文件树会只剩空目录。
      </p>
      <p class="perm-p">在系统授权页里找到「墨阅」并打开开关,返回后会自动继续。</p>
      <button class="opt is-on perm-btn" @click="requestPerm">去开启权限</button>
      <button class="opt perm-btn" @click="recheckPerm">我已开启,重新检查</button>
    </div>

    <template v-else>
      <div class="browse-bar">
        <button class="opt bb-up" :disabled="!listing?.parent || busy" @click="goUp">
          <Icon name="up" :size="13" style="display: inline-block; vertical-align: -2px" /> 上一级
        </button>
        <div class="bb-path" :title="listing?.path ?? startPath">{{ listing?.path ?? startPath }}</div>
      </div>

      <p class="browse-tip">git 仓库和普通文件夹都能当文库;普通文件夹只是没有同步功能。</p>

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

    <template v-if="permOk" #footer>
      <span class="foot-flex"></span>
      <button class="opt" :disabled="busy" @click="emit('close')">取消</button>
      <button
        class="opt is-on"
        :disabled="busy || !listing"
        :title="listing?.isGit ? '把当前打开的目录添加为文库(git 仓库)' : '把当前打开的目录添加为文库(普通文件夹,无同步)'"
        @click="listing && addPath(listing.path)"
      >
        {{ busy ? '添加中…' : '添加当前目录' }}
      </button>
    </template>
  </MobilePage>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { errMsg } from '@/core/errmsg'
import { backend, isTauri } from '@/core/backend'
import { toast } from '@/core/toast'
import Icon from '@/components/Icon.vue'
import MobilePage from '@/components/MobilePage.vue'
import { checkStorageAccess, requestStorageAccess } from '@/core/storage-perm'

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
    browseError.value = errMsg(e)
  }
}

function enter(d: DirItem): void {
  if (!listing.value) return
  const next = `${listing.value.path.replace(/[/\\]$/, '')}/${d.name}`
  // 点到 git 仓库目录:直接作为文库添加(这是最常见的意图);
  // 普通目录一律进入继续浏览 —— 想把它本身当文库就用底部的「添加当前目录」
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
    await requestStorageAccess()
  } catch (e) {
    toast(errMsg(e), true)
  }
}

async function recheckPerm(): Promise<void> {
  const ok = await checkStorageAccess()
  permOk.value = ok
  permChecked.value = true
  if (ok && !listing.value) {
    toast('存储权限已就绪')
    void load(startPath)
  } else if (!ok) {
    toast('还没拿到「所有文件访问」权限', true)
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
    toast(errMsg(e), true)
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
    permOk.value = await checkStorageAccess()
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
.perm {
  text-align: center;
  padding: 18px 6px;
}
.perm-ic {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 60px;
  height: 60px;
  border-radius: 18px;
  background: var(--accent-soft);
  color: var(--accent-deep);
  margin-bottom: 12px;
}
.perm-h {
  margin: 0 0 10px;
  font-size: 16px;
  color: var(--t1);
}
.perm-p {
  margin: 0 0 10px;
  font-size: 13px;
  line-height: 1.85;
  color: var(--t2);
  text-align: left;
}
.perm-btn {
  display: block;
  width: 100%;
  height: 42px;
  font-size: 14px;
  margin-top: 10px;
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
  overflow: hidden;
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
  cursor: pointer;
  font-size: 14px;
  color: var(--t1);
}
.browse-row + .browse-row {
  border-top: 1px solid var(--line);
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
.browse-tip {
  margin: 0 0 8px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--t3);
}
.manual-fold {
  margin-top: 14px;
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
.foot-flex {
  flex: 1;
}
@media (max-width: 900px) {
  .browse-row {
    padding: 13px 12px;
    font-size: 15px;
  }
  .foot-flex {
    display: none;
  }
}
</style>
