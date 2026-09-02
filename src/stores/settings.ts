import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

export type Brand = 'ink' | 'violet' | 'forest' | 'amber' | 'rose' | 'slate'
export type Mode = 'auto' | 'light' | 'dark'
export type ReadWidth = 'book' | 'wide'
/** 纸色按明暗分开记忆,否则切一次明暗另一边的选择就被覆盖了 */
export type PaperLight = 'default' | 'sepia' | 'green' | 'ivory'
export type PaperDark = 'default' | 'warm' | 'black'

const KEY = 'inkread:settings'

/** 排版默认值 = v0.4.0 写死在 reading.css 里的实际取值,升级后正文一个像素都不动 */
export const TYPO_DEFAULT = {
  lineHeight: 1.78,
  paraGap: 0.85,
  letterSpacing: 0,
  indent: false,
} as const

/** 「书籍式排版」一键预设:缩进和大段距只该留一个 */
export const TYPO_BOOK = {
  lineHeight: 1.9,
  paraGap: 0.2,
  letterSpacing: 0,
  indent: true,
} as const

interface Persisted {
  brand: Brand
  mode: Mode
  width: ReadWidth
  fontSize: number
  /** 正文字体的 font-family 名;空串 = 跟随系统(--font-sans) */
  bodyFont: string
  lineHeight: number
  paraGap: number
  letterSpacing: number
  indent: boolean
  autoPull: boolean
  autoSave: boolean
  paperLight: PaperLight
  paperDark: PaperDark
  /** 桌面端:点关闭按钮是收进系统托盘(true)还是退出程序(false,默认,与旧版一致) */
  closeToTray: boolean
}

/** v0.4.0 及更早的存档形态,只在迁移时用到 */
interface Legacy {
  serifBody?: boolean
  paper?: PaperLight
}

function load(): Partial<Persisted> & Legacy {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Persisted> & Legacy
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
  const autoPull = ref<boolean>(saved.autoPull ?? true)
  const autoSave = ref<boolean>(saved.autoSave ?? false)
  const closeToTray = ref<boolean>(saved.closeToTray ?? false)

  // ---- 旧字段迁移(只在旧存档里还有对应键时才生效,迁完写回新键) ----
  // serifBody 是个二选一开关,现在并入 bodyFont 这个自由字体名
  const bodyFont = ref<string>(saved.bodyFont ?? (saved.serifBody ? 'LXGW WenKai Screen' : ''))
  // paper 原先只管浅色,原样落到 paperLight
  const paperLight = ref<PaperLight>(saved.paperLight ?? saved.paper ?? 'default')
  const paperDark = ref<PaperDark>(saved.paperDark ?? 'default')

  const lineHeight = ref<number>(saved.lineHeight ?? TYPO_DEFAULT.lineHeight)
  const paraGap = ref<number>(saved.paraGap ?? TYPO_DEFAULT.paraGap)
  const letterSpacing = ref<number>(saved.letterSpacing ?? TYPO_DEFAULT.letterSpacing)
  const indent = ref<boolean>(saved.indent ?? TYPO_DEFAULT.indent)

  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const sysDark = ref(media.matches)
  media.addEventListener('change', (e) => (sysDark.value = e.matches))

  const isDark = computed(() => mode.value === 'dark' || (mode.value === 'auto' && sysDark.value))
  /** 当前明暗下生效的那一档纸色 */
  const paper = computed(() => (isDark.value ? paperDark.value : paperLight.value))

  function applyTypo(preset: { lineHeight: number; paraGap: number; letterSpacing: number; indent: boolean }): void {
    lineHeight.value = preset.lineHeight
    paraGap.value = preset.paraGap
    letterSpacing.value = preset.letterSpacing
    indent.value = preset.indent
  }

  watch(
    [
      brand, mode, width, fontSize, bodyFont, lineHeight, paraGap, letterSpacing,
      indent, autoPull, autoSave, paperLight, paperDark, closeToTray,
    ],
    () => {
      const data: Persisted = {
        brand: brand.value,
        mode: mode.value,
        width: width.value,
        fontSize: fontSize.value,
        bodyFont: bodyFont.value,
        lineHeight: lineHeight.value,
        paraGap: paraGap.value,
        letterSpacing: letterSpacing.value,
        indent: indent.value,
        autoPull: autoPull.value,
        autoSave: autoSave.value,
        paperLight: paperLight.value,
        paperDark: paperDark.value,
        closeToTray: closeToTray.value,
      }
      localStorage.setItem(KEY, JSON.stringify(data))
    },
    { deep: false },
  )

  return {
    brand, mode, width, fontSize, bodyFont,
    lineHeight, paraGap, letterSpacing, indent,
    autoPull, autoSave, paperLight, paperDark, closeToTray,
    isDark, paper, applyTypo,
  }
})
