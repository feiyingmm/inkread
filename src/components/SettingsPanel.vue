<template>
  <MobilePage :title="pageTitle" :lead="secondLevel ? 'back' : 'close'" wide flush no-scroll @back="onBack">
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
          <div class="set-item set-item--col">
            <div class="si-info">
              <div class="si-title">品牌主题</div>
              <div class="si-desc">界面主色与外框氛围 · 当前:{{ brandLabel }}</div>
            </div>
            <div class="sw-row">
              <button
                v-for="b in BRANDS"
                :key="b.key"
                class="swatch"
                :class="[`swatch--${b.key}`, { 'is-on': settings.brand === b.key }]"
                :title="b.label"
                :aria-label="b.label"
                @click="settings.brand = b.key"
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
          <!-- 纸色按明暗各自记忆:切一次明暗不会把另一边的选择覆盖掉,所以这里只列当前明暗那一档 -->
          <div class="set-item">
            <div class="si-info">
              <div class="si-title">阅读纸色</div>
              <div class="si-desc">
                {{ settings.isDark ? '深色模式下的正文底色;浅色那套单独记忆' : '浅色模式下的正文底色;深色那套单独记忆' }}
              </div>
            </div>
            <div class="si-ctrl">
              <div v-if="settings.isDark" class="seg">
                <button :class="{ 'is-on': settings.paperDark === 'default' }" @click="settings.paperDark = 'default'">默认</button>
                <button :class="{ 'is-on': settings.paperDark === 'warm' }" @click="settings.paperDark = 'warm'">暖夜</button>
                <button :class="{ 'is-on': settings.paperDark === 'black' }" @click="settings.paperDark = 'black'">纯黑</button>
              </div>
              <div v-else class="seg">
                <button :class="{ 'is-on': settings.paperLight === 'default' }" @click="settings.paperLight = 'default'">默认</button>
                <button :class="{ 'is-on': settings.paperLight === 'ivory' }" @click="settings.paperLight = 'ivory'">米白</button>
                <button :class="{ 'is-on': settings.paperLight === 'sepia' }" @click="settings.paperLight = 'sepia'">羊皮</button>
                <button :class="{ 'is-on': settings.paperLight === 'green' }" @click="settings.paperLight = 'green'">豆绿</button>
              </div>
            </div>
          </div>
        </template>

        <!-- 阅读 -->
        <template v-else-if="tab === 'reading'">
          <!-- 阅读宽度只对桌面有意义:窄屏正文一律铺满(版心是为了控制每行字数,手机上没得控) -->
          <div v-if="!isNarrow" class="set-item">
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
            <!-- 上下限与手机端双指捏合一致(MarkdownView),否则捏到 21/22 再回设置面板会被悄悄夹回去 -->
            <input v-model.number="settings.fontSize" type="range" min="13" max="22" step="1" class="si-range" />
          </div>
          <div class="set-item set-item--col">
            <div class="si-info">
              <div class="si-title">行高</div>
              <div class="si-desc">{{ settings.lineHeight.toFixed(2) }} · 中文长文对行高最敏感,性价比最高的一项</div>
            </div>
            <input v-model.number="settings.lineHeight" type="range" min="1.5" max="2.2" step="0.05" class="si-range" />
          </div>
          <div class="set-item set-item--col">
            <div class="si-info">
              <div class="si-title">段间距</div>
              <div class="si-desc">{{ settings.paraGap.toFixed(2) }} em · 调宽章节感更强,调窄信息密度更高</div>
            </div>
            <input v-model.number="settings.paraGap" type="range" min="0.2" max="2" step="0.05" class="si-range" />
          </div>
          <div class="set-item set-item--col">
            <div class="si-info">
              <div class="si-title">字间距</div>
              <div class="si-desc">{{ settings.letterSpacing.toFixed(3) }} em · 中文小幅加字间距会明显"透气",过头会散</div>
            </div>
            <input v-model.number="settings.letterSpacing" type="range" min="0" max="0.1" step="0.005" class="si-range" />
          </div>
          <div class="set-item">
            <div class="si-info">
              <div class="si-title">首行缩进两字</div>
              <div class="si-desc">中文书籍式排版;和大段间距只该留一个,可用下面的「书籍式」一键配好</div>
            </div>
            <button
              class="switch"
              role="switch"
              :aria-checked="settings.indent"
              :class="{ 'is-on': settings.indent }"
              @click="settings.indent = !settings.indent"
            ></button>
          </div>
          <div class="set-item set-item--col">
            <div class="si-btns">
              <button class="opt" @click="settings.applyTypo(TYPO_DEFAULT)">恢复默认排版</button>
              <button class="opt" @click="settings.applyTypo(TYPO_BOOK)">书籍式排版</button>
            </div>
          </div>

          <!-- ---- 正文字体:内置 / 已下载 / 可下载 / 本机系统字体 ---- -->
          <div class="set-item set-item--col">
            <div class="si-info">
              <div class="si-title">正文字体</div>
              <div class="si-desc">当前:{{ currentFontLabel }}</div>
            </div>

            <div class="fo-sub">内置</div>
            <button
              v-for="f in BUILTIN_FONTS"
              :key="f.family || 'sys'"
              class="fo-row"
              :class="{ 'is-on': settings.bodyFont === f.family }"
              @click="settings.bodyFont = f.family"
            >
              <span class="fo-name">
                {{ f.label }}
                <em v-if="!f.family && sysGuess" class="fo-hint">当前:{{ sysGuess }}</em>
              </span>
              <span class="fo-preview" :style="previewStyle(f.family)">墨阅 · 汉字测试 Abc 123</span>
              <span v-if="settings.bodyFont === f.family" class="fo-check"><Icon name="check" :size="15" /></span>
            </button>

            <template v-if="installed.length > 0">
              <div class="fo-sub">已下载 · 共 {{ mb(installedBytes) }}</div>
              <div v-for="f in installed" :key="f.id" class="fo-line">
                <button class="fo-row fo-row--grow" :class="{ 'is-on': settings.bodyFont === f.family }" @click="settings.bodyFont = f.family">
                  <span class="fo-name">{{ f.name }}</span>
                  <span class="fo-preview" :style="previewStyle(f.family)">墨阅 · 汉字测试 Abc 123</span>
                  <span v-if="settings.bodyFont === f.family" class="fo-check"><Icon name="check" :size="15" /></span>
                </button>
                <button class="fo-act" :title="`删除 ${f.name}(${mb(f.size)})`" @click="removeFont(f)">
                  <Icon name="trash" :size="15" />
                </button>
              </div>
            </template>

            <template v-if="isTauri">
              <div class="fo-sub">
                可下载
                <em v-if="fontsErr" class="fo-hint">{{ fontsErr }}</em>
              </div>
              <div v-if="downloadable.length === 0 && !fontsErr" class="si-desc">{{ fontsLoading ? '正在获取清单…' : '暂无可下载字体' }}</div>
              <div v-for="m in downloadable" :key="m.id" class="fo-line">
                <div class="fo-row fo-row--grow fo-row--static">
                  <span class="fo-name">
                    {{ m.name }}
                    <em class="fo-hint">{{ mb(m.size) }} · {{ m.license }}</em>
                  </span>
                  <span class="fo-desc">{{ m.desc }}</span>
                </div>
                <button v-if="fontProgress[m.id] === undefined" class="fo-act fo-act--dl" title="下载" @click="download(m)">
                  <Icon name="download" :size="15" />
                </button>
                <span v-else class="fo-pct">{{ fontProgress[m.id] }}%</span>
              </div>
            </template>

            <div class="fo-sub fo-sub--btn" @click="showSystem = !showSystem">
              <Icon :name="showSystem ? 'chevron-down' : 'chevron-right'" :size="13" />
              本机系统字体({{ detected.length }} 款,因设备而异)
            </div>
            <template v-if="showSystem">
              <button
                v-for="f in detected"
                :key="f.family"
                class="fo-row"
                :class="{ 'is-on': settings.bodyFont === f.family }"
                @click="settings.bodyFont = f.family"
              >
                <span class="fo-name">{{ f.label }}</span>
                <span class="fo-preview" :style="previewStyle(f.family)">墨阅 · 汉字测试 Abc 123</span>
                <span v-if="settings.bodyFont === f.family" class="fo-check"><Icon name="check" :size="15" /></span>
              </button>
              <div class="fo-custom">
                <input v-model="customFont" class="si-input fo-input" placeholder="自定义字体名,如 方正书宋" @keydown.enter="useCustom" />
                <button class="opt" :disabled="!customFont.trim()" @click="useCustom">使用</button>
              </div>
            </template>
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

        <!-- 窗口(桌面) -->
        <template v-else-if="tab === 'window'">
          <div class="set-item">
            <div class="si-info">
              <div class="si-title">点右上角关闭按钮时</div>
              <div class="si-desc">
                {{
                  settings.closeToTray
                    ? '主窗口收进系统托盘,墨阅留在后台;点托盘图标可再打开,托盘右键菜单里退出'
                    : '直接退出墨阅(默认)。收进托盘时才会出现托盘图标'
                }}
              </div>
            </div>
            <div class="si-ctrl">
              <div class="seg">
                <button :class="{ 'is-on': !settings.closeToTray }" @click="settings.closeToTray = false">退出程序</button>
                <button :class="{ 'is-on': settings.closeToTray }" @click="settings.closeToTray = true">收进托盘</button>
              </div>
            </div>
          </div>
        </template>

        <!-- Git 令牌 -->
        <template v-else-if="tab === 'token'">
          <template v-if="isTauri">
            <div class="set-item set-item--col">
              <div class="si-info">
                <div class="si-title">访问令牌</div>
                <div class="si-desc">
                  私有仓库拉取/推送用,按域名保存。<b>取用顺序:先试系统 git 的凭据管理器,再用这里保存的令牌。</b>
                  所以桌面端即使这里一个都没存,只要你用命令行 git 推送过该仓库,墨阅也能直接拉 —— 用的是系统里那份凭据。
                </div>
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
              <!-- 克隆对话框里填的令牌会被静默存下来,用户回头在这儿看到会一头雾水,点明来源 -->
              <div v-if="savedHosts.length" class="si-desc tok-hint">
                这些域名可能来自「克隆远程仓库…」时填的令牌 —— 那一步填了会自动按域名保存,供后续拉取复用。
              </div>
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

        <!-- 存储权限(仅 Android:文库在手机存储里,没这个权限什么都读不到) -->
        <template v-else-if="tab === 'storage'">
          <div class="set-item">
            <div class="si-info">
              <div class="si-title">所有文件访问</div>
              <div class="si-desc">
                读取手机里的 git 文库目录必需。未授权时:文件树只剩空目录、git 状态显示不可用、新建文档报「Operation not permitted」。
              </div>
            </div>
            <div class="si-ctrl">
              <span class="perm-tag" :class="{ 'is-ok': permOk }">{{ permOk ? '已授权' : '未授权' }}</span>
            </div>
          </div>
          <div class="set-item set-item--col">
            <div class="si-btns">
              <button class="opt is-on" @click="openPermPage">去系统授权页</button>
              <button class="opt" @click="refreshPerm">重新检查</button>
            </div>
            <div class="si-desc">
              路径:系统设置 → 应用管理 → 墨阅 → 权限 → 文件和媒体 → 允许管理所有文件。
              墨阅只读写你亲手选中的文库目录。
            </div>
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
  </MobilePage>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { errMsg } from '@/core/errmsg'
