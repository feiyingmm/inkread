<template>
  <div class="shell">
    <div class="card">
      <aside
        ref="sideEl"
        class="side"
        :class="{ 'is-closed': !sideVisible, 'is-peek': sidePeekOn, 'is-snap': sidePeek.snap.value }"
        :style="sideStyle"
      >
        <div class="side-head">
          <div class="side-logo">墨</div>
          <button class="repo-switch" title="切换 / 添加文库" @click="repoMenuOpen = !repoMenuOpen">
            <div class="side-title">墨阅</div>
            <div class="side-repo">
              {{ repo.currentRepoId || '添加文库…' }}
              <span class="repo-caret"><Icon name="chevron-down" :size="11" /></span>
            </div>
          </button>
          <!-- 悬浮态下「收起」语义是绕的(本来就是收起状态),改成钉住:一键转常驻展开 -->
          <button
            class="side-close"
            :title="sidePeekOn ? '钉住文库(常驻显示)' : isNarrow ? '返回' : '收起文库'"
            @click="sidePeekOn ? pinSide() : (sideOpen = false)"
          >
            <Icon :name="sidePeekOn ? 'pin' : isNarrow ? 'back' : 'close'" :size="20" />
          </button>
          <template v-if="repoMenuOpen">
            <div class="repo-menu-mask" @click="repoMenuOpen = false"></div>
            <div class="repo-menu">
              <div class="repo-menu-label">文库</div>
              <div v-for="r in repo.repos" :key="r.id" class="repo-row">
                <button
                  class="repo-item repo-item--grow"
                  :class="{ 'is-on': r.id === repo.currentRepoId }"
                  @click="switchRepo(r.id)"
                >
                  {{ r.name }}
                  <span v-if="r.id === repo.currentRepoId" class="repo-check"><Icon name="check" :size="14" /></span>
                </button>
                <button
                  class="repo-del"
                  title="从列表移除(不删除磁盘文件)"
                  @click.stop="onRemoveRepo(r)"
                >
                  <Icon name="close" :size="14" />
                </button>
              </div>
              <div class="repo-menu-sep"></div>
              <button class="repo-item" @click="onAddLocal">
                <span class="ri-icon"><Icon name="folder" :size="15" /></span>添加本地文库…
              </button>
              <button class="repo-item" @click="onAddClone">
                <span class="ri-icon"><Icon name="download" :size="15" /></span>克隆远程仓库…
              </button>
            </div>
          </template>
        </div>
        <div class="side-body" @contextmenu="onBlankMenu">
          <!-- 最近阅读:接着上次读的往下读是最高频的动作,放在文件树上头 -->
          <div v-if="recentDocs.length > 0" class="recent">
            <button class="recent-head" @click="recentOpen = !recentOpen">
              <Icon :name="recentOpen ? 'chevron-down' : 'chevron-right'" :size="12" />
              最近阅读
              <span class="rc-count">{{ recentDocs.length }}</span>
            </button>
            <template v-if="recentOpen">
              <button
                v-for="d in recentShown"
                :key="d.path"
                class="recent-row"
                :class="{ 'is-on': d.path === currentPath }"
                :title="d.path"
                @click="openFile(d.path)"
              >
                <span class="rc-name">{{ d.path.split('/').pop() }}</span>
                <span v-if="recentLabel(d)" class="rc-meta">{{ recentLabel(d) }}</span>
              </button>
              <button v-if="recentDocs.length > recentShown.length" class="recent-more" @click="openPalette('files')">
                查看全部 {{ recentDocs.length }} 篇…
              </button>
            </template>
          </div>
          <div v-if="repo.error" class="tree-empty">{{ repo.error }}</div>
          <div v-else-if="repo.loading" class="tree-empty">加载中…</div>
          <div v-else-if="repo.tree.length === 0" class="tree-empty">仓库为空<br /><span class="tree-empty-sub">右键 / 长按空白处可新建</span></div>
          <FileTree v-else :nodes="repo.tree" :current="currentPath" :reveal="treeReveal" @open="onOpenNode" @menu="onTreeMenu" />
        </div>
        <div class="side-foot">
          <button
            class="tbtn"
            :title="repo.currentIsGit ? '刷新文件列表;右键/长按:git 拉取选项' : '刷新文件列表'"
            :disabled="repo.pulling"
            @click="refreshLocal"
            @contextmenu.prevent="repo.currentIsGit && (pullMenu = { x: $event.clientX, y: $event.clientY })"
          >
            <Icon name="refresh" :spin="repo.pulling" />
          </button>
          <button class="tbtn" :title="modeTitle" @click="cycleMode">
            <Icon :name="modeIcon" />
          </button>
          <span class="sf-flex"></span>
          <button class="tbtn" title="设置" @click="settingsOpen = true"><Icon name="gear" /></button>
        </div>
      </aside>

      <main class="main">
        <div
          v-if="sideOpen && !isNarrow"
          class="resizer resizer--left"
          :class="{ 'is-active': resizing === 'side' }"
          title="拖动调整文库宽度"
          @mousedown="startResize('side', $event)"
        ></div>
        <div
          v-if="tocOpen && toc.length > 0 && !isNarrow"
          class="resizer resizer--right"
          :class="{ 'is-active': resizing === 'toc' }"
          title="拖动调整大纲宽度"
          @mousedown="startResize('toc', $event)"
        ></div>
        <TopBar
          :class="{ 'chrome-hidden': chromeHidden }"
          :repo-name="repo.currentRepoId"
          :path="currentPath"
          :suffix="isEbook || isPdf ? bookTitle : ''"
          :toc-open="tocOpen"
          :can-back="canBack"
          :can-forward="canForward"
          :can-edit="canEdit"
          :can-source="canSource"
          :edit-mode="editMode"
          :dirty="editorDirty"
          :source-mode="sourceMode"
          @toggle-side="sideOpen = !sideOpen"
          @toggle-toc="tocOpen = !tocOpen"
          @back="router.back()"
          @forward="router.forward()"
          @open-palette="openPalette('files')"
          @set-edit="setEdit"
          @save="editorRef?.save()"
          @toggle-source="mdView?.toggleSource()"
          @format-json="editorRef?.formatJsonBlocks()"
          @export="doExport"
          @crumb="onCrumb"
        />
        <div v-if="!currentPath" class="welcome">
          <div class="big">墨阅</div>
          <div class="sub">让每一篇 Markdown 静静展开,如书页般被阅读</div>
          <div v-if="repo.repos.length === 0 && isTauri" class="welcome-actions">
            <button class="opt" @click="isAndroid ? (localPathOpen = true) : pickLocalRepo()">添加本地文库(文件夹)…</button>
            <button class="opt is-on" @click="cloneOpen = true">克隆远程仓库…</button>
          </div>
          <div v-else class="sub" style="opacity: 0.7">从左侧文库选择一篇文档开始</div>
        </div>
        <PdfView
          v-else-if="isPdf"
          ref="pdfView"
          :repo-id="repo.currentRepoId"
          :path="currentPath"
          @toc="toc = $event"
          @rendered="onRendered"
          @title="bookTitle = $event"
          @tap-blank="onTapBlank"
        />
        <EbookView
          v-else-if="isEbook"
          ref="ebookView"
          :repo-id="repo.currentRepoId"
          :path="currentPath"
          @toc="toc = $event"
          @active="activeSlug = $event"
          @rendered="onRendered"
          @title="bookTitle = $event"
          @tap-blank="onTapBlank"
        />
        <MarkdownView
          v-else-if="!editMode"
          ref="mdView"
          :repo-id="repo.currentRepoId"
          :path="currentPath"
          @toc="toc = $event"
          @active="activeSlug = $event"
          @open="onOpenLink"
          @rendered="onRendered"
          @source-mode="sourceMode = $event"
          @tap-blank="onTapBlank"
        />
        <EditorView
          v-else
          ref="editorRef"
          :repo-id="repo.currentRepoId"
          :path="currentPath"
          @saved="onEditorSaved"
          @dirty="editorDirty = $event"
          @toc="toc = $event"
          @active="activeSlug = $event"
          @stats="docStats = $event"
        />
        <StatusBar
          :class="{ 'chrome-hidden': chromeHidden }"
          :status="repo.status"
          :is-git="repo.currentIsGit"
          :syncing="syncing"
          :edit-mode="editMode"
          :auto-save="settings.autoSave"
          :stats="docStats"
          @sync="doSync"
          @show-changes="changesOpen = true"
        />
      </main>

      <!-- 手机端目录走浮动球 + 整屏页(.toc 在窄屏 display:none),这里连内容都不必渲染 -->
      <TocPanel
        ref="tocPanelRef"
        :items="toc"
        :active-slug="activeSlug"
        :open="tocVisible"
        :peek="tocPeekOn"
        :class="{ 'is-snap': tocPeek.snap.value }"
        :style="tocStyle"
        @jump="onTocJump"
        @pin="pinToc"
      />
    </div>

    <!-- 边缘触发热区:收起态下把鼠标甩到窗口最左/最右即可临时唤出对应面板 -->
    <div v-if="canPeekSide" class="edge-hot edge-hot--left" @mouseenter="sidePeek.arm($event)"></div>
    <div v-if="canPeekToc" class="edge-hot edge-hot--right" @mouseenter="tocPeek.arm($event)"></div>

    <SettingsPanel v-if="settingsOpen" @close="settingsOpen = false" />
    <Palette
      v-if="paletteOpen"
      :repo-id="repo.currentRepoId"
      :tree="repo.tree"
      :initial-mode="paletteMode"
      :recent="recentFiles"
      @close="paletteOpen = false"
      @open="onPaletteOpen"
    />
    <SyncIssueDialog
      v-if="issueMode"
      :mode="issueMode"
      :detail="issueDetail"
      @close="issueMode = ''"
      @discard="onDiscardLocal"
    />
    <CloneDialog v-if="cloneOpen" @close="cloneOpen = false" @done="onCloneDone" />
    <LocalPathDialog v-if="localPathOpen" @close="localPathOpen = false" @done="onLocalPathDone" />
    <ChangesPanel
      v-if="changesOpen"
      :repo-id="repo.currentRepoId"
      :changes="repo.status?.changes ?? []"
      :syncing="syncing"
      @close="changesOpen = false"
      @open="onOpenChange"
      @sync="doSync"
      @discard="onDiscardFile"
    />

    <!-- 拉取按钮右键/长按:更多同步选项 -->
    <template v-if="pullMenu">
      <div class="ctx-mask" @click="pullMenu = null" @contextmenu.prevent="pullMenu = null"></div>
      <div class="ctx-menu" :style="pullMenuStyle">
        <div class="ctx-title">同步选项</div>
        <button class="repo-item" @click="pullMenu = null; doPull()">
          <span class="ri-icon"><Icon name="refresh" :size="15" /></span>拉取最新 (git pull)
        </button>
        <div class="repo-menu-sep"></div>
        <button class="repo-item ctx-danger" @click="onForcePull">
          <span class="ri-icon"><Icon name="undo" :size="15" /></span>放弃本地修改,与远端一致…
        </button>
      </div>
    </template>

    <button
      v-if="isNarrow && !editMode && !sideOpen && currentPath && toc.length > 0"
      class="fab-toc"
      :class="{ 'chrome-hidden': chromeHidden }"
      title="目录"
      @click="tocSheetOpen = true"
    >
      <Icon name="toc" :size="22" style="margin: 0 auto" />
    </button>
    <MobileTocSheet
      v-if="tocSheetOpen"
      :items="toc"
      :active-slug="activeSlug"
      @jump="onTocJump"
      @close="tocSheetOpen = false"
    />

    <!-- 文件树右键/长按菜单(桌面浮动,手机底部卡);空白处 = 根级新建 -->
    <template v-if="entryMenu">
      <div class="ctx-mask" @click="entryMenu = null" @contextmenu.prevent="entryMenu = null"></div>
      <div class="ctx-menu" :style="ctxStyle">
        <div class="ctx-title">{{ entryMenu.node ? entryMenu.node.name : '文库根目录' }}</div>
        <template v-if="!entryMenu.node || entryMenu.node.type === 'dir'">
          <button class="repo-item" @click="startCreate('file', entryMenu.node?.path ?? '')">
            <span class="ri-icon"><Icon name="doc-plus" :size="15" /></span>新建文档…
          </button>
          <button class="repo-item" @click="startCreate('dir', entryMenu.node?.path ?? '')">
            <span class="ri-icon"><Icon name="folder-plus" :size="15" /></span>新建文件夹…
          </button>
        </template>
        <template v-if="entryMenu.node && entryMenu.node.type === 'file' && !isNarrow && isTauri">
          <div class="repo-menu-sep"></div>
          <button class="repo-item" @click="onOpenInNewWindow(entryMenu.node)">
            <span class="ri-icon"><Icon name="external" :size="15" /></span>以新窗口打开
          </button>
        </template>
        <template v-if="entryMenu.node">
          <div class="repo-menu-sep"></div>
          <button class="repo-item" @click="showEntryInfo(entryMenu.node)">
            <span class="ri-icon"><Icon name="info" :size="15" /></span>
            {{ entryMenu.node.type === 'dir' ? '文件夹信息…' : '文件信息…' }}
          </button>
          <!-- Android 没有通用的「定位到文件」入口,只在桌面提供 -->
          <button v-if="isTauri && !isAndroid" class="repo-item" @click="revealEntry(entryMenu.node)">
            <span class="ri-icon"><Icon name="folder-open" :size="15" /></span>打开所在目录
          </button>
          <button class="repo-item" @click="copyEntryPath(entryMenu.node)">
            <span class="ri-icon"><Icon name="copy" :size="15" /></span>复制绝对路径
          </button>
        </template>
        <template v-if="entryMenu.node">
          <div class="repo-menu-sep"></div>
          <button class="repo-item" @click="startRename(entryMenu.node)">
            <span class="ri-icon"><Icon name="rename" :size="15" /></span>重命名…
          </button>
          <button class="repo-item ctx-danger" @click="doDelete(entryMenu.node)">
            <span class="ri-icon"><Icon name="trash" :size="15" /></span>{{ entryMenu.node.type === 'dir' ? '删除文件夹…' : '删除文件…' }}
          </button>
        </template>
      </div>
    </template>

    <!-- 重命名 -->
    <MobilePage v-if="renameDialog" title="重命名" :busy="creating" @back="renameDialog = null">
      <div class="ne-dir" :title="renameDialog.node.path">{{ renameDialog.node.path }}</div>
      <input
        ref="renameNameEl"
        v-model="renameName"
        class="palette-input ne-input"
        placeholder="新名称"
        @keydown.enter="doRename"
        @keydown.esc="renameDialog = null"
      />
      <template #footer>
        <span class="foot-flex"></span>
        <button class="opt" @click="renameDialog = null">取消</button>
        <button class="opt is-on" :disabled="!renameName.trim() || creating" @click="doRename">
          {{ creating ? '处理中…' : '重命名' }}
        </button>
      </template>
    </MobilePage>

    <!-- 新建文档 / 文件夹 -->
    <MobilePage
      v-if="newDialog"
      :title="newDialog.kind === 'file' ? '新建文档' : '新建文件夹'"
      :busy="creating"
      @back="newDialog = null"
    >
      <div class="ne-dir" :title="newDialog.dir || '(仓库根目录)'">位于:{{ newDialog.dir || '(仓库根目录)' }}</div>
      <input
        ref="newNameEl"
        v-model="newName"
        class="palette-input ne-input"
        :placeholder="newDialog.kind === 'file' ? '文档名,如 读书笔记.md' : '文件夹名'"
        @keydown.enter="doCreate"
        @keydown.esc="newDialog = null"
      />
      <template #footer>
        <span class="foot-flex"></span>
        <button class="opt" @click="newDialog = null">取消</button>
        <button class="opt is-on" :disabled="!newName.trim() || creating" @click="doCreate">
          {{ creating ? '创建中…' : '创建' }}
        </button>
      </template>
    </MobilePage>

    <!-- 文件 / 文件夹信息 -->
    <FileInfoDialog
      v-if="infoNode"
      :repo-id="repo.currentRepoId"
      :node="infoNode"
      :changes="repo.status?.changes ?? []"
      @close="infoNode = null"
    />

    <!-- 首次启动的存储权限引导(Android 未授权时) -->
    <StoragePermPage v-if="permPageOpen" @close="permPageOpen = false" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { errMsg } from '@/core/errmsg'
