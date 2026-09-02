/**
 * 字体下载任务表。
 *
 * 为什么不放在设置面板里:面板是 `v-if` 挂的,一关就整个销毁 —— 而下载真正跑在 Rust 线程上,
 * 面板销毁它照样在下。旧实现把「进度 + 事件监听」都挂在组件内,于是关掉面板等于:
 * 进度表清空、`font-progress` 监听被 unlisten、下载按钮重新露出来;用户再点一次就变成
 * **同一款字体两个下载线程**,两边都往同一个 `<id>.part` 写、都 emit 进度,表现为
 * 「进度一会大一会小」,最后先跑完的那个把 .part rename 走,另一个回读时报
 * 「回读字体文件失败:系统找不到指定的文件。(os error 2)」(2026-09-02 用户反馈)。
 *
 * 所以任务状态必须活在组件之外:进度表和监听都只有一份,面板开开关关只是"接上看一眼"。
 * Rust 侧另有一道同 id 互斥兜底(fonts.rs 的 inflight),两边都拦住才算稳。
 */

import { reactive } from 'vue'
import { backend, isTauri, type FontMeta } from '@/core/backend'
import { errMsg } from '@/core/errmsg'
import { registerFontFaces } from '@/core/fonts'
import { toast } from '@/core/toast'

/** 字体 id → 下载百分比(0~99);键不存在即"没有在下的任务" */
export const fontProgress = reactive<Record<string, number>>({})

let listening = false

/** 全局只监听一次,且**永不** unlisten —— 面板关了下载还在跑,进度得继续记着 */
async function ensureListener(): Promise<void> {
  if (listening || !isTauri) return
  listening = true
  try {
    await backend.onFontProgress((p) => {
      // 任务已结束(装完/失败/被删)之后的迟到事件不要再把条目复活
      if (fontProgress[p.id] === undefined) return
      fontProgress[p.id] = p.total > 0 ? Math.min(99, Math.floor((p.received / p.total) * 100)) : 0
    })
  } catch {
    listening = false
  }
}

/**
 * 下载并安装一款字体。同一 id 已在下载中则直接忽略(重复点击、关了面板再点都走这条)。
 * 安装成功后立刻重登记 @font-face,面板已经关掉也一样生效。
 */
export async function installFont(meta: FontMeta): Promise<void> {
  if (fontProgress[meta.id] !== undefined) return
  fontProgress[meta.id] = 0
  await ensureListener()
  try {
    await backend.fontInstall(meta)
    const list = await backend.fontInstalled()
    registerFontFaces(list, backend.fontUrl)
    toast(`已安装 ${meta.name}`)
  } catch (e) {
    toast(errMsg(e), true)
  } finally {
    delete fontProgress[meta.id]
  }
}