import { TYPO_BOOK, TYPO_DEFAULT, useSettings, type Brand } from '@/stores/settings'
import { backend, isTauri } from '@/core/backend'
import type { FontMeta, InstalledFont } from '@/core/backend'
import { detectSystemFonts, guessSystemFont, hasFont, registerFontFaces, type DetectedFont } from '@/core/fonts'
import { fontProgress, installFont } from '@/core/font-tasks'
import { toast } from '@/core/toast'
import Icon from '@/components/Icon.vue'
import MobilePage from '@/components/MobilePage.vue'
import { useBackLayerWhen } from '@/core/backstack'
import { checkStorageAccess, isAndroid, requestStorageAccess } from '@/core/storage-perm'

const emit = defineEmits<{ close: [] }>()
const settings = useSettings()

type TabKey = 'appearance' | 'reading' | 'sync' | 'token' | 'storage' | 'window' | 'help' | 'about'

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'appearance', label: '外观', icon: 'palette' },
  { key: 'reading', label: '阅读', icon: 'book' },
  { key: 'sync', label: '同步', icon: 'refresh' },
  { key: 'token', label: 'Git 令牌', icon: 'key' },
  // 存储权限只在 Android 有意义(桌面没有分区存储这回事)
  ...(isAndroid ? [{ key: 'storage' as TabKey, label: '存储权限', icon: 'shield' }] : []),
  // 窗口行为(关闭按钮 → 托盘)只有桌面打包版有;浏览器和手机都没有"关闭窗口"这回事
  ...(isTauri && !isAndroid ? [{ key: 'window' as TabKey, label: '窗口', icon: 'display' }] : []),
  { key: 'help', label: '帮助', icon: 'help' },
  { key: 'about', label: '关于', icon: 'info' },
]