import { useRoute, useRouter } from 'vue-router'
import FileTree from '@/components/FileTree.vue'
import TopBar from '@/components/TopBar.vue'
import TocPanel from '@/components/TocPanel.vue'
import MarkdownView from '@/components/MarkdownView.vue'
import SettingsPanel from '@/components/SettingsPanel.vue'
import EbookView from '@/components/EbookView.vue'
import PdfView from '@/components/PdfView.vue'
import Palette from '@/components/Palette.vue'
import { dropRecent, listRecent, pushRecent, recentMeta, type RecentDoc } from '@/core/recent'
import EditorView from '@/components/EditorView.vue'
import StatusBar from '@/components/StatusBar.vue'
import SyncIssueDialog from '@/components/SyncIssueDialog.vue'
import CloneDialog from '@/components/CloneDialog.vue'
import LocalPathDialog from '@/components/LocalPathDialog.vue'
import MobileTocSheet from '@/components/MobileTocSheet.vue'
import ChangesPanel from '@/components/ChangesPanel.vue'
import FileInfoDialog from '@/components/FileInfoDialog.vue'
import MobilePage from '@/components/MobilePage.vue'
import StoragePermPage from '@/components/StoragePermPage.vue'
import Icon from '@/components/Icon.vue'
import { backend, isTauri } from '@/core/backend'
import { isMainWindow } from '@/core/window'
import { copyText } from '@/core/clipboard'
import { installAndroidBackHandler, popLayer, useBackLayerWhen } from '@/core/backstack'
import { useEdgePeek } from '@/core/edge-peek'
import { checkStorageAccess, markPrompted, shouldPromptOnLaunch } from '@/core/storage-perm'
import { useRepoStore } from '@/stores/repo'
import { useSettings } from '@/stores/settings'
import { dirOf, fileKind } from '@/core/paths'
import { resolvePath } from '@/core/paths'
import type { TocItem } from '@/core/markdown/pipeline'
import type { DocStats } from '@/core/doc-stats'
import type { GitChange, TreeNode } from '@/core/backend'
import { toast } from '@/core/toast'

