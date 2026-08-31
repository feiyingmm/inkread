<template>
  <div class="mp-mask" @click.self="onMaskClick">
    <section class="mp" :class="{ 'mp--wide': wide }">
      <header class="mp-bar" :class="{ 'mp-bar--close': showClose }">
        <button class="mp-lead" :title="backTitle" :disabled="busy" @click="emit('back')">
          <Icon :name="leadIcon" :size="20" />
        </button>
        <h3 class="mp-title">{{ title }}</h3>
        <div class="mp-trail"><slot name="actions" /></div>
      </header>

      <div class="mp-body" :class="{ 'mp-body--flush': flush, 'mp-body--fixed': noScroll }">
        <slot />
      </div>

      <footer v-if="$slots.footer" class="mp-foot">
        <slot name="footer" />
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from '@/components/Icon.vue'
import { useBackLayer } from '@/core/backstack'

/**
 * 手机端统一的「整屏页」外壳:顶部一条标题栏(左返回 / 居中标题 / 右操作),
 * 下面是滚动内容,可选底部操作条。桌面端同一份结构收敛成居中模态卡。
 *
 * 三件事由它一并兜住,各弹层不必各自重复:
 * 1. 顶部让位 `--safe-top`、底部让位 `--safe-bottom`(Android WebView 的
 *    `env(safe-area-inset-*)` 恒为 0,真实数值由原生 MainActivity 写进 CSS 变量);
 * 2. 软键盘:整页底边抬到键盘上沿(`bottom: var(--kb)`),输入框与按钮永远露着 ——
 *    targetSdk 35+ 以后 adjustResize 已失效,WebView 不会自己缩;
 * 3. 系统返回键/返回手势:挂载即占一层,返回优先关掉本页而不是退出应用。
 */
const props = withDefaults(
  defineProps<{
    title: string
    /** 前导按钮语义:返回(二级页/整屏页)或关闭(桌面模态) */
    lead?: 'back' | 'close'
    /** 内容区自带内边距;列表类页面传 true 让内容贴边 */
    flush?: boolean
    /** 桌面端用更宽的卡片(设置面板这类多栏内容) */
    wide?: boolean
    /** 内容自带滚动结构(如设置的左右分栏),由内容自己滚,外层不滚 */
    noScroll?: boolean
    /** 忙碌时禁用返回,避免中途打断(如克隆进行中) */
    busy?: boolean
    /** 点击遮罩是否关闭(桌面模态惯例;手机整屏页没有遮罩可点) */
    maskClose?: boolean
  }>(),
  { lead: 'back', flush: false, wide: false, noScroll: false, busy: false, maskClose: true },
)

const emit = defineEmits<{ back: [] }>()

const narrowMq = window.matchMedia('(max-width: 900px)')
const isNarrow = ref(narrowMq.matches)
narrowMq.addEventListener('change', (e) => (isNarrow.value = e.matches))

/**
 * 桌面上这层是**居中模态卡**,前导按钮的语义只有"关掉这张卡"——一律显示 ✕ 并挪到
 * 右上角(桌面窗口惯例;左上角的 ← 是手机整屏页的语义)。手机端不变:左上角返回。
 * 例外是手机设置的二级页(lead='back' 且窄屏),那才是真的"退回上一级"。
 */
const showClose = computed(() => !isNarrow.value || props.lead === 'close')

const leadIcon = computed(() => (showClose.value ? 'close' : 'back'))
const backTitle = computed(() => (showClose.value ? '关闭' : '返回'))

useBackLayer(() => {
  if (!props.busy) emit('back')
})

function onMaskClick(): void {
  if (props.maskClose && !props.busy) emit('back')
}
</script>

<style scoped>
.mp-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  /* 键盘弹起时整页底边抬到键盘上沿 */
  bottom: var(--kb, 0px);
  z-index: 50;
  display: flex;
}

.mp {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg-card);
}

.mp-bar {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  padding: 0 8px;
  min-height: 52px;
  border-bottom: 1px solid var(--line);
}

.mp-title {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-family: var(--font-serif);
  font-size: 16px;
  font-weight: 600;
  color: var(--t1);
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mp-lead,
.mp-trail {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 40px;
}

.mp-lead {
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 50%;
  background: none;
  color: var(--t2);
  cursor: pointer;
}
.mp-lead:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--t1);
}
.mp-lead:disabled {
  opacity: 0.4;
  cursor: default;
}

.mp-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 16px 18px;
}
.mp-body--flush {
  padding: 0;
}
.mp-body--fixed {
  overflow: hidden;
  display: flex;
}

.mp-foot {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-top: 1px solid var(--line);
}

/* ---------- 桌面:居中模态卡 ---------- */
@media (min-width: 901px) {
  .mp-mask {
    background: rgba(8, 15, 24, 0.4);
    align-items: center;
    justify-content: center;
    animation: mp-fade 0.16s ease;
  }
  /* 关闭按钮排到最后一格 = 右上角;标题随之左对齐(桌面弹窗惯例) */
  .mp-bar--close .mp-lead {
    order: 3;
  }
  .mp-bar--close .mp-title {
    text-align: left;
    padding-left: 8px;
  }
  .mp {
    width: min(520px, calc(100vw - 64px));
    max-height: min(620px, calc(100vh - 96px));
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-card);
    overflow: hidden;
  }
  /* 宽卡(设置)固定高度:内容按分类切换时高矮不一,不定高会让整张卡跳来跳去 */
  .mp--wide {
    width: min(780px, calc(100vw - 64px));
    height: min(620px, calc(100vh - 90px));
    max-height: none;
  }
}

/* ---------- 手机:整屏页 ---------- */
@media (max-width: 900px) {
  .mp-mask {
    background: var(--bg-card);
    animation: mp-slide 0.2s ease;
  }
  .mp {
    flex: 1;
    min-width: 0;
  }
  .mp-bar {
    /* 顶到屏幕最上沿,状态栏区域由页面自己让位 —— 与主界面一致的沉浸观感 */
    padding-top: var(--safe-top, 0px);
    min-height: calc(56px + var(--safe-top, 0px));
    background: var(--bg-card);
  }
  .mp-title {
    font-size: 17px;
  }
  .mp-lead {
    width: 44px;
    height: 44px;
  }
  .mp-body {
    padding: 14px 16px calc(20px + var(--safe-bottom, 0px));
  }
  .mp-body--flush {
    padding: 0 0 calc(8px + var(--safe-bottom, 0px));
  }
  .mp-foot {
    padding: 10px 16px calc(10px + var(--safe-bottom, 0px));
  }
}

@keyframes mp-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@keyframes mp-slide {
  from {
    opacity: 0.4;
    transform: translateX(12%);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
</style>