const tab = ref<TabKey>('appearance')

const BRANDS: { key: Brand; label: string }[] = [
  { key: 'ink', label: '墨青黛蓝' },
  { key: 'violet', label: '紫罗兰' },
  { key: 'forest', label: '竹青' },
  { key: 'amber', label: '秋赭' },
  { key: 'rose', label: '黛粉' },
  { key: 'slate', label: '石墨' },
]
const brandLabel = computed(() => BRANDS.find((b) => b.key === settings.brand)?.label ?? '')

// ---- 正文字体 ----
/** 打包进安装包、离线必定可用的两档;空 family = 跟随系统 */
const BUILTIN_FONTS = [
  { label: '系统默认', family: '' },
  { label: '霞鹜文楷', family: 'LXGW WenKai Screen' },
]

const detected = ref<DetectedFont[]>([])
const sysGuess = ref('')
const installed = ref<InstalledFont[]>([])
const manifest = ref<FontMeta[]>([])
const fontsErr = ref('')
const fontsLoading = ref(false)
const showSystem = ref(false)
const customFont = ref('')

const installedBytes = computed(() => installed.value.reduce((n, f) => n + f.size, 0))
/** 清单里去掉已经装上的 */
const downloadable = computed(() => manifest.value.filter((m) => !installed.value.some((f) => f.id === m.id)))

