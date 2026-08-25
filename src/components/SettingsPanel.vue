<template>
  <div class="mask" @click.self="emit('close')">
    <div class="settings">
      <h3>设置</h3>

      <div class="set-group">
        <div class="set-label">品牌主题</div>
        <div class="set-row">
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
          <span style="font-size: 12px; color: var(--t3)">{{ settings.brand === 'ink' ? '墨青黛蓝' : '紫罗兰' }}</span>
        </div>
      </div>

      <div class="set-group">
        <div class="set-label">明暗模式</div>
        <div class="set-row">
          <button class="opt" :class="{ 'is-on': settings.mode === 'auto' }" @click="settings.mode = 'auto'">跟随系统</button>
          <button class="opt" :class="{ 'is-on': settings.mode === 'light' }" @click="settings.mode = 'light'">浅色</button>
          <button class="opt" :class="{ 'is-on': settings.mode === 'dark' }" @click="settings.mode = 'dark'">深色</button>
        </div>
      </div>

      <div class="set-group">
        <div class="set-label">阅读宽度</div>
        <div class="set-row">
          <button class="opt" :class="{ 'is-on': settings.width === 'book' }" @click="settings.width = 'book'">书卷版心</button>
          <button class="opt" :class="{ 'is-on': settings.width === 'wide' }" @click="settings.width = 'wide'">宽页展开</button>
        </div>
      </div>

      <div class="set-group">
        <div class="set-label">阅读纸色(浅色模式)</div>
        <div class="set-row">
          <button class="opt" :class="{ 'is-on': settings.paper === 'default' }" @click="settings.paper = 'default'">默认</button>
          <button class="opt" :class="{ 'is-on': settings.paper === 'sepia' }" @click="settings.paper = 'sepia'">羊皮</button>
          <button class="opt" :class="{ 'is-on': settings.paper === 'green' }" @click="settings.paper = 'green'">豆绿</button>
        </div>
      </div>

      <div class="set-group">
        <div class="set-label">正文字号:{{ settings.fontSize }}px</div>
        <input v-model.number="settings.fontSize" type="range" min="14" max="20" step="1" class="set-range" />
      </div>

      <div class="set-group">
        <div class="set-label">正文字体</div>
        <div class="set-row">
          <button class="opt" :class="{ 'is-on': !settings.serifBody }" @click="settings.serifBody = false">系统黑体</button>
          <button class="opt" :class="{ 'is-on': settings.serifBody }" @click="settings.serifBody = true">霞鹜文楷</button>
        </div>
      </div>

      <div class="set-group">
        <div class="set-label">同步与保存</div>
        <div class="set-row">
          <button class="opt" :class="{ 'is-on': settings.autoPull }" @click="settings.autoPull = !settings.autoPull">
            启动时自动拉取 {{ settings.autoPull ? '开' : '关' }}
          </button>
          <button class="opt" :class="{ 'is-on': settings.autoSave }" @click="settings.autoSave = !settings.autoSave">
            编辑自动保存 {{ settings.autoSave ? '开' : '关' }}
          </button>
        </div>
        <div class="set-hint">自动保存开启后,停止输入 2 秒自动写入文件;关闭时用顶栏保存按钮或 Ctrl+S。</div>
      </div>

      <div class="set-group">
        <div class="set-label">Git 访问令牌(私有仓库拉取/推送)</div>
        <template v-if="isTauri">
          <div class="set-row" style="flex-direction: column; align-items: stretch; gap: 8px">
            <input v-model="tokenHost" class="palette-input" placeholder="gitee.com" />
            <input v-model="tokenValue" class="palette-input" type="password" placeholder="Personal Access Token" />
            <div style="display: flex; gap: 8px">
              <button class="opt is-on" :disabled="!tokenHost.trim()" @click="saveTok">保存令牌</button>
              <button class="opt" :disabled="!tokenHost.trim()" @click="clearTok">删除该域令牌</button>
            </div>
          </div>
          <div class="set-hint">桌面端优先使用系统 git 已保存的凭据;此处令牌供克隆的仓库与手机端使用,按域名保存。</div>
        </template>
        <div v-else class="set-hint">
          开发模式凭据走系统 git;仓库注册在 dev-server/repos.local.json。
        </div>
      </div>

      <div class="set-group">
        <div class="set-label">帮助</div>

        <details class="help-fold">
          <summary>快捷键</summary>
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
        </details>

        <details class="help-fold">
          <summary>使用要点</summary>
          <div class="help-body">
            <p>· 点击底部状态条「N 个未提交变更」查看本地改动明细并一键推送</p>
            <p>· 点击面包屑中的目录名可在文库树中定位;标题旁箭头可折叠章节</p>
            <p>· 编辑时粘贴截图会自动存入文档旁 assets/ 目录</p>
            <p>· 同步遇到冲突时,墨阅不代为合并——请用 git 工具处理,或选择放弃本地修改</p>
            <p>· 手机端:左上角开文库抽屉,右下角浮动球开目录,双指捏合调字号</p>
          </div>
        </details>

        <div class="set-hint" style="display: flex; justify-content: space-between; align-items: center">
          <span>墨阅 Inkread v{{ version }}</span>
          <button class="opt" style="height: 26px; font-size: 11.5px" @click="openRepo">GitHub 仓库</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useSettings } from '@/stores/settings'
import { backend, isTauri } from '@/core/backend'
import { toast } from '@/core/toast'

const emit = defineEmits<{ close: [] }>()
const settings = useSettings()

const tokenHost = ref('gitee.com')
const tokenValue = ref('')
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
    toast('令牌已保存')
  } catch (e) {
    toast((e as Error).message, true)
  }
}

async function clearTok(): Promise<void> {
  try {
    await backend.saveToken(tokenHost.value.trim(), '')
    toast('已删除该域令牌')
  } catch (e) {
    toast((e as Error).message, true)
  }
}
</script>
