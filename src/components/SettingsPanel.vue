<template>
  <div class="mask mask--settings" @click.self="emit('close')">
    <div class="set-modal">
      <header class="sm-head">
        <div class="sm-grip"></div>
        <!-- 手机端二级页:左上角返回,标题换成分组名(Obsidian 式) -->
        <button v-if="isNarrow && !atRoot" class="sm-back" title="返回" @click="atRoot = true">
          <Icon name="back" :size="18" />
        </button>
        <h3 class="sm-title">{{ isNarrow && !atRoot ? currentTabLabel : '设置' }}</h3>
        <button class="sm-close" title="关闭 (Esc)" @click="emit('close')"><Icon name="close" :size="18" /></button>
      </header>

      <!-- 手机端一级页:分组列表,点进去才是具体设置项 -->
      <div v-if="isNarrow && atRoot" class="sm-body sm-body--root">
        <div class="sm-group">
          <button v-for="t in TABS" :key="t.key" class="sm-entry" @click="openTab(t.key)">
            <span class="se-icon"><Icon :name="t.icon" :size="19" /></span>
            <span class="se-label">{{ t.label }}</span>
            <span class="se-arrow"><Icon name="forward" :size="16" /></span>
          </button>
        </div>
      </div>

      <div v-else class="sm-body">
        <nav v-if="!isNarrow" class="sm-nav">
          <button
            v-for="t in TABS"
            :key="t.key"
            class="sm-nav-item"
            :class="{ 'is-on': tab === t.key }"
            @click="tab = t.key"
          >
            <Icon :name="t.icon" :size="16" /><span>{{ t.label }}</span>
          </button>
        </nav>

        <div class="sm-content">
          <!-- 外观 -->
          <template v-if="tab === 'appearance'">
            <div class="set-item">
              <div class="si-info">
                <div class="si-title">品牌主题</div>
                <div class="si-desc">界面主色与外框氛围</div>
              </div>
              <div class="si-ctrl">
                <button
                  class="swatch swatch--ink"
                  :class="{ 'is-on': settings.brand === 'ink' }"
                  title="墨青黛蓝"
                  @click="settings.brand = 'ink'"
                ></button>
                <button
                  class="swatch swatch--violet"
                  :class="{ 'is-on': settings.brand === 'violet' }"
                  title="紫罗兰"
                  @click="settings.brand = 'violet'"
                ></button>
              </div>
            </div>
            <div class="set-item">
              <div class="si-info">
                <div class="si-title">明暗模式</div>
                <div class="si-desc">跟随系统会随手机/电脑深色模式自动切换</div>
              </div>
              <div class="si-ctrl">
                <div class="seg">
                  <button :class="{ 'is-on': settings.mode === 'auto' }" @click="settings.mode = 'auto'">跟随系统</button>
                  <button :class="{ 'is-on': settings.mode === 'light' }" @click="settings.mode = 'light'">浅色</button>
                  <button :class="{ 'is-on': settings.mode === 'dark' }" @click="settings.mode = 'dark'">深色</button>
                </div>
              </div>
            </div>
            <div class="set-item">
              <div class="si-info">
                <div class="si-title">阅读纸色</div>
                <div class="si-desc">仅浅色模式下生效</div>
              </div>
              <div class="si-ctrl">
                <div class="seg">
                  <button :class="{ 'is-on': settings.paper === 'default' }" @click="settings.paper = 'default'">默认</button>
                  <button :class="{ 'is-on': settings.paper === 'sepia' }" @click="settings.paper = 'sepia'">羊皮</button>
                  <button :class="{ 'is-on': settings.paper === 'green' }" @click="settings.paper = 'green'">豆绿</button>
                </div>
              </div>
            </div>
          </template>

          <!-- 阅读 -->
          <template v-else-if="tab === 'reading'">
            <div class="set-item">
              <div class="si-info">
                <div class="si-title">阅读宽度</div>
                <div class="si-desc">书卷版心利于长文阅读;宽页适合大表格</div>
              </div>
              <div class="si-ctrl">
                <div class="seg">
                  <button :class="{ 'is-on': settings.width === 'book' }" @click="settings.width = 'book'">书卷版心</button>
                  <button :class="{ 'is-on': settings.width === 'wide' }" @click="settings.width = 'wide'">宽页展开</button>
                </div>
              </div>
            </div>
            <div class="set-item set-item--col">
              <div class="si-info">
                <div class="si-title">正文字号</div>
                <div class="si-desc">{{ settings.fontSize }}px · 手机上也可在正文双指捏合调节</div>
              </div>
              <input v-model.number="settings.fontSize" type="range" min="14" max="20" step="1" class="si-range" />
            </div>
            <div class="set-item">
              <div class="si-info">
                <div class="si-title">正文字体</div>
                <div class="si-desc">霞鹜文楷更有书卷气,黑体更利于屏幕阅读</div>
              </div>
              <div class="si-ctrl">
                <div class="seg">
                  <button :class="{ 'is-on': !settings.serifBody }" @click="settings.serifBody = false">系统黑体</button>
                  <button :class="{ 'is-on': settings.serifBody }" @click="settings.serifBody = true">霞鹜文楷</button>
                </div>
              </div>
            </div>
          </template>

          <!-- 同步 -->
          <template v-else-if="tab === 'sync'">
            <div class="set-item">
              <div class="si-info">
                <div class="si-title">启动时自动拉取</div>
                <div class="si-desc">打开墨阅时自动 git pull,保持文档最新</div>
              </div>
              <button
                class="switch"
                role="switch"
                :aria-checked="settings.autoPull"
                :class="{ 'is-on': settings.autoPull }"
                @click="settings.autoPull = !settings.autoPull"
              ></button>
            </div>
            <div class="set-item">
              <div class="si-info">
                <div class="si-title">编辑自动保存</div>
                <div class="si-desc">停止输入 2 秒后自动写入文件;关闭时用 Ctrl+S 或顶栏按钮保存</div>
              </div>
              <button
                class="switch"
                role="switch"
                :aria-checked="settings.autoSave"
                :class="{ 'is-on': settings.autoSave }"
                @click="settings.autoSave = !settings.autoSave"
              ></button>
            </div>
          </template>

          <!-- Git 令牌 -->
          <template v-else-if="tab === 'token'">
            <template v-if="isTauri">
              <div class="set-item set-item--col">
                <div class="si-info">
                  <div class="si-title">访问令牌</div>
                  <div class="si-desc">私有仓库拉取/推送用,按域名保存。桌面端优先使用系统 git 已保存的凭据。</div>
                </div>
                <div v-if="savedHosts.length" class="tok-saved">
                  <span class="tok-saved-label">已保存</span>
                  <button
                    v-for="h in savedHosts"
                    :key="h"
                    class="tok-chip"
                    :class="{ 'is-cur': h === normalizedHost }"
                    @click="tokenHost = h"
                  >
                    {{ h }}
                  </button>
                </div>
                <div v-else class="si-desc tok-saved-none">尚未保存任何域名的令牌</div>
                <input v-model="tokenHost" class="si-input" placeholder="域名,如 gitee.com(粘贴完整仓库地址也可以)" />
                <div v-if="normalizedHost && normalizedHost !== tokenHost.trim()" class="si-desc tok-hint">
                  将保存到域名:<b>{{ normalizedHost }}</b>
                </div>
                <input v-model="tokenValue" class="si-input" type="password" placeholder="Personal Access Token" />
                <div class="si-btns">
                  <button class="opt is-on" :disabled="!tokenHost.trim()" @click="saveTok">保存令牌</button>
                  <button class="opt" :disabled="!tokenHost.trim()" @click="clearTok">删除该域令牌</button>
                </div>
              </div>
            </template>
            <div v-else class="si-desc" style="padding: 14px 0">
              开发模式凭据走系统 git;仓库注册在 dev-server/repos.local.json。
            </div>
          </template>

          <!-- 帮助 -->
          <template v-else-if="tab === 'help'">
            <div class="sm-sub">快捷键</div>
            <table class="help-table">
              <tbody>
                <tr><td><kbd>Ctrl</kbd>+<kbd>P</kbd></td><td>快速打开(空输入=最近阅读)</td></tr>
                <tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd></td><td>全文搜索</td></tr>
                <tr><td><kbd>Ctrl</kbd>+<kbd>E</kbd></td><td>阅读 ↔ 编辑</td></tr>
                <tr><td><kbd>Ctrl</kbd>+<kbd>S</kbd></td><td>保存(编辑模式)</td></tr>
                <tr><td><kbd>Ctrl</kbd>+<kbd>/</kbd></td><td>渲染 ↔ 源码视图</td></tr>
                <tr><td><kbd>Ctrl</kbd>+<kbd>B</kbd></td><td>收起 / 展开文库栏</td></tr>
                <tr><td><kbd>Alt</kbd>+<kbd>←</kbd> / <kbd>→</kbd></td><td>后退 / 前进</td></tr>
                <tr><td><kbd>Esc</kbd></td><td>关闭面板</td></tr>
              </tbody>
            </table>
            <div class="sm-sub">使用要点</div>
            <div class="sm-tips">
              <p>· 点击底部状态条「N 个未提交变更」查看本地改动明细并一键推送</p>
              <p>· 点击面包屑中的目录名可在文库树中定位;标题旁箭头可折叠章节</p>
              <p>· 编辑时粘贴截图会自动存入文档旁 assets/ 目录</p>
              <p>· 同步遇到冲突时,墨阅不代为合并——请用 git 工具处理,或选择放弃本地修改</p>
              <p>· 手机端:左上角开文库抽屉,右下角浮动球开目录,点正文空白进入全屏沉浸阅读</p>
            </div>
          </template>

          <!-- 关于 -->
          <template v-else>
            <div class="sm-about">
              <div class="sm-logo">墨</div>
              <div class="sm-app">墨阅 Inkread</div>
              <div class="si-desc">让每一篇 Markdown 静静展开,如书页般被阅读</div>
              <div class="si-desc">版本 v{{ version }}</div>
              <button class="opt" style="margin-top: 10px" @click="openRepo">GitHub 仓库</button>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { errMsg } from '@/core/errmsg'