const route = useRoute()
const router = useRouter()
const repo = useRepoStore()
const settings = useSettings()

const sideOpen = ref(window.matchMedia('(max-width: 900px)').matches ? false : localStorage.getItem('inkread:side') !== '0')
const tocOpen = ref(localStorage.getItem('inkread:toc') !== '0')
const settingsOpen = ref(false)
const paletteOpen = ref(false)
const paletteMode = ref<'files' | 'search'>('files')
const canBack = ref(false)
const canForward = ref(false)
const toc = ref<TocItem[]>([])
const activeSlug = ref('')
const mdView = ref<InstanceType<typeof MarkdownView> | null>(null)
const ebookView = ref<InstanceType<typeof EbookView> | null>(null)
const pdfView = ref<InstanceType<typeof PdfView> | null>(null)
/** epub / mobi 走电子书视图:它按章渲染,与 markdown 那套整篇渲染的机制不通用 */
const isEbook = computed(() => fileKind(currentPath.value) === 'ebook')
/** pdf 是固定版式,连排版旋钮都不适用,同样独立成视图 */
const isPdf = computed(() => fileKind(currentPath.value) === 'pdf')
/** 当前章名 / 书名 / PDF 标题,给标题栏用 */
const bookTitle = ref('')
const editorRef = ref<InstanceType<typeof EditorView> | null>(null)
const editMode = ref(false)
const editorDirty = ref(false)
const docStats = ref<DocStats | null>(null)
const syncing = ref(false)
const issueMode = ref<'' | 'pull' | 'push'>('')
const issueDetail = ref('')
const cloneOpen = ref(false)
let pendingAnchor = ''
let pendingHighlight = ''

const isAndroid = /android/i.test(navigator.userAgent)
const narrowMq = window.matchMedia('(max-width: 900px)')
const isNarrow = ref(narrowMq.matches)
narrowMq.addEventListener('change', (e) => (isNarrow.value = e.matches))
const tocSheetOpen = ref(false)
const changesOpen = ref(false)
const sourceMode = ref(false)
const treeReveal = ref('')
const chromeHidden = ref(false)

// 明暗快捷循环(侧栏底部)
const modeIcon = computed(() => (settings.mode === 'auto' ? 'theme-auto' : settings.mode === 'light' ? 'sun' : 'moon'))
const modeTitle = computed(
  () => `明暗模式:${settings.mode === 'auto' ? '跟随系统' : settings.mode === 'light' ? '浅色' : '深色'}(点击切换)`,
)
function cycleMode(): void {
  settings.mode = settings.mode === 'auto' ? 'light' : settings.mode === 'light' ? 'dark' : 'auto'
}

