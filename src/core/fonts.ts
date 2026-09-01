/**
 * 正文字体:本机系统字体探测 + 已下载字体的 @font-face 注入。
 *
 * 为什么要"探测"而不是"枚举":WebView 里没有可用的全量字体枚举 API ——
 * `queryLocalFonts()` 只有桌面 Chromium 有、要权限提示,且 Android WebView 完全不支持;
 * `document.fonts.check()` 对系统字体恒返回 true,判断不了存在与否。
 * 能跨两端用的只有 canvas 实测:量同一串字在「候选字体, 兜底字体」下的宽度,
 * 与纯兜底字体一比,宽度不同就说明这台机器上真有这个字体。
 */

/**
 * 两条探测线,缺一不可(2026-09-01 实测定的):
 *
 * - **拉丁串量宽度**。只量汉字是行不通的 —— 汉字在几乎所有中文字体里都是等宽 1em,
 *   `墨阅汉字测试` 在微软雅黑/宋体/楷体/不存在的字体下宽度一律是 6×72=432,完全没有信号。
 *   拉丁字形的步进宽度才因字体而异(实测微软雅黑 864 / 霞鹜文楷 761 / 等线 774,兜底 540)。
 * - **汉字量字形包围盒**(actualBoundingBoxAscent / Descent)。有些中文字体的拉丁部分会回退到
 *   兜底字体,宽度就没差别了(实测宋体/楷体/仿宋的拉丁宽度都等于 monospace 兜底);
 *   但它们的汉字字形高度各不相同,包围盒能把它们区分出来。
 *
 * 两条任一有差异即判定存在。老浏览器没有包围盒字段时该项恒为 0,自动退化成纯宽度判定。
 */
const LATIN_PROBE = 'mmmmmmmmmmlliWQ'
const HAN_PROBE = '墨阅汉字'
const PROBE_SIZE = '72px'
/**
 * 三种兜底各测一次,任一不同即判定存在。
 * 必须测三种:Chrome/Windows 下 `monospace` 的汉字兜底就是宋体本身,
 * 只拿 monospace 当基线的话宋体永远测不出来,靠 sans-serif(兜底是微软雅黑)才分得开。
 */
const BASES = ['monospace', 'sans-serif', 'serif'] as const

export type FontGroup = 'sans' | 'serif' | 'kai' | 'mono'

export interface FontCandidate {
  label: string
  /** 同一款字体的不同叫法(中文名 / 英文名 / 各家族命名),命中任一即可 */
  aliases: string[]
  group: FontGroup
}

export interface DetectedFont {
  label: string
  /** 实际命中的那个 family 名,直接可写进 CSS */
  family: string
  group: FontGroup
}

/**
 * 候选表。只列"装了就适合拿来读长文"的字体,不追求穷举 ——
 * 表外的字体走设置页的「自定义字体名」输入框,那里同样过下面这套实测校验。
 */
const CANDIDATES: FontCandidate[] = [
  // 黑体
  { label: '微软雅黑', aliases: ['Microsoft YaHei', '微软雅黑'], group: 'sans' },
  { label: '等线', aliases: ['DengXian', '等线'], group: 'sans' },
  { label: '黑体', aliases: ['SimHei', '黑体'], group: 'sans' },
  { label: '思源黑体', aliases: ['Source Han Sans SC', 'Noto Sans SC', 'Noto Sans CJK SC'], group: 'sans' },
  { label: '苹方', aliases: ['PingFang SC'], group: 'sans' },
  { label: 'HarmonyOS Sans', aliases: ['HarmonyOS Sans SC', 'HarmonyOS Sans'], group: 'sans' },
  { label: 'MiSans', aliases: ['MiSans'], group: 'sans' },
  { label: 'OPPO Sans', aliases: ['OPPO Sans', 'OplusSans'], group: 'sans' },
  { label: '阿里巴巴普惠体', aliases: ['Alibaba PuHuiTi', 'Alibaba PuHuiTi 3.0'], group: 'sans' },
  { label: '更纱黑体', aliases: ['Sarasa Gothic SC', 'Sarasa UI SC'], group: 'sans' },
  // 宋体 / 衬线
  { label: '宋体', aliases: ['SimSun', '宋体'], group: 'serif' },
  { label: '新宋体', aliases: ['NSimSun', '新宋体'], group: 'serif' },
  { label: '思源宋体', aliases: ['Source Han Serif SC', 'Noto Serif SC', 'Noto Serif CJK SC'], group: 'serif' },
  { label: '华文中宋', aliases: ['STZhongsong', '华文中宋'], group: 'serif' },
  { label: 'Georgia', aliases: ['Georgia'], group: 'serif' },
  { label: 'Cambria', aliases: ['Cambria'], group: 'serif' },
  { label: 'Constantia', aliases: ['Constantia'], group: 'serif' },
  // 楷体 / 仿宋
  { label: '楷体', aliases: ['KaiTi', '楷体'], group: 'kai' },
  { label: '华文楷体', aliases: ['STKaiti', '华文楷体'], group: 'kai' },
  { label: '仿宋', aliases: ['FangSong', '仿宋'], group: 'kai' },
  // 等宽
  { label: 'Cascadia Code', aliases: ['Cascadia Code', 'Cascadia Mono'], group: 'mono' },
  { label: 'Consolas', aliases: ['Consolas'], group: 'mono' },
  { label: 'JetBrains Mono', aliases: ['JetBrains Mono'], group: 'mono' },
  { label: '更纱等宽', aliases: ['Sarasa Mono SC'], group: 'mono' },
]