import { useSettings } from '@/stores/settings'
import { backend, isTauri } from '@/core/backend'
import { toast } from '@/core/toast'
import Icon from '@/components/Icon.vue'

const emit = defineEmits<{ close: [] }>()
const settings = useSettings()

type TabKey = 'appearance' | 'reading' | 'sync' | 'token' | 'help' | 'about'

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'appearance', label: '外观', icon: 'palette' },
  { key: 'reading', label: '阅读', icon: 'book' },
  { key: 'sync', label: '同步', icon: 'refresh' },
  { key: 'token', label: 'Git 令牌', icon: 'key' },
  { key: 'help', label: '帮助', icon: 'help' },
  { key: 'about', label: '关于', icon: 'info' },
]

const tab = ref<TabKey>('appearance')

/**
 * 手机端改成 Obsidian 式两级页:一级是分组列表,点进去才是具体设置项。
 * 横向 tab 条在窄屏放不下 6 个分组(要横向滚动、看不全),桌面端保持不变。
 */
const narrowMq = window.matchMedia('(max-width: 900px)')
const isNarrow = ref(narrowMq.matches)
narrowMq.addEventListener('change', (e) => {
  isNarrow.value = e.matches
  if (!e.matches) atRoot.value = false
})
const atRoot = ref(narrowMq.matches)
const currentTabLabel = computed(() => TABS.find((t) => t.key === tab.value)?.label ?? '设置')

