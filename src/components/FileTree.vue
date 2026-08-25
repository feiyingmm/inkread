<template>
  <div>
    <template v-for="n in nodes" :key="n.path">
      <div class="tree-item">
        <div
          class="tree-row"
          :class="{ 'is-dir': n.type === 'dir', 'is-active': n.path === current }"
          @click="onClick(n)"
        >
          <span v-if="n.type === 'dir'" class="tw" :class="{ 'is-open': open[n.path] }">▶</span>
          <span v-else class="tw">·</span>
          <span class="tname">{{ label(n) }}</span>
        </div>
        <div v-if="n.type === 'dir' && open[n.path]" class="tree-children">
          <FileTree
            :nodes="n.children ?? []"
            :current="current"
            :reveal="reveal"
            :depth="depth + 1"
            @open="emit('open', $event)"
          />
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { reactive, watch } from 'vue'
import type { TreeNode } from '@/core/backend'

const props = withDefaults(
  defineProps<{
    nodes: TreeNode[]
    current: string
    reveal?: string
    depth?: number
  }>(),
  { depth: 0, reveal: '' },
)

const emit = defineEmits<{ open: [node: TreeNode] }>()

const open = reactive<Record<string, boolean>>({})

// 当前文档 / 外部定位请求(面包屑点击)变化时自动展开祖先目录(每层组件只负责自己这层)
watch(
  () => props.reveal || props.current,
  (cur) => {
    if (!cur) return
    for (const n of props.nodes) {
      if (n.type === 'dir' && (cur === n.path || cur.startsWith(n.path + '/'))) open[n.path] = true
    }
  },
  { immediate: true },
)

function label(n: TreeNode): string {
  if (n.type === 'file' && (n.ext === 'md' || n.ext === 'markdown')) {
    return n.name.replace(/\.(md|markdown)$/i, '')
  }
  return n.name
}

function onClick(n: TreeNode): void {
  if (n.type === 'dir') {
    open[n.path] = !open[n.path]
  } else {
    emit('open', n)
  }
}
</script>
