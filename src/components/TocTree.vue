<template>
  <div class="tt">
    <div v-for="n in nodes" :key="n.slug" class="tt-item">
      <div
        class="tt-row"
        :class="[
          `tt-row--d${Math.min(depth, 3)}`,
          {
            'is-active': n.slug === activeSlug,
            'is-trail': collapsed[n.slug] && trail.has(n.slug),
            'has-kids': n.children.length > 0,
          },
        ]"
      >
        <button
          v-if="n.children.length > 0"
          class="tt-caret"
          :class="{ 'is-open': !collapsed[n.slug] }"
          :title="collapsed[n.slug] ? '展开本节' : '折叠本节'"
          @click.stop="emit('toggle', n.slug)"
        >
          <Icon name="chevron-right" :size="11" />
        </button>
        <span v-else class="tt-caret tt-caret--leaf"></span>
        <button class="tt-label" :title="n.title" @click="emit('jump', n.slug)">{{ n.title }}</button>
      </div>

      <div v-if="n.children.length > 0 && !collapsed[n.slug]" class="tt-kids">
        <TocTree
          :nodes="n.children"
          :active-slug="activeSlug"
          :collapsed="collapsed"
          :trail="trail"
          :depth="depth + 1"
          @jump="emit('jump', $event)"
          @toggle="emit('toggle', $event)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import Icon from '@/components/Icon.vue'
import type { TocNode } from '@/core/toc-tree'

/**
 * 文内目录的层级树(语雀式):缩进 + 竖向层级线 + 逐级递弱的字重字色,
 * 有子节点的行左侧带三角可折叠。折叠状态由**调用方**持有(整棵树共用一份),
 * 递归实例只读不写,免得每层各存一份对不上。
 */
withDefaults(
  defineProps<{
    nodes: TocNode[]
    activeSlug: string
    /** slug → 是否折叠 */
    collapsed: Record<string, boolean>
    /** 当前标题的祖先 slug:折叠着也能看出"当前正读在这一节里" */
    trail: Set<string>
    depth?: number
  }>(),
  { depth: 0 },
)

const emit = defineEmits<{ jump: [slug: string]; toggle: [slug: string] }>()
</script>

<style scoped>
.tt-row {
  display: flex;
  align-items: flex-start;
  gap: 1px;
  border-radius: var(--radius-sm);
  position: relative;
}
.tt-row:hover {
  background: var(--bg-hover);
}

/* 层级线:每下一级挂一条竖线 + 缩进,层次一眼可辨 */
.tt-kids {
  margin-left: 9px;
  padding-left: 5px;
  border-left: 1px solid var(--line);
}

.tt-caret {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 22px;
  padding: 0;
  border: none;
  background: none;
  color: var(--t3);
  cursor: pointer;
  transition: transform 0.14s ease, color 0.14s ease;
}
.tt-caret.is-open {
  transform: rotate(90deg);
}
.tt-caret:hover {
  color: var(--accent);
}
.tt-caret--leaf {
  cursor: default;
}

.tt-label {
  flex: 1;
  min-width: 0;
  border: none;
  background: none;
  text-align: left;
  cursor: pointer;
  padding: 3px 8px 3px 2px;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--t2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 逐级递弱:一级标题最重最深,越深越轻 —— 不靠缩进也能分出层级 */
.tt-row--d0 > .tt-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--t1);
}
.tt-row--d1 > .tt-label {
  color: var(--t2);
}
.tt-row--d2 > .tt-label,
.tt-row--d3 > .tt-label {
  font-size: 12px;
  color: var(--t3);
}

/* 当前所在标题 */
.tt-row.is-active {
  background: var(--accent-soft);
}
.tt-row.is-active > .tt-label {
  color: var(--accent-deep);
  font-weight: 600;
}
.tt-row.is-active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 3px;
  bottom: 3px;
  width: 2px;
  border-radius: 2px;
  background: var(--accent);
}
/* 折叠起来的那一节里正读着:三角标成主色,不必展开也知道自己在哪 */
.tt-row.is-trail > .tt-caret {
  color: var(--accent);
}
.tt-row.is-trail > .tt-label {
  color: var(--accent-deep);
}

/* 手机端(目录整屏页):触摸目标加大,长标题换行显示 */
@media (max-width: 900px) {
  .tt-kids {
    margin-left: 13px;
    padding-left: 7px;
  }
  .tt-caret {
    width: 30px;
    height: 42px;
  }
  .tt-label {
    font-size: 14.5px;
    padding: 11px 12px 11px 2px;
    white-space: normal;
    line-height: 1.6;
  }
  .tt-row--d0 > .tt-label {
    font-size: 15px;
  }
  .tt-row--d2 > .tt-label,
  .tt-row--d3 > .tt-label {
    font-size: 14px;
  }
}
</style>