function openTab(key: TabKey): void {
  tab.value = key
  atRoot.value = false
}

const tokenHost = ref('')
const tokenValue = ref('')
/** 已保存令牌的域名;令牌值出于安全不回填,靠这个列表让用户确认存没存上 */
const savedHosts = ref<string[]>([])

/** 与后端 gitops::host_of 同规则:用户粘贴完整仓库地址时抽出域名 */
const normalizedHost = computed(() => {
  const raw = tokenHost.value.trim()
  if (!raw) return ''
  const afterScheme = raw.includes('://') ? raw.slice(raw.indexOf('://') + 3) : raw
  const authority = afterScheme.split('/')[0] ?? ''
  const hostPart = authority.includes('@') ? authority.slice(authority.lastIndexOf('@') + 1) : authority
  return (raw.includes('://') ? hostPart : hostPart.split(':')[0] ?? hostPart).toLowerCase()
})

async function loadHosts(): Promise<void> {
  if (!isTauri) return
  try {
    savedHosts.value = await backend.listTokenHosts()
    if (!tokenHost.value) tokenHost.value = savedHosts.value[0] ?? 'gitee.com'
  } catch {
    /* 读不到就当没有,不打断设置面板 */
  }
}
onMounted(loadHosts)
const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'

function openRepo(): void {
  void backend.openExternal('https://github.com/feiyingmm/inkread')
}

async function saveTok(): Promise<void> {
  if (!tokenValue.value.trim()) {
    toast('令牌为空,如需删除请点「删除该域令牌」', true)
    return
  }
  try {
    await backend.saveToken(tokenHost.value.trim(), tokenValue.value.trim())
    tokenValue.value = ''
    const host = normalizedHost.value
    tokenHost.value = host
    await loadHosts()
    toast(`已保存 ${host} 的令牌`)
  } catch (e) {
    toast(errMsg(e), true)
  }
}

