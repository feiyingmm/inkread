import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue'
import { isTauri } from '@/core/backend'

/**
 * 手机端「返回」的统一出口。
 *
 * 背景:Tauri v2 的内置 app 插件把系统返回键/返回手势默认映射成 `webView.goBack()` ——
 * 弹层(设置、对话框、文库抽屉、目录)不在浏览历史里,于是按返回它们纹丝不动,
 * 反而把阅读历史退掉一格,再按一下整个应用就退到后台了(0.3.3 真机实测)。
 *
 * 解法:注册 `onBackButtonPress` 接管返回键。**一旦注册,原生侧就完全不再自作主张**
 * (AppPlugin 里 `hasListener` 为真时只发事件),所以退出行为也得我们自己补上。
 * 优先级:关掉最上面一层 → 有阅读历史就后退 → 都没有则收到后台(不是杀进程)。
 *
 * 层的登记与注销由各弹层组件自己在 mount/unmount 时完成,顺序天然就是打开顺序;
 * 桌面端同一套栈供 Esc 使用,两端行为一致。
 */

interface Layer {
  id: number
  close: () => void
}

const layers: Layer[] = []
let seq = 0

export function pushLayer(close: () => void): number {
  const id = ++seq
  layers.push({ id, close })
  return id
}

export function removeLayer(id: number): void {
  const i = layers.findIndex((l) => l.id === id)
  if (i >= 0) layers.splice(i, 1)
}

/** 关掉最上面一层;返回是否真的关掉了一层 */
export function popLayer(): boolean {
  const top = layers.pop()
  if (!top) return false
  top.close()
  return true
}

export function hasLayer(): boolean {
  return layers.length > 0
}

/** 组件存在期间占住一层(弹层组件用 v-if 挂载/卸载,正好对应打开/关闭) */
export function useBackLayer(close: () => void): void {
  let id = 0
  onMounted(() => {
    id = pushLayer(close)
  })
  onBeforeUnmount(() => {
    if (id) removeLayer(id)
  })
}

/**
 * 条件成立期间占住一层(用于同一组件内的二级页、抽屉等不靠挂载切换的层)。
 *
 * 初始状态在 `onMounted` 里判定而不是 `watch` 的 immediate —— 子组件的 onMounted
 * 先于父组件执行,这样父组件里的二级页层才会正确压在子组件(MobilePage)那一层**之上**,
 * 返回时先退二级页、再退整页。
 */
export function useBackLayerWhen(active: Ref<boolean>, close: () => void): void {
  let id = 0
  const sync = (on: boolean): void => {
    if (on && !id) {
      id = pushLayer(close)
    } else if (!on && id) {
      removeLayer(id)
      id = 0
    }
  }
  onMounted(() => sync(active.value))
  watch(active, sync)
  onBeforeUnmount(() => {
    if (id) removeLayer(id)
  })
}

const isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)

/** 接管 Android 返回键;非 Android 直接跳过。整个应用只调一次。 */
export async function installAndroidBackHandler(): Promise<void> {
  if (!isTauri || !isAndroid) return
  try {
    const { onBackButtonPress } = await import('@tauri-apps/api/app')
    await onBackButtonPress(({ canGoBack }) => {
      if (popLayer()) return
      if (canGoBack) {
        window.history.back()
        return
      }
      void import('@tauri-apps/api/core').then(({ invoke }) => invoke('minimize_app')).catch(() => {})
    })
  } catch (e) {
    // 接管失败就退回原生默认行为(返回=后退/退出),不影响可用性
    console.warn('[inkread] 返回键接管失败', e)
  }
}