const currentFontLabel = computed(() => {
  const cur = settings.bodyFont
  if (!cur) return sysGuess.value ? `系统默认(${sysGuess.value})` : '系统默认'
  return (
    BUILTIN_FONTS.find((f) => f.family === cur)?.label ??
    installed.value.find((f) => f.family === cur)?.name ??
    detected.value.find((f) => f.family === cur)?.label ??
    cur
  )
})

function previewStyle(family: string): Record<string, string> {
  return { fontFamily: family ? `"${family}", var(--font-sans)` : 'var(--font-sans)' }
}

function mb(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** 字体数据只在真正翻到「阅读」页时才拉一次:探测要跑上百次 measureText,清单要走网络 */
let fontsReady = false
async function loadFonts(): Promise<void> {
  if (fontsReady) return
  fontsReady = true
  detected.value = detectSystemFonts()
  sysGuess.value = guessSystemFont(detected.value)
  try {
    installed.value = await backend.fontInstalled()
  } catch {
    /* 读不到就当没装 */
  }
  if (!isTauri) return
  fontsLoading.value = true
  try {
    manifest.value = (await backend.fontManifest()).fonts
  } catch (e) {
    // 拉不到清单不弹错、不挡路 —— 离线时"已下载"那几款照样能选
    fontsErr.value = errMsg(e)
  } finally {
    fontsLoading.value = false
  }
}

watch(tab, (t) => {
  if (t === 'reading') void loadFonts()
})

/**
 * 下载交给 core/font-tasks 的全局任务表:进度和 @font-face 重登记都不依赖本面板活着 ——
 * 下载中关掉设置页,再进来还能看见进度条,也不会误开第二个下载线程。
 */
async function download(m: FontMeta): Promise<void> {
  await installFont(m)
  // 面板还开着就把「已下载」那一栏刷出来(关掉了也无所谓,下次进来 loadFonts 会重读)
  try {
    installed.value = await backend.fontInstalled()
  } catch {
    /* 读不到就等下次进面板再刷 */
  }
}

async function removeFont(f: InstalledFont): Promise<void> {
  if (!window.confirm(`删除字体「${f.name}」(${mb(f.size)})?下次还想用需要重新下载。`)) return
  try {
    await backend.fontUninstall(f.id)
    // 正在用的字体被删掉就退回系统默认,免得正文变成一片豆腐块
    if (settings.bodyFont === f.family) settings.bodyFont = ''
    installed.value = await backend.fontInstalled()
    registerFontFaces(installed.value, backend.fontUrl)
    toast(`已删除 ${f.name}`)
  } catch (e) {
    toast(errMsg(e), true)
  }
}

/** 候选表覆盖不到的字体走这里;同样过 canvas 实测校验,装没装一目了然 */
function useCustom(): void {
  const name = customFont.value.trim()
  if (!name) return
  if (!hasFont(name)) {
    toast(`这台设备上没找到「${name}」。要填字体名而不是文件名,注意区分中英文名`, true)
    return
  }
  settings.bodyFont = name
  customFont.value = ''
  toast(`正文字体已切换到 ${name}`)
}

// ---- 存储权限(Android 手动入口) ----
const permOk = ref(true)

async function refreshPerm(): Promise<void> {
  permOk.value = await checkStorageAccess()
}

async function openPermPage(): Promise<void> {
  try {
    await requestStorageAccess()
  } catch (e) {
    toast(errMsg(e), true)
  }
}

/** 从系统授权页切回来自动复查,省得用户再点「重新检查」 */
function onVisible(): void {
  if (document.visibilityState === 'visible') void refreshPerm()
}

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

/** 只有手机端的二级页才算"可返回上一级",桌面是一整张模态卡 */
const secondLevel = computed(() => isNarrow.value && !atRoot.value)
const pageTitle = computed(() => (secondLevel.value ? currentTabLabel.value : '设置'))

// 二级页自己占一层:系统返回键先退回分组列表,再按一次才关掉设置
useBackLayerWhen(secondLevel, () => {
  atRoot.value = true
})

function onBack(): void {
  if (secondLevel.value) atRoot.value = true
  else emit('close')
}

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
onMounted(() => {
  void loadHosts()
  void refreshPerm()
  document.addEventListener('visibilitychange', onVisible)
})
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisible)
})

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
/* 外壳(标题栏 / 返回 / 安全区 / 键盘避让)统一由 MobilePage 提供,这里只管内容 */
.sm-body {
  flex: 1;
  min-width: 0;
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

/* 品牌色卡:6 套一行摆不下就换行 */
.sw-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* ---------- 字体选择列表 ---------- */
.fo-sub {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--t3);
  font-weight: 600;
  margin: 12px 0 4px;
}
.fo-sub--btn {
  cursor: pointer;
  user-select: none;
}
.fo-sub--btn:hover {
  color: var(--t2);
}
.fo-line {
  display: flex;
  align-items: center;
  gap: 6px;
}
.fo-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: none;
  color: var(--t1);
  text-align: left;
  padding: 8px 10px;
  cursor: pointer;
}
.fo-row--grow {
  flex: 1;
  min-width: 0;
}
/* 可下载项还没装,点了也没用 —— 不做成可选中的行 */
.fo-row--static {
  cursor: default;
}
.fo-row:not(.fo-row--static):hover {
  background: var(--bg-hover);
}
.fo-row.is-on {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.fo-name {
  flex-shrink: 0;
  font-size: 13.5px;
  min-width: 92px;
}
.fo-hint {
  display: block;
  font-style: normal;
  font-size: 11.5px;
  color: var(--t3);
  font-weight: 400;
}
/* 预览行用该字体自身渲染,所见即所得;放不下就省略,不许换行把行高撑乱 */
.fo-preview,
.fo-desc {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  color: var(--t2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fo-desc {
  font-size: 12.5px;
  color: var(--t3);
}
.fo-check {
  flex-shrink: 0;
  display: inline-flex;
  color: var(--accent-deep);
}
.fo-act {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--bg-side);
  color: var(--t3);
  cursor: pointer;
}
.fo-act:hover {
  color: var(--t1);
  border-color: var(--accent);
}
.fo-act--dl:hover {
  color: var(--accent-deep);
}
.fo-pct {
  flex-shrink: 0;
  width: 42px;
  text-align: right;
  font-size: 12px;
  color: var(--accent-deep);
  font-variant-numeric: tabular-nums;
}
.fo-custom {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.fo-input {
  flex: 1;
  min-width: 0;
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

/* 权限状态徽标 */
.perm-tag {
  font-size: 12px;
  padding: 3px 12px;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  background: var(--bg-side);
  color: var(--t3);
  white-space: nowrap;
}
.perm-tag.is-ok {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-deep);
  font-weight: 600;
}

/* ---------- 手机:整屏页(外壳在 MobilePage,这里只调内容密度) ---------- */
@media (max-width: 900px) {
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