/** 手机端沉浸阅读:点击正文空白处切换顶栏/状态条显隐 */
function onTapBlank(): void {
  if (!isNarrow.value || !currentPath.value || editMode.value) return
  chromeHidden.value = !chromeHidden.value
}

// 沉浸阅读联动:Android 系统状态栏/导航栏随软件菜单一起隐现,顶部让位同步收起
watch(chromeHidden, (hidden) => {
  if (hidden) document.documentElement.dataset.immersive = '1'
  else delete document.documentElement.dataset.immersive
  if (isTauri && isAndroid) {
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('set_immersive', { on: hidden }))
      .catch(() => {})
  }
})

function onCrumb(dirPath: string): void {
  sideOpen.value = true
  treeReveal.value = dirPath
}

// ---- 文件管理:新建文档 / 新建文件夹 / 重命名 / 删除 ----
// entryMenu.node = null 表示树空白处(文库根目录)
const entryMenu = ref<null | { node: TreeNode | null; x: number; y: number }>(null)
const newDialog = ref<null | { kind: 'file' | 'dir'; dir: string }>(null)
const newName = ref('')
const newNameEl = ref<HTMLInputElement | null>(null)
const renameDialog = ref<null | { node: TreeNode }>(null)
const renameName = ref('')
const renameNameEl = ref<HTMLInputElement | null>(null)
const creating = ref(false)

/** 桌面浮动菜单跟随指针并防出界;手机由 CSS 固定为底部卡 */
const ctxStyle = computed(() => {
  if (!entryMenu.value || isNarrow.value) return undefined
  const x = Math.min(entryMenu.value.x, window.innerWidth - 240)
  const y = Math.min(entryMenu.value.y, window.innerHeight - 230)
  return { left: `${x}px`, top: `${y}px` }
})

function onTreeMenu(node: TreeNode, x: number, y: number): void {
  entryMenu.value = { node, x, y }
}

/** 在系统文件管理器中定位该条目(桌面);Android 没有通用的"定位到文件"入口,菜单里不显示 */
async function revealEntry(node: TreeNode): Promise<void> {
  entryMenu.value = null
  try {
    const abs = await backend.absPath(repo.currentRepoId, node.path)
    const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
    await revealItemInDir(abs)
  } catch (e) {
    toast(`打开所在目录失败:${errMsg(e)}`, true)
  }
}

/** 条目信息页(大小 / 时间 / 行数字数 / git 本地状态) */
const infoNode = ref<TreeNode | null>(null)

function showEntryInfo(node: TreeNode): void {
  entryMenu.value = null
  infoNode.value = node
}

/** 复制条目的磁盘绝对路径(贴进终端 / 其它工具用) */
async function copyEntryPath(node: TreeNode): Promise<void> {
  entryMenu.value = null
  try {
    const abs = await backend.absPath(repo.currentRepoId, node.path)
    await copyText(abs)
    toast(`已复制路径:${abs}`)
  } catch (e) {
    toast(`复制失败:${errMsg(e)}`, true)
  }
}

/** 树列表空白处右键/长按:根级新建(树行自身的菜单事件由 FileTree 发出) */
function onBlankMenu(e: MouseEvent): void {
  if ((e.target as HTMLElement).closest('.tree-row')) return
  e.preventDefault()
  if (!repo.currentRepoId) return
  entryMenu.value = { node: null, x: e.clientX, y: e.clientY }
}

function startCreate(kind: 'file' | 'dir', dir: string): void {
  entryMenu.value = null
  newDialog.value = { kind, dir }
  newName.value = ''
  void nextTick(() => newNameEl.value?.focus())
}

async function doCreate(): Promise<void> {
  if (!newDialog.value || creating.value) return
  let name = newName.value.trim().replace(/^[/\\]+|[/\\]+$/g, '')
  if (!name) return
  const { kind, dir } = newDialog.value
  if (kind === 'file' && !/\.[a-z0-9]+$/i.test(name)) name += '.md'
  const full = dir ? `${dir}/${name}` : name
  creating.value = true
  try {
    if (kind === 'file') await backend.createFile(repo.currentRepoId, full)
    else await backend.createDir(repo.currentRepoId, full)
    newDialog.value = null
    await repo.refresh()
    treeReveal.value = kind === 'file' ? dir : full
    if (kind === 'file') openFile(full)
    toast(kind === 'file' ? '文档已创建' : '文件夹已创建')
    repo.refreshStatus()
  } catch (e) {
    toast(errMsg(e), true)
  } finally {
    creating.value = false
  }
}

// ---- 同步选项菜单 / 单文件撤销 ----
const pullMenu = ref<null | { x: number; y: number }>(null)

const pullMenuStyle = computed(() => {
  if (!pullMenu.value || isNarrow.value) return undefined
  const x = Math.min(pullMenu.value.x, window.innerWidth - 250)
  const y = Math.min(pullMenu.value.y, window.innerHeight - 150)
  return { left: `${x}px`, top: `${y}px` }
})

/** 刷新按钮默认动作:重读本地文件列表与 git 状态(git 拉取在右键/长按菜单) */
async function refreshLocal(): Promise<void> {
  await repo.refresh()
  toast('文件列表已刷新')
}

// 外部改动感知:窗口/App 回到前台自动刷新文件树与状态(4 秒节流)
let lastAutoRefresh = 0
function onFocusRefresh(): void {
  if (document.visibilityState !== 'visible' || !repo.currentRepoId) return
  const now = Date.now()
  if (now - lastAutoRefresh < 4000) return
  lastAutoRefresh = now
  void repo.refresh()
}

function onForcePull(): void {
  pullMenu.value = null
  if (!window.confirm('放弃本仓库全部未推送的本地修改,强制与远端一致?此操作不可恢复(未跟踪的新文件保留)。')) return
  void onDiscardLocal()
}

async function onDiscardFile(c: GitChange): Promise<void> {
  const tip =
    c.kind === 'untracked'
      ? `撤销将删除新增文件「${c.path}」,不可恢复。继续?`
      : `撤销「${c.path}」的本地修改,恢复到最近提交的版本?`
  if (!window.confirm(tip)) return
  try {
    await backend.discardFile(repo.currentRepoId, c.path)
    toast('已撤销')
    await repo.refresh()
    repo.refreshStatus()
    if (currentPath.value === c.path) {
      if (c.kind === 'untracked') await router.replace({ query: {} })
      else mdView.value?.reload()
    }
  } catch (e) {
    toast(errMsg(e), true)
  }
}

function startRename(node: TreeNode): void {
  entryMenu.value = null
  renameDialog.value = { node }
  renameName.value = node.name
  void nextTick(() => {
    const el = renameNameEl.value
    if (!el) return
    el.focus()
    // 预选中主名部分(不含扩展名),回车即改
    const dot = node.type === 'file' ? node.name.lastIndexOf('.') : -1
    el.setSelectionRange(0, dot > 0 ? dot : node.name.length)
  })
}

