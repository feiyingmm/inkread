import { isTauri } from '@/core/backend'

/**
 * 窗口身份。桌面端支持多窗口(单进程多 WebviewWindow),主窗口 label 固定为 `main`,
 * 「以新窗口打开」开出来的是 `w1`/`w2`…
 *
 * 为什么要区分:localStorage 在同一进程的所有窗口间共享,`inkread:repo`(当前文库)
 * 若每个窗口都写,后开的窗口会把先前窗口的选择覆盖掉。约定**只有主窗口**读写这个
 * 全局键(从而保留"冷启动回到上次文库"的行为),副窗口的当前文库只活在内存里。
 * 其余键(最近打开、栏宽、滚动位置)共享反而是想要的,不做隔离。
 */
export const windowLabel: string = (() => {
  if (!isTauri) return 'main'
  try {
    // 由 Tauri 注入;拿不到就按主窗口处理(退化后行为与改造前一致)
    const w = (window as unknown as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } })
      .__TAURI_INTERNALS__
    return w?.metadata?.currentWindow?.label ?? 'main'
  } catch {
    return 'main'
  }
})()

export const isMainWindow = windowLabel === 'main'
