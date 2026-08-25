import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

export type Brand = 'ink' | 'violet'
export type Mode = 'auto' | 'light' | 'dark'
export type ReadWidth = 'book' | 'wide'
export type Paper = 'default' | 'sepia' | 'green'

const KEY = 'inkread:settings'

interface Persisted {
  brand: Brand
  mode: Mode
  width: ReadWidth
  fontSize: number
  serifBody: boolean
  autoPull: boolean
  autoSave: boolean
  paper: Paper
}

function load(): Partial<Persisted> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Persisted>
  } catch {
    return {}
  }
}

export const useSettings = defineStore('settings', () => {
  const saved = load()
  const brand = ref<Brand>(saved.brand ?? 'ink')
  const mode = ref<Mode>(saved.mode ?? 'auto')
  const width = ref<ReadWidth>(saved.width ?? 'book')
  const fontSize = ref<number>(saved.fontSize ?? 16)
  const serifBody = ref<boolean>(saved.serifBody ?? false)
  const autoPull = ref<boolean>(saved.autoPull ?? true)
  const autoSave = ref<boolean>(saved.autoSave ?? false)
  const paper = ref<Paper>(saved.paper ?? 'default')

  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const sysDark = ref(media.matches)
  media.addEventListener('change', (e) => (sysDark.value = e.matches))

  const isDark = computed(() => mode.value === 'dark' || (mode.value === 'auto' && sysDark.value))

  watch(
    [brand, mode, width, fontSize, serifBody, autoPull, autoSave, paper],
    () => {
      const data: Persisted = {
        brand: brand.value,
        mode: mode.value,
        width: width.value,
        fontSize: fontSize.value,
        serifBody: serifBody.value,
        autoPull: autoPull.value,
        autoSave: autoSave.value,
        paper: paper.value,
      }
      localStorage.setItem(KEY, JSON.stringify(data))
    },
    { deep: false },
  )

  return { brand, mode, width, fontSize, serifBody, autoPull, autoSave, paper, isDark }
})