async function doRename(): Promise<void> {
  if (!renameDialog.value || creating.value) return
  const node = renameDialog.value.node
  let name = renameName.value.trim().replace(/^[/\\]+|[/\\]+$/g, '')
  if (!name || name === node.name) {
    renameDialog.value = null
    return
  }
  // 文件重命名漏掉扩展名时自动补回原扩展
  if (node.type === 'file' && !/\.[a-z0-9]+$/i.test(name)) {
    const dot = node.name.lastIndexOf('.')
    if (dot > 0) name += node.name.slice(dot)
  }
  const dir = dirOf(node.path)
  const to = dir ? `${dir}/${name}` : name
  creating.value = true
  try {
    await backend.renameEntry(repo.currentRepoId, node.path, to)
    renameDialog.value = null
    toast('已重命名')
    // 当前打开的文档受影响时跟随新路径
    if (currentPath.value === node.path) {
      await router.replace({ query: { ...route.query, f: to } })
    } else if (node.type === 'dir' && currentPath.value.startsWith(node.path + '/')) {
      await router.replace({ query: { ...route.query, f: to + currentPath.value.slice(node.path.length) } })
    }
    await repo.refresh()
    treeReveal.value = to
    repo.refreshStatus()
  } catch (e) {
    toast(errMsg(e), true)
  } finally {
    creating.value = false
  }
}

async function doDelete(node: TreeNode): Promise<void> {
  entryMenu.value = null
  const label = node.type === 'dir' ? `文件夹「${node.name}」及其全部内容` : `文件「${node.name}」`
  if (!window.confirm(`确定删除${label}?此操作不可恢复(已推送过的内容可从 git 历史找回)。`)) return
  try {
    await backend.deleteEntry(repo.currentRepoId, node.path)
    toast('已删除')
    // 当前打开的文档被删(或在被删目录内)时回到欢迎页
    if (currentPath.value === node.path || currentPath.value.startsWith(node.path + '/')) {
      editMode.value = false
      await router.replace({ query: {} })
    }
    await repo.refresh()
    repo.refreshStatus()
  } catch (e) {
    toast(errMsg(e), true)
  }
}

async function doExport(type: 'html' | 'print' | 'image'): Promise<void> {
  if (type === 'print') {
    window.print()
    return
  }
  // 自带样式的 HTML 文档渲染在 .ink-html 里(不套 .prose),导出也要认它
  const prose = document.querySelector<HTMLElement>('.prose, .ink-html')
  if (!prose) {
    toast('没有可导出的内容', true)
    return
  }
  const name = currentPath.value.split('/').pop()?.replace(/\.(md|markdown|html?)$/i, '') || 'export'
  try {
    if (type === 'image') {
      await exportImages(prose, name)
      return
    }
    toast('正在生成 HTML…')
    const { buildExportHtml } = await import('@/core/export')
    const htmlText = await buildExportHtml(name, prose)
    const dest = await pickSavePath(`${name}.html`, 'HTML', ['html'])
    if (!dest) return
    await backend.exportFile(dest, htmlText)
    toast('已导出 HTML')
  } catch (e) {
    toast(`导出失败:${errMsg(e)}`, true)
  }
}

/**
 * 保存位置。桌面走系统保存对话框;开发模式(浏览器)没有对话框,
 * 直接把文件名当"路径"返回,由 devBackend 转成下载。
 */
async function pickSavePath(fileName: string, label: string, exts: string[]): Promise<string | null> {
  if (!isTauri) return fileName
  const { save } = await import('@tauri-apps/plugin-dialog')
  return (await save({ defaultPath: fileName, filters: [{ name: label, extensions: exts }] })) ?? null
}

/**
 * 导出 PNG 长图。超长的正文会被切成多张(canvas 有尺寸上限),
 * 所以先问一次保存位置,再按 `名字-1.png`、`名字-2.png` 顺序写出去。
 */
async function exportImages(prose: HTMLElement, name: string): Promise<void> {
  toast('正在生成图片…')
  const { exportProseImages } = await import('@/core/export')
  const blobs = await exportProseImages(prose, (done, total) => {
    // 单张就不啰嗦了;分段时报进度,否则几十秒里界面像卡住
    if (total <= 1) return
    toast(done === 0 ? `内容较长,将分成 ${total} 张…` : `已生成 ${done} / ${total} 张…`)
  })
  if (blobs.length === 0) {
    toast('没有生成任何图片', true)
    return
  }
  const dest = await pickSavePath(`${name}.png`, 'PNG 图片', ['png'])
  if (!dest) return
  const base = dest.replace(/\.png$/i, '')
  for (let i = 0; i < blobs.length; i++) {
    const buf = new Uint8Array(await blobs[i]!.arrayBuffer())
    let bin = ''
    // 分块转 base64:一次 apply 几 MB 的数组会爆调用栈
    for (let at = 0; at < buf.length; at += 0x8000) {
      bin += String.fromCharCode(...buf.subarray(at, at + 0x8000))
    }
    const path = blobs.length === 1 ? `${base}.png` : `${base}-${i + 1}.png`
    await backend.exportBinary(path, btoa(bin))
  }
  toast(blobs.length === 1 ? '已导出图片' : `已导出 ${blobs.length} 张图片(长图已分段)`)
}

function onOpenChange(path: string): void {
  changesOpen.value = false
  if (fileKind(path) === 'other') {
    toast('暂不支持打开该类型文件', true)
    return
  }
  openFile(path)
}

const currentPath = computed(() => String(route.query.f ?? ''))

// 记录每个仓库最后阅读的文档(冷启动恢复)与最近阅读列表(侧栏分组 + Ctrl+P 空输入)
const recentDocs = ref<RecentDoc[]>([])
/** 命令面板只要路径 */
const recentFiles = computed(() => recentDocs.value.map((d) => d.path))
// 默认收起:最近阅读一多就把文件树顶下去,想切文档反而要先滚一大段(2026-09-02 用户反馈)
const recentOpen = ref(localStorage.getItem('inkread:recentopen') === '1')
watch(recentOpen, (v) => localStorage.setItem('inkread:recentopen', v ? '1' : '0'))

/** 侧栏只露前几条,剩下的去命令面板看 —— 别把文件树挤没了 */
const SIDE_RECENT = 6
const recentShown = computed(() => recentDocs.value.slice(0, SIDE_RECENT))

/**
 * 读最近阅读,顺手把已经不存在的文档摘掉(删了/改名了的不该继续挂在列表里)。
 * 文件树还没加载完时不做清理,否则会把整张列表误判成"全都不存在"。
 */
function loadRecent(): void {
  const all = listRecent(repo.currentRepoId)
  if (repo.tree.length === 0) {
    recentDocs.value = all
    return
  }
  const gone = all.filter((d) => !repo.exists(d.path)).map((d) => d.path)
  if (gone.length > 0) dropRecent(repo.currentRepoId, gone)
  recentDocs.value = all.filter((d) => !gone.includes(d.path))
}

function recentLabel(doc: RecentDoc): string {
  return recentMeta(repo.currentRepoId, doc)
}

// 切换文库、文件树刷新之后都要重取(列表按文库分开存,清理也依赖文件树)
watch(() => [repo.currentRepoId, repo.tree] as const, loadRecent)

