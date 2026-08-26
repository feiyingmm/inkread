<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    :class="{ 'icon-spin': spin }"
    aria-hidden="true"
  >
    <path v-for="(d, i) in def.paths" :key="i" :d="d" />
    <path v-for="(d, i) in def.fills ?? []" :key="'f' + i" :d="d" fill="currentColor" stroke="none" />
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    name: string
    size?: number
    spin?: boolean
  }>(),
  { size: 18, spin: false },
)

interface IconDef {
  paths: string[]
  fills?: string[]
}

const ICONS: Record<string, IconDef> = {
  menu: { paths: ['M3 6h18', 'M3 12h18', 'M3 18h18'] },
  back: { paths: ['M19 12H5', 'M12 19l-7-7 7-7'] },
  forward: { paths: ['M5 12h14', 'M12 5l7 7-7 7'] },
  search: { paths: ['M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14z', 'M21 21l-4.35-4.35'] },
  refresh: { paths: ['M21 8a9 9 0 1 0 .49 4', 'M21 3v5h-5'] },
  sun: {
    paths: [
      'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z',
      'M12 2v2', 'M12 20v2', 'M2 12h2', 'M20 12h2',
      'M4.9 4.9l1.4 1.4', 'M17.7 17.7l1.4 1.4', 'M4.9 19.1l1.4-1.4', 'M17.7 6.3l1.4-1.4',
    ],
  },
  moon: { paths: ['M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z'] },
  'theme-auto': {
    paths: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z'],
    fills: ['M12 5a7 7 0 0 1 0 14z'],
  },
  toc: { paths: ['M9 6h12', 'M9 12h12', 'M9 18h12', 'M3.5 6h2', 'M3.5 12h2', 'M3.5 18h2'] },
  sliders: {
    paths: [
      'M5 21v-6', 'M5 11V3', 'M12 21v-8', 'M12 9V3', 'M19 21v-4', 'M19 13V3',
      'M2.5 15h5', 'M9.5 13h5', 'M16.5 17h5',
    ],
  },
  /** 通用齿轮:设置入口用它,比滑杆(sliders)更符合大众认知 */
  gear: {
    paths: [
      'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
      'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
    ],
  },
  /** 在新窗口打开 */
  external: {
    paths: ['M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6', 'M15 3h6v6', 'M10 14L21 3'],
  },
  save: {
    paths: [
      'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z',
      'M17 21v-8H7v8',
      'M7 3v5h8',
    ],
  },
  code: { paths: ['M16 18l6-6-6-6', 'M8 6l-6 6 6 6'] },
  export: { paths: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'] },
  width: { paths: ['M3 12h18', 'M8 7l-5 5 5 5', 'M16 7l5 5-5 5'] },
  folder: { paths: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'] },
  up: { paths: ['M12 19V5', 'M5 12l7-7 7 7'] },
  close: { paths: ['M18 6L6 18', 'M6 6l12 12'] },
  plus: { paths: ['M12 5v14', 'M5 12h14'] },
  download: { paths: ['M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2', 'M7 11l5 5 5-5', 'M12 16V4'] },
  doc: { paths: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5'] },
  'doc-plus': {
    paths: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5', 'M12 12v6', 'M9 15h6'],
  },
  'folder-plus': {
    paths: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M12 10.5v5', 'M9.5 13h5'],
  },
  trash: {
    paths: ['M3 6h18', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M10 11v6', 'M14 11v6'],
  },
  undo: { paths: ['M2 4v6h6', 'M4.5 15a9 9 0 1 0 2.13-9.36L2 10'] },
  rename: { paths: ['M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z'] },
  'chevron-up': { paths: ['M6 15l6-6 6 6'] },
  'chevron-down': { paths: ['M6 9l6 6 6-6'] },
  'chevron-right': { paths: ['M9 6l6 6-6 6'] },
  'arrow-down-sm': { paths: ['M12 5v14', 'M6 13l6 6 6-6'] },
  'arrow-up-sm': { paths: ['M12 19V5', 'M6 11l6-6 6 6'] },
  branch: {
    paths: ['M6 9v6', 'M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M18 9a9 9 0 0 1-9 9'] ,
  },
  check: { paths: ['M20 6L9 17l-5-5'] },
  key: {
    paths: ['M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4'],
  },
  info: { paths: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 16v-4', 'M12 8h.01'] },
  help: { paths: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3', 'M12 17h.01'] },
  book: { paths: ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z'] },
  palette: {
    paths: [
      'M12 3a9 9 0 1 0 0 18h.7a2.3 2.3 0 0 0 1.7-3.84 2.3 2.3 0 0 1 1.7-3.86H18a4 4 0 0 0 4-4c0-3.5-4.5-6.3-10-6.3z',
      'M7.5 10.5h.01', 'M12 7.5h.01', 'M16.5 10.5h.01',
    ],
  },
}

const def = computed<IconDef>(() => ICONS[props.name] ?? { paths: [] })
</script>

<style scoped>
svg {
  display: block;
  flex-shrink: 0;
}
.icon-spin {
  animation: icon-spin 0.9s linear infinite;
}
@keyframes icon-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
