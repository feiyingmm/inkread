import { onBeforeUnmount, ref, type Ref } from 'vue'

/** 进入热区后多久浮出:短到跟手,又足够滤掉「鼠标横穿窗口边缘」的误触发 */
const SHOW_DELAY = 120
/** 指针离开浮层后多久收起:容忍热区与浮层之间那段 shell 留白的穿越 */
const HIDE_DELAY = 220
/** 去留判定的轮询间隔 */
const POLL = 100
/** 热区宽度,与 app.css 里 .edge-hot 的 width 保持一致 */
const HOT_W = 10

/** 收起瞬间抑制宽度过渡的时长,给浏览器几帧把 width:0 落定 */
const SNAP_MS = 60

export interface EdgePeek {
  /** 是否浮出 */
  active: Ref<boolean>
  /**
   * 收起的那一刻为真,用来给面板挂上「本次宽度变化不要过渡」的类。
   *
   * 收起时面板要同时做两件事:摘掉绝对定位回到网格流、宽度 264 → 0。
   * 若让这次宽度变化走 .side 自带的 0.2s 过渡,它会以「在网格流里的 264px」
   * 起步 —— 正文当场被推开 264px,再花 200ms 滑回来,比不做动画难看得多。
   * 浮出时不需要抑制:那会儿面板是绝对定位的,宽度怎么动都不碰正文。
   */
  snap: Ref<boolean>
  /** 绑到热区的 mouseenter */
  arm: (e: MouseEvent) => void
  /** 立即收起(钉住 / 切到窄屏 / 大纲变空 / 卸载) */
  close: () => void
}

/**
 * 边缘悬浮浮层的显隐判定。
 *
 * 去留用「指针坐标 + 元素矩形」判断,而不是浮层上的 mouseenter / mouseleave —— 事件流在这里会骗人:
 * - 文件树右键菜单的遮罩是全屏 fixed 元素,一出现浮层立刻收到 mouseleave,不加处理就当场消失
 * - 遮罩撤掉时,指针若没动,浏览器不保证补发 mouseover,靠事件就永远等不到「回到浮层内」
 * - 指针停着不动时压根没有事件可依
 *
 * 矩形判定不受遮罩影响,也不需要指针移动,上面三种情况都自然成立。
 *
 * @param panelEl 取浮层根元素(浮出后才存在,所以传函数而不是元素)
 * @param edge    贴哪一侧
 * @param locked  为真时挂起收起判定 —— 浮层内拉起的菜单还开着,不能把它脚下的浮层收走
 */
export function useEdgePeek(
  panelEl: () => HTMLElement | null | undefined,
  edge: 'left' | 'right',
  locked: () => boolean = () => false,
): EdgePeek {
  const active = ref(false)
  const snap = ref(false)
  let showTimer = 0
  let snapTimer = 0
  let poll = 0
  let px = -1
  let py = -1
  let lastInside = 0

  function onMove(e: MouseEvent): void {
    px = e.clientX
    py = e.clientY
  }

  function detachMove(): void {
    window.removeEventListener('mousemove', onMove)
  }

  /** 指针是否还贴在窗口边缘那 10px 里 */
  function inHotStrip(): boolean {
    if (px < 0) return false
    return edge === 'left' ? px <= HOT_W : px >= window.innerWidth - HOT_W
  }

  function inside(): boolean {
    // 指针停在热区里还没挪进浮层时不该被收掉
    if (inHotStrip()) return true
    const el = panelEl()
    if (!el) return false
    const r = el.getBoundingClientRect()
    return px >= r.left && px <= r.right && py >= r.top && py <= r.bottom
  }

  function tick(): void {
    if (locked() || inside()) {
      lastInside = Date.now()
      return
    }
    if (Date.now() - lastInside >= HIDE_DELAY) close()
  }

  function open(): void {
    window.clearTimeout(snapTimer)
    snapTimer = 0
    snap.value = false
    if (active.value) return
    active.value = true
    lastInside = Date.now()
    poll = window.setInterval(tick, POLL)
  }

  function close(): void {
    window.clearTimeout(showTimer)
    showTimer = 0
    window.clearInterval(poll)
    poll = 0
    detachMove()
    if (!active.value) return
    // snap 与 active 在同一个 tick 里落到 DOM:摘绝对定位、去宽度、禁过渡一起发生
    active.value = false
    snap.value = true
    window.clearTimeout(snapTimer)
    snapTimer = window.setTimeout(() => {
      snapTimer = 0
      snap.value = false
    }, SNAP_MS)
  }

  function arm(e: MouseEvent): void {
    if (active.value || showTimer) return
    // 从触发事件里取初始坐标:用户把鼠标甩到边缘后一动不动时,
    // 后面不会再有 mousemove,没有这一步 inside() 会误判为「已离开」
    px = e.clientX
    py = e.clientY
    window.addEventListener('mousemove', onMove, { passive: true })
    showTimer = window.setTimeout(() => {
      showTimer = 0
      // 延时窗口内指针已经挪走了就不浮出(这也顺带免掉了热区的 mouseleave 处理)
      if (inHotStrip()) open()
      else detachMove()
    }, SHOW_DELAY)
  }

  onBeforeUnmount(() => {
    close()
    window.clearTimeout(snapTimer)
    snapTimer = 0
    snap.value = false
  })

  return { active, snap, arm, close }
}