/**
 * 记一次「读过」。放在 recentDocs 等状态声明之后 —— 它带 immediate,
 * setup 期间就会跑一次(冷启动直接落在某篇文档上时,这个 watch 本来不触发,
 * 那篇就永远进不了最近阅读),跑得比状态声明早会直接 TDZ 报错、整页白屏。
 */
watch(
  currentPath,
  (p) => {
    if (p && repo.currentRepoId) {
      localStorage.setItem(`inkread:lastdoc:${repo.currentRepoId}`, p)
      pushRecent(repo.currentRepoId, p)
      loadRecent()
    }
  },
  { immediate: true },
)

/** 无指定文档时的默认打开:上次阅读 → INDEX.md → 欢迎页 */
function openDefaultDoc(): boolean {
  const last = localStorage.getItem(`inkread:lastdoc:${repo.currentRepoId}`)
  if (last && repo.exists(last)) {
    openFile(last)
  } else if (repo.exists('INDEX.md')) {
    openFile('INDEX.md')
  } else {
    return false
  }
  return true
}

/**
 * 冷启动抢跑:文件树还没扫完就先把上次那篇发出去读。
 *
 * `openDefaultDoc()` 要用 `repo.exists()` 校验,而那依赖整棵文件树 —— 于是"读一篇文档"
 * 被排在"递归 stat 整个文库"后面,Android 上尤其难受。这里跳过校验直接开读:
 * 两个 IPC 并行,读文件通常几毫秒就回来了。代价是万一那篇已经不在了会先闪一下错误,
 * 所以 `init()` 回来后要复核一次(见 onMounted)。
 */
function eagerOpenLastDoc(): string {
  if (currentPath.value || !repo.currentRepoId) return ''
  const last = localStorage.getItem(`inkread:lastdoc:${repo.currentRepoId}`)
  if (!last) return ''
  openFile(last)
  return last
}
// 手机端纯阅读:Android 上不提供编辑入口
const canEdit = computed(() => fileKind(currentPath.value) === 'markdown' && !isAndroid)
/** 源码视图与导出:html 文档也适用(它同样渲染进 .prose) */
const canSource = computed(() => ['markdown', 'html'].includes(fileKind(currentPath.value)))

function setEdit(on: boolean): void {
  if (on) {
    if (canEdit.value) editMode.value = true
    return
  }
  if (editMode.value && editorRef.value?.isDirty()) {
    if (!window.confirm('有未保存的修改,放弃并返回阅读视图?')) return
  }
  editMode.value = false
}

function onEditorSaved(): void {
  repo.refreshStatus()
}

async function doSync(): Promise<void> {
  if (syncing.value) return
  syncing.value = true
  try {
    const files = (repo.status?.changes ?? []).map((c) => c.path.slice(c.path.lastIndexOf('/') + 1))
    const msg = files.length
      ? `docs: 更新 ${files.slice(0, 3).join('、')}${files.length > 3 ? ` 等 ${repo.status?.dirtyCount ?? files.length} 处` : ''}`
      : 'docs: 更新文档'
    const r = await backend.gitSync(repo.currentRepoId, msg)
    if (r.conflict) {
      issueDetail.value = r.message
      issueMode.value = 'push'
    } else {
      toast(r.message, !r.ok)
    }
  } catch (e) {
    toast(`同步失败:${errMsg(e)}`, true)
  } finally {
    syncing.value = false
    repo.refreshStatus()
  }
}

async function pickLocalRepo(): Promise<void> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const dir = await open({ directory: true, title: '选择文库目录(git 仓库或普通文件夹均可)' })
    if (typeof dir !== 'string' || !dir) return
    const added = await backend.addRepoLocal(dir)
    // 已在列表里(含双击 md 建过的临时文库)时后端原样返回那条,这里只管切过去并把话说清楚
    const existed = repo.repos.some((r) => r.id === added.id)
    await repo.init()
    await switchRepo(added.id)
    toast(existed ? `「${added.name}」已在文库列表中,已切换过去` : `已添加文库「${added.name}」`)
  } catch (e) {
    toast(errMsg(e), true)
  }
}

/**
 * 桌面端:把「关闭按钮行为」同步给 Rust —— 点 ✕ 是退出还是隐藏到托盘由它在窗口事件里裁决,
 * 托盘图标也随之出现 / 消失。设置存在前端,所以启动时先同步一次,之后切换即同步。
 * 只由主窗口发:标志是进程级的,副窗口再发一遍没意义。
 */
function syncCloseBehavior(): void {
  if (!isTauri || isAndroid || !isMainWindow) return
  void import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke('set_close_behavior', { toTray: settings.closeToTray }))
    .catch((e) => toast(`托盘设置未生效:${errMsg(e)}`, true))
}
watch(() => settings.closeToTray, syncCloseBehavior)

const repoMenuOpen = ref(false)

// ---- 桌面端边缘悬浮:收起态下鼠标贴到窗口最左/最右,浮层临时唤出对应面板 ----
const sideEl = ref<HTMLElement | null>(null)
const tocPanelRef = ref<InstanceType<typeof TocPanel> | null>(null)

/**
 * 浮层内能拉起的三个菜单还开着时不许收起 —— 它们的遮罩是全屏 fixed 元素,
 * 指针在几何上已经"不在浮层里"了,不加这道锁菜单一弹浮层就从脚下消失。
 * 全屏模态(设置 / 新建 / 重命名 / 文件信息)不在此列:它们盖住整屏,
 * 浮层在不在后面无所谓,关掉时指针通常已离开边缘,收起才是对的。
 */
const peekLocked = (): boolean => repoMenuOpen.value || !!entryMenu.value || !!pullMenu.value

const sidePeek = useEdgePeek(() => sideEl.value, 'left', peekLocked)
const tocPeek = useEdgePeek(() => tocPanelRef.value?.rootEl, 'right')

const canPeekSide = computed(() => !isNarrow.value && !sideOpen.value)
const canPeekToc = computed(() => !isNarrow.value && !tocOpen.value && toc.value.length > 0)
const sidePeekOn = computed(() => sidePeek.active.value && canPeekSide.value)
const tocPeekOn = computed(() => tocPeek.active.value && canPeekToc.value)
const sideVisible = computed(() => sideOpen.value || sidePeekOn.value)
const tocVisible = computed(() => (tocOpen.value || tocPeekOn.value) && toc.value.length > 0 && !isNarrow.value)

/** 悬浮态下点头部图钉:这次临时浮出转为常驻展开 */
function pinSide(): void {
  sidePeek.close()
  sideOpen.value = true
}
function pinToc(): void {
  tocPeek.close()
  tocOpen.value = true
}

// 拖成手机布局(边缘悬浮是桌面专属)、或换到没有大纲的文档时,残留的浮层要当场收掉
watch(isNarrow, (narrow) => {
  if (!narrow) return
  sidePeek.close()
  tocPeek.close()
})
watch(
  () => toc.value.length,
  (n) => {
    if (n === 0) tocPeek.close()
  },
)

