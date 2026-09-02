<template>
  <div class="find-bar" @keydown.stop>
    <input
      ref="inputEl"
      v-model="query"
      class="fb-input"
      :placeholder="placeholder"
      spellcheck="false"
      @keydown.enter.prevent="onEnter"
      @keydown.esc.prevent="emit('close')"
    />
    <span class="fb-count" :class="{ 'is-empty': total === 0 && !!query.trim() }">
      {{ busy ? '搜索中…' : total > 0 ? `${index + 1}/${total}` : query.trim() ? '无结果' : '' }}
    </span>
    <button class="fb-btn" title="上一处 (Shift+Enter)" :disabled="total === 0" @click="emit('step', -1)">
      <Icon name="chevron-up" :size="15" />
    </button>
    <button class="fb-btn" title="下一处 (Enter)" :disabled="total === 0" @click="emit('step', 1)">
      <Icon name="chevron-down" :size="15" />
    </button>
    <button
      v-if="wholeLabel"
      class="fb-scope"
      :class="{ 'is-on': wholeActive }"
      :title="wholeActive ? '回到只搜当前位置' : '搜索整本书(逐章扫一遍,长书要几秒)'"
      @click="emit('whole')"
    >
      {{ wholeLabel }}
    </button>
    <button class="fb-btn" title="关闭 (Esc)" @click="emit('close')"><Icon name="close" :size="14" /></button>
  </div>
</template>

<script setup lang="ts">
/**
 * 文内查找条。只管 UI 与输入节奏,搜什么、怎么高亮由各视图自己实现 ——
 * markdown/HTML 在当前 DOM 里找,电子书要跨章,PDF 要跨页取文本,三者机制不同。
 */
import { nextTick, onMounted, ref, watch } from 'vue'
import Icon from '@/components/Icon.vue'

const props = withDefaults(
  defineProps<{
    total: number
    index: number
    busy?: boolean
    placeholder?: string
    /** 初始关键词(从别处带过来的,比如全库搜索命中) */
    initial?: string
    /** 给出文案则显示"全书"按钮(只有电子书需要:它按章渲染,当前 DOM 里只有几章) */
    wholeLabel?: string
    wholeActive?: boolean
  }>(),
  { busy: false, placeholder: '在本文中查找…', initial: '', wholeLabel: '', wholeActive: false },
)

const emit = defineEmits<{
  search: [query: string]
  step: [dir: number]
  whole: []
  close: []
}>()

const query = ref(props.initial)
const inputEl = ref<HTMLInputElement | null>(null)
let timer: ReturnType<typeof setTimeout> | null = null

// 边打边搜,但要防抖:电子书全书查找要逐章解压,每敲一个字都跑一遍会卡
watch(query, (q) => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => emit('search', q), 220)
})

function onEnter(e: KeyboardEvent): void {
  // Enter 下一处、Shift+Enter 上一处;还没搜过就先立刻搜(不等防抖)
  if (props.total === 0) {
    if (timer) clearTimeout(timer)
    emit('search', query.value)
    return
  }
  emit('step', e.shiftKey ? -1 : 1)
}

onMounted(() => {
  void nextTick(() => {
    inputEl.value?.focus()
    inputEl.value?.select()
  })
  if (props.initial.trim()) emit('search', props.initial)
})

defineExpose({ focus: () => inputEl.value?.focus() })
</script>

<style scoped>
.find-bar {
  position: absolute;
  top: 10px;
  right: 16px;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 6px 5px 10px;
  border-radius: 999px;
  background: var(--bg-card);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-md);
}
.fb-input {
  width: 168px;
  border: none;
  background: none;
  outline: none;
  font-size: 13px;
  font-family: inherit;
  color: var(--t1);
}
.fb-count {
  font-size: 12px;
  color: var(--t3);
  font-variant-numeric: tabular-nums;
  min-width: 46px;
  text-align: center;
}
.fb-count.is-empty {
  color: var(--danger, #c0392b);
}
.fb-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 50%;
  background: none;
  color: var(--t2);
  cursor: pointer;
}
.fb-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--accent-deep);
}
.fb-btn:disabled {
  opacity: 0.35;
  cursor: default;
}
.fb-scope {
  border: 1px solid var(--line);
  background: none;
  border-radius: 999px;
  padding: 2px 9px;
  font-size: 12px;
  font-family: inherit;
  color: var(--t2);
  cursor: pointer;
  white-space: nowrap;
}
.fb-scope:hover {
  border-color: var(--accent-line);
  color: var(--accent-deep);
}
.fb-scope.is-on {
  background: var(--accent-soft);
  border-color: var(--accent-line);
  color: var(--accent-deep);
  font-weight: 600;
}
@media (max-width: 900px) {
  .find-bar {
    left: 12px;
    right: 12px;
    top: 8px;
  }
  .fb-input {
    flex: 1;
    width: auto;
    font-size: 14px;
  }
  .fb-btn {
    width: 32px;
    height: 32px;
  }
}
</style>