async function clearTok(): Promise<void> {
  try {
    const host = normalizedHost.value
    await backend.saveToken(tokenHost.value.trim(), '')
    await loadHosts()
    toast(`已删除 ${host} 的令牌`)
  } catch (e) {
    toast(errMsg(e), true)
  }
}
</script>

<style scoped>
/* 遮罩:桌面居中(Obsidian 式大模态),手机贴底全屏抽屉 */
.mask--settings {
  align-items: center;
  justify-content: center;
  padding-top: var(--safe-top);
}

.set-modal {
  display: flex;
  flex-direction: column;
  width: min(780px, calc(100vw - 64px));
  height: min(600px, calc(100vh - 90px));
  background: var(--bg-card);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
  overflow: hidden;
}

.sm-head {
  display: flex;
  align-items: center;
  padding: 14px 16px 12px 20px;
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
  position: relative;
}
.sm-grip {
  display: none;
}
.sm-title {
  margin: 0;
  flex: 1;
  font-family: var(--font-serif);
  font-size: 16px;
  color: var(--t1);
}
.sm-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 50%;
  background: none;
  color: var(--t3);
  cursor: pointer;
}
.sm-close:hover {
  background: var(--bg-hover);
  color: var(--t1);
}

.sm-back {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  margin-right: 6px;
  margin-left: -6px;
  border: none;
  border-radius: 50%;
  background: none;
  color: var(--t2);
  cursor: pointer;
}
.sm-back:active {
  background: var(--bg-hover);
}

.sm-body {
  flex: 1;
  display: flex;
  min-height: 0;
}

/* ---------- 手机端一级页:分组列表(Obsidian 式) ---------- */
.sm-body--root {
  display: block;
  overflow-y: auto;
  padding: 14px 14px calc(20px + var(--safe-bottom));
}
.sm-group {
  background: var(--bg-side);
  border: 1px solid var(--line);
  border-radius: 14px;
  overflow: hidden;
}
.sm-entry {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  border: none;
  background: none;
  color: var(--t1);
  font-size: 16px;
  text-align: left;
  padding: 15px 14px;
  cursor: pointer;
}
.sm-entry + .sm-entry {
  border-top: 1px solid var(--line);
}
.sm-entry:active {
  background: var(--bg-hover);
}
.se-icon {
  display: inline-flex;
  color: var(--t2);
  flex-shrink: 0;
}
.se-label {
  flex: 1;
  min-width: 0;
}
.se-arrow {
  display: inline-flex;
  color: var(--t3);
  flex-shrink: 0;
}

/* 左侧分类导航(桌面) */
.sm-nav {
  width: 168px;
  flex-shrink: 0;
  padding: 10px 8px;
  border-right: 1px solid var(--line);
  background: var(--bg-side);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sm-nav-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  border: none;
  background: none;
  text-align: left;
  font-size: 13.5px;
  color: var(--t2);
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  white-space: nowrap;
}
.sm-nav-item:hover {
  background: var(--bg-hover);
  color: var(--t1);
}
.sm-nav-item.is-on {
  background: var(--accent-soft);
  color: var(--accent-deep);
  font-weight: 600;
}

.sm-content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 6px 24px 24px;
}

/* 设置行:左侧标题+描述,右侧控件(Obsidian 式) */
.set-item {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 15px 0;
  border-bottom: 1px solid var(--line);
}
.set-item:last-child {
  border-bottom: none;
}
.set-item--col {
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
}
.si-info {
  flex: 1;
  min-width: 0;
}
.si-title {
  font-size: 14px;
  color: var(--t1);
  font-weight: 600;
}
.si-desc {
  font-size: 12.5px;
  color: var(--t3);
  line-height: 1.6;
  margin-top: 3px;
}
.si-ctrl {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 分段选择 */
.seg {
  display: inline-flex;
  background: var(--bg-side);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 3px;
  gap: 2px;
}
.seg button {
  border: none;
  background: transparent;
  color: var(--t2);
  font-size: 12.5px;
  height: 28px;
  padding: 0 13px;
  border-radius: 999px;
  cursor: pointer;
  white-space: nowrap;
}
.seg button.is-on {
  background: var(--bg-card);
  color: var(--accent-deep);
  font-weight: 600;
  box-shadow: 0 1px 4px rgba(15, 30, 45, 0.14);
}

/* 开关 */
.switch {
  flex-shrink: 0;
  width: 42px;
  height: 24px;
  border: none;
  border-radius: 999px;
  background: var(--line-strong);
  position: relative;
  cursor: pointer;
  transition: background 0.18s ease;
  padding: 0;
}
.switch::after {
  content: '';
  position: absolute;
  left: 3px;
  top: 3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(10, 20, 30, 0.3);
  transition: transform 0.18s ease;
}
.switch.is-on {
  background: var(--accent);
}
.switch.is-on::after {
  transform: translateX(18px);
}

.si-range {
  width: 100%;
  accent-color: var(--accent);
}
.si-input {
  height: 38px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--bg-side);
  color: var(--t1);
  font-size: 14px;
  padding: 0 12px;
  outline: none;
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
}
.si-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.si-btns {
  display: flex;
  gap: 8px;
}