// ---- 侧栏宽度拖拽 ----
const sideWidth = ref(Number(localStorage.getItem('inkread:sidew')) || 264)
const tocWidth = ref(Number(localStorage.getItem('inkread:tocw')) || 232)
const resizing = ref<'' | 'side' | 'toc'>('')

const sideStyle = computed(() =>
  sideVisible.value && !isNarrow.value
    ? { width: `${sideWidth.value}px`, transition: resizing.value === 'side' ? 'none' : undefined }
    : undefined,
)
const tocStyle = computed(() =>
  tocVisible.value
    ? { width: `${tocWidth.value}px`, transition: resizing.value === 'toc' ? 'none' : undefined }
    : undefined,
)

function startResize(which: 'side' | 'toc', e: MouseEvent): void {
  e.preventDefault()
  resizing.value = which
  const startX = e.clientX
  const startW = which === 'side' ? sideWidth.value : tocWidth.value
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
  const onMove = (ev: MouseEvent) => {
    const delta = ev.clientX - startX
    if (which === 'side') sideWidth.value = clamp(startW + delta, 180, 480)
    else tocWidth.value = clamp(startW - delta, 160, 420)
  }
  const onUp = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    resizing.value = ''
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    localStorage.setItem('inkread:sidew', String(sideWidth.value))
    localStorage.setItem('inkread:tocw', String(tocWidth.value))
  }
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

async function switchRepo(id: string): Promise<void> {
  repoMenuOpen.value = false
  if (id === repo.currentRepoId) return
  if (editMode.value) {
    if (editorRef.value?.isDirty() && !window.confirm('有未保存的修改,放弃并切换文库?')) return
    editMode.value = false
  }
  await repo.setCurrent(id)
  await router.replace({ query: {} })
  openDefaultDoc()
}

/** 从文库列表移除一条记录;磁盘文件不动。移除的是当前文库时落到剩余第一个 */
async function onRemoveRepo(r: { id: string; name: string }): Promise<void> {
  if (!window.confirm(`从文库列表中移除「${r.name}」?\n\n只是不再显示,磁盘上的文件不会被删除。`)) return
  const wasCurrent = r.id === repo.currentRepoId
  try {
    await backend.removeRepo(r.id)
    await repo.init()
    toast(`已移除「${r.name}」`)
  } catch (e) {
    toast(errMsg(e), true)
    return
  }
  if (!wasCurrent) return
  repoMenuOpen.value = false
  editMode.value = false
  await router.replace({ query: {} })
  const next = repo.repos[0]?.id ?? ''
  if (next) {
    await repo.setCurrent(next)
    openDefaultDoc()
  }
}

function onAddLocal(): void {
  repoMenuOpen.value = false
  if (!isTauri) {
    toast('开发模式请编辑 dev-server/repos.local.json 后刷新', true)
    return
  }
  // Android 无系统目录选择器(tauri dialog 不支持),用应用内目录浏览器
  if (isAndroid) {
    localPathOpen.value = true
    return
  }
  void pickLocalRepo()
}

const localPathOpen = ref(false)

async function onLocalPathDone(repoId: string): Promise<void> {
  await repo.init()
  await switchRepo(repoId)
}

function onAddClone(): void {
  repoMenuOpen.value = false
  if (!isTauri) {
    toast('开发模式请编辑 dev-server/repos.local.json 后刷新', true)
    return
  }
  cloneOpen.value = true
}

async function onCloneDone(repoId: string): Promise<void> {
  await repo.init()
  await switchRepo(repoId)
}

/** 用户确认放弃本地修改:强制与远端一致,并刷新树与当前文档 */
async function onDiscardLocal(): Promise<void> {
  issueMode.value = ''
  try {
    const r = await backend.gitPullForce(repo.currentRepoId)
    toast(r.message, !r.ok)
    if (r.ok) {
      editMode.value = false
      await repo.refresh()
      mdView.value?.reload()
    }
  } catch (e) {
    toast(`操作失败:${errMsg(e)}`, true)
  } finally {
    repo.refreshStatus()
  }
}

watch(
  () => route.fullPath,
  () => {
    const st = window.history.state as { back?: unknown; forward?: unknown } | null
    canBack.value = !!st?.back
    canForward.value = !!st?.forward
  },
  { immediate: true },
)

function openPalette(mode: 'files' | 'search'): void {
  paletteMode.value = mode
  loadRecent()
  paletteOpen.value = true
}

function onPaletteOpen(path: string, highlight?: string): void {
  pendingHighlight = highlight ?? ''
  if (path === currentPath.value) {
    if (pendingHighlight) {
      mdView.value?.highlightText(pendingHighlight)
      pendingHighlight = ''
    }
    return
  }
  openFile(path)
}

watch(sideOpen, (v) => localStorage.setItem('inkread:side', v ? '1' : '0'))
watch(tocOpen, (v) => localStorage.setItem('inkread:toc', v ? '1' : '0'))

function openFile(path: string, anchor?: string): void {
  if (editMode.value) {
    if (editorRef.value?.isDirty() && !window.confirm('有未保存的修改,放弃并打开其他文档?')) return
    editMode.value = false
  }
  pendingAnchor = anchor ?? ''
  if (isNarrow.value) sideOpen.value = false
  chromeHidden.value = false
  if (path === currentPath.value) {
    if (pendingAnchor) {
      mdView.value?.scrollToSlug(pendingAnchor)
      pendingAnchor = ''
    }
    return
  }
  void router.push({ query: { ...route.query, f: path } })
}

function onOpenNode(node: TreeNode): void {
  if (fileKind(node.path) === 'other') {
    toast('暂不支持打开该类型文件', true)
    return
  }
  openFile(node.path)
}

function onOpenLink(rel: string, anchor?: string): void {
  const resolved = resolvePath(dirOf(currentPath.value), rel)
  if (!repo.exists(resolved)) {
    toast(`目标文件不存在:${resolved}`, true)
    return
  }
  openFile(resolved, anchor)
}

function onRendered(): void {
  if (pendingAnchor) {
    const slug = pendingAnchor
    pendingAnchor = ''
    setTimeout(() => mdView.value?.scrollToSlug(slug), 60)
  }
  if (pendingHighlight) {
    const q = pendingHighlight
    pendingHighlight = ''
    setTimeout(() => mdView.value?.highlightText(q), 80)
  }
}

/**
 * 文内查找(Ctrl+F)。三种阅读视图的机制不同,各自实现:
 * markdown/HTML 在当前 DOM 里找,电子书要跨章,PDF 要逐页取文本。
 */
function openFindInView(): void {
  if (isPdf.value) pdfView.value?.openFind()
  else if (isEbook.value) ebookView.value?.openFind()
  else mdView.value?.openFind()
}

/** 大纲点击:阅读视图滚正文,编辑视图滚编辑区,epub 换章(三边各自实现 scrollToSlug) */
function onTocJump(slug: string): void {
  if (isPdf.value) pdfView.value?.scrollToSlug(slug)
  else if (isEbook.value) ebookView.value?.scrollToSlug(slug)
  else if (editMode.value) editorRef.value?.scrollToSlug(slug)
  else mdView.value?.scrollToSlug(slug)
}

