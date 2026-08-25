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