/* 已保存域名回显:令牌值不回填,靠这排 chip 让用户确认存没存上 */
.tok-saved {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.tok-saved-label {
  font-size: 12px;
  color: var(--t3);
}
.tok-saved-none {
  padding: 2px 0;
}
.tok-chip {
  border: 1px solid var(--line-strong);
  background: var(--bg-side);
  color: var(--t2);
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 12px;
  cursor: pointer;
}
.tok-chip.is-cur {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}
.tok-hint {
  padding: 0;
}

.sm-sub {
  font-size: 12px;
  color: var(--t3);
  font-weight: 600;
  margin: 16px 0 8px;
}
.sm-tips p {
  margin: 7px 0;
  font-size: 13px;
  color: var(--t2);
  line-height: 1.7;
}

.sm-about {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  text-align: center;
  padding: 36px 0;
}
.sm-logo {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: linear-gradient(135deg, var(--g1), var(--g3));
  color: #fff;
  font-family: var(--font-serif);
  font-size: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 6px;
}
.sm-app {
  font-family: var(--font-serif);
  font-size: 18px;
  font-weight: 600;
  color: var(--t1);
}

/* ---------- 手机:底部全屏抽屉 + 横向分类 ---------- */
@media (max-width: 900px) {
  .mask--settings {
    align-items: flex-end;
    padding: 0;
  }
  .set-modal {
    width: 100%;
    height: calc(100dvh - var(--safe-top) - 14px);
    border: none;
    border-radius: 18px 18px 0 0;
    box-shadow: 0 -8px 40px rgba(5, 12, 20, 0.35);
    animation: sheet-up 0.22s ease;
  }
  .sm-head {
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 8px 14px 10px;
  }
  .sm-grip {
    display: block;
    width: 40px;
    height: 4px;
    border-radius: 2px;
    background: var(--line-strong);
    margin-bottom: 6px;
  }
  .sm-title {
    flex: none;
    font-size: 17px;
  }
  .sm-close {
    position: absolute;
    right: 10px;
    top: 14px;
    width: 40px;
    height: 40px;
    background: var(--bg-side);
  }
  /* 返回键与关闭键对称贴两侧;标题居中(sm-head 在窄屏是 column 布局) */
  .sm-back {
    position: absolute;
    left: 10px;
    top: 14px;
    width: 40px;
    height: 40px;
    margin: 0;
    background: var(--bg-side);
  }
  .sm-body {
    flex-direction: column;
  }
  /* 窄屏不再渲染横向 tab 条(改走一级列表 → 二级页),故此处无 .sm-nav 样式 */
  .sm-content {
    padding: 2px 18px calc(20px + var(--safe-bottom));
  }
  .set-item {
    padding: 16px 0;
  }
  /* 手机上分段控件换行放不下时整行展示 */
  .set-item:not(.set-item--col) {
    flex-wrap: wrap;
  }
  .si-info {
    flex-basis: 100%;
  }
  .set-item:has(.switch) .si-info {
    flex-basis: 0;
    flex-grow: 1;
  }
  .seg button {
    height: 34px;
    padding: 0 16px;
    font-size: 13.5px;
  }
  .switch {
    width: 48px;
    height: 28px;
  }
  .switch::after {
    width: 22px;
    height: 22px;
  }
  .switch.is-on::after {
    transform: translateX(20px);
  }
  .si-input {
    height: 46px;
    font-size: 15px;
  }
  .si-btns .opt {
    height: 40px;
    font-size: 14px;
  }
}
</style>