async function doPull(): Promise<void> {
  const r = await repo.pull()
  if (!r.ok && r.divergent) {
    issueDetail.value = r.message
    issueMode.value = 'pull'
    return
  }
  toast(r.message, !r.ok)
}

function onKeydown(e: KeyboardEvent): void {
  const key = e.key.toLowerCase()
  // 光标在编辑器里时,Ctrl+B 让位给「加粗」(编辑器里的肌肉记忆优先);
  // 焦点在别处(文件树、面板)时仍是收起/展开文库栏
  const inEditor = !!(e.target as HTMLElement | null)?.closest?.('.vditor')
  if (e.ctrlKey && !e.shiftKey && !e.altKey && key === 'b') {
    if (inEditor) return
    e.preventDefault()
    sideOpen.value = !sideOpen.value
  } else if (e.ctrlKey && !e.shiftKey && !e.altKey && key === 'p') {
    e.preventDefault()
    openPalette('files')
  } else if (e.ctrlKey && e.shiftKey && !e.altKey && key === 'f') {
    e.preventDefault()
    openPalette('search')
  } else if (e.ctrlKey && !e.shiftKey && !e.altKey && (key === 'f' || key === 'h')) {
    // 编辑视图查找 / 替换;阅读视图是文内查找(跨文档搜索仍是 Ctrl+Shift+F)
    if (editMode.value) {
      e.preventDefault()
      editorRef.value?.openFind(key === 'h')
    } else if (key === 'f' && currentPath.value) {
      e.preventDefault()
      openFindInView()
    }
  } else if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key === '/') {
    e.preventDefault()
    if (!editMode.value) void mdView.value?.toggleSource()
  } else if (e.ctrlKey && !e.shiftKey && !e.altKey && key === 'e') {
    e.preventDefault()
    if (canEdit.value) setEdit(!editMode.value)
  } else if (e.ctrlKey && !e.shiftKey && e.altKey && key === 'j') {
    // 编辑视图:一键格式化文中的 json 代码块
    if (editMode.value) {
      e.preventDefault()
      editorRef.value?.formatJsonBlocks()
    }
  } else if (e.ctrlKey && !e.shiftKey && !e.altKey && key === 's') {
    if (editMode.value) {
      e.preventDefault()
      void editorRef.value?.save()
    }
  } else if (e.altKey && e.key === 'ArrowLeft') {
    e.preventDefault()
    router.back()
  } else if (e.altKey && e.key === 'ArrowRight') {
    e.preventDefault()
    router.forward()
  } else if (e.key === 'Escape') {
    // 与手机端返回键共用同一个层栈:Esc 逐层退回
    if (popLayer()) e.preventDefault()
  }
}

/** 单文件(双击 md /「打开方式」)以所在目录建临时文库打开 */
async function openAbsFile(abs: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core')
  try {
    const r = await invoke<{ repoId: string; path: string }>('open_path', { path: abs })
    await repo.init()
    if (repo.currentRepoId !== r.repoId) await repo.setCurrent(r.repoId)
    openFile(r.path)
  } catch (e) {
    toast(errMsg(e), true)
  }
}

/**
 * Tauri 启动流程:
 * - 本窗口若被登记了打开目标(副窗口 / 文件关联新开的窗口),按目标打开
 * - 主窗口冷启动仍走 take_launch_file(命令行带的文件)
 * 再次双击 md 文件由 Rust 侧新开窗口承接,不再 emit 事件顶掉当前窗口内容。
 */
async function setupTauriFileOpen(): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core')
  const target = await backend.takeWindowTarget().catch(() => null)
  if (target?.file) {
    await openAbsFile(target.file)
    return
  }
  if (target?.repo) {
    await repo.init()
    if (repo.currentRepoId !== target.repo) await repo.setCurrent(target.repo)
    if (target.doc) openFile(target.doc)
    return
  }
  const lf = await invoke<string | null>('take_launch_file')
  if (lf) await openAbsFile(lf)
}

/** 桌面端:在新窗口打开树里选中的条目(目录则只切到该文库) */
async function onOpenInNewWindow(node: TreeNode | null): Promise<void> {
  entryMenu.value = null
  try {
    await backend.openNewWindow({
      repo: repo.currentRepoId,
      doc: node && node.type === 'file' ? node.path : null,
    })
  } catch (e) {
    toast(errMsg(e), true)
  }
}

// ---- 系统返回键 / Esc:每个浮层占一层,逐层退回,退无可退才离开应用 ----
// 弹层组件(设置、对话框、面板)各自在挂载时登记;这里补上不靠挂载切换的那几个。
const permPageOpen = ref(false)

useBackLayerWhen(
  computed(() => chromeHidden.value),
  () => (chromeHidden.value = false),
)
useBackLayerWhen(
  computed(() => isNarrow.value && sideOpen.value),
  () => (sideOpen.value = false),
)
useBackLayerWhen(
  computed(() => repoMenuOpen.value),
  () => (repoMenuOpen.value = false),
)
useBackLayerWhen(
  computed(() => !!entryMenu.value),
  () => (entryMenu.value = null),
)
useBackLayerWhen(
  computed(() => !!pullMenu.value),
  () => (pullMenu.value = null),
)

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('focus', onFocusRefresh)
  document.addEventListener('visibilitychange', onFocusRefresh)
  void installAndroidBackHandler()
  syncCloseBehavior()
  // Android:文库是手机存储里的目录,没有「所有文件访问」连文件名都读不到,
  // 与其等用户添加文库时才撞墙,不如首次启动就把话说清楚(问过一次就不再自动弹)
  if (isTauri && isAndroid && shouldPromptOnLaunch()) {
    void checkStorageAccess().then((ok) => {
      if (ok) markPrompted()
      else permPageOpen.value = true
    })
  }
  const eager = eagerOpenLastDoc()
  await repo.init()
  if (!currentPath.value) {
    openDefaultDoc()
  } else if (eager && eager === currentPath.value && !repo.exists(eager)) {
    // 抢跑那篇其实已经不在了(被删/改名/换了文库):清掉记录再退回默认文档,
    // 否则会一直停在"文档读取失败"
    localStorage.removeItem(`inkread:lastdoc:${repo.currentRepoId}`)
    if (!openDefaultDoc()) void router.replace({ query: {} })
  }
  if (isTauri) {
    void setupTauriFileOpen()
  }
  // 启动自动拉取:不 await —— 墨阅首先是个离线阅读器,联网同步不该挡在阅读前面。
  // 离线时直接跳过(libgit2 没有连接超时可设,断网发起 fetch 会干等到系统级超时);
  // 普通文件夹文库没有远端,也跳过
  if (settings.autoPull && repo.currentRepoId && repo.currentIsGit) {
    if (navigator.onLine === false) {
      console.info('[inkread] 当前离线,跳过启动自动拉取')
    } else {
      void repo.pull().then((r) => {
        if (r.ok && r.changed) toast('文档已更新到最新')
        else if (!r.ok) toast(`自动拉取失败:${r.message}`, true)
      })
    }
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('focus', onFocusRefresh)
  document.removeEventListener('visibilitychange', onFocusRefresh)
})
</script>