let ctx: CanvasRenderingContext2D | null = null

function context(): CanvasRenderingContext2D | null {
  if (!ctx) ctx = document.createElement('canvas').getContext('2d')
  return ctx
}

/** 一次测量的三个指标:步进宽度 + 字形包围盒上下沿 */
interface Metrics {
  w: number
  a: number
  d: number
}

function measure(font: string, probe: string): Metrics {
  const c = context()
  if (!c) return { w: 0, a: 0, d: 0 }
  c.font = font
  const m = c.measureText(probe)
  return { w: m.width, a: m.actualBoundingBoxAscent ?? 0, d: m.actualBoundingBoxDescent ?? 0 }
}

/** 兜底字体自身的指标,每种组合只量一次 */
const baseCache = new Map<string, Metrics>()

function baseline(base: string, probe: string): Metrics {
  const key = `${base}|${probe}`
  let m = baseCache.get(key)
  if (!m) {
    m = measure(`${PROBE_SIZE} ${base}`, probe)
    baseCache.set(key, m)
  }
  return m
}

const differs = (a: number, b: number): boolean => Math.abs(a - b) > 0.5

/** 这台设备上是否真装了该字体 */
export function hasFont(family: string): boolean {
  if (!family.trim()) return false
  return BASES.some((base) => {
    const font = `${PROBE_SIZE} "${family}", ${base}`
    // 字体缺失时整串回退到兜底,三个指标会与基线一模一样
    if (differs(measure(font, LATIN_PROBE).w, baseline(base, LATIN_PROBE).w)) return true
    const han = measure(font, HAN_PROBE)
    const hanBase = baseline(base, HAN_PROBE)
    return differs(han.a, hanBase.a) || differs(han.d, hanBase.d)
  })
}

/** 扫一遍候选表,只留这台设备上真实存在的(约 120 次 measureText,几毫秒) */
export function detectSystemFonts(): DetectedFont[] {
  const out: DetectedFont[] = []
  for (const c of CANDIDATES) {
    const family = c.aliases.find((a) => hasFont(a))
    if (family) out.push({ label: c.label, family, group: c.group })
  }
  return out
}

/**
 * 反查「系统默认」此刻实际落在哪个字体上。
 *
 * 做法是量出当前 --font-sans 整条链渲染这串字的宽度,再拿探测到的字体逐个比对。
 * 属于启发式:两款度量恰好相同的字体分不开,分不出来就返回空,UI 那边只显示「系统默认」。
 */
export function guessSystemFont(detected: DetectedFont[]): string {
  const chain = getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim()
  if (!chain) return ''
  const sig = (font: string): string => {
    const l = measure(font, LATIN_PROBE)
    const h = measure(font, HAN_PROBE)
    return [l.w, h.a, h.d].map((n) => n.toFixed(1)).join('/')
  }
  const target = sig(`${PROBE_SIZE} ${chain}`)
  return detected.find((f) => sig(`${PROBE_SIZE} "${f.family}"`) === target)?.label ?? ''
}

// ---- 已下载字体的 @font-face 注入 ----

const STYLE_ID = 'inkread-font-faces'

/**
 * 把已安装的扩展字体登记成 @font-face。
 * 字体文件不经 IPC 传,而是由 Rust 侧注册的 inkfont 协议直接从磁盘流式返回 ——
 * 10MB 字体转 base64 过 IPC 约 13MB 字符串,每次启动都来一遍会把启动卡死。
 */
export function registerFontFaces(fonts: { id: string; family: string }[], urlOf: (id: string) => string): void {
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = STYLE_ID
    document.head.appendChild(el)
  }
  el.textContent = fonts
    .map(
      (f) => `@font-face{font-family:"${f.family}";src:url("${urlOf(f.id)}");font-display:swap;}`,
    )
    .join('\n')
}
