import { isTauri } from '@/core/backend'

export const isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)

/**
 * 是否真的拿到了 Android「所有文件访问」(MANAGE_EXTERNAL_STORAGE)。
 *
 * 后端不再用「能不能列目录」判断——那是假阳性:Android 11+ 任何应用都列得出共享存储的
 * 目录名,却读不到里面的文件、也写不进去。现在是往共享存储写一个探针文件再删掉,
 * 写得进去才算数。详见 Rust 侧 `check_storage_access`。
 */
export async function checkStorageAccess(): Promise<boolean> {
  if (!isTauri || !isAndroid) return true
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<boolean>('check_storage_access')
  } catch {
    // 探测本身失败(理论上不会)时不拦路,交给后续真实操作报错
    return true
  }
}

/** 拉起系统的「所有文件访问」授权页 */
export async function requestStorageAccess(): Promise<void> {
  if (!isTauri || !isAndroid) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('request_storage_access')
}

const ASKED_KEY = 'inkread:storage-perm-asked'

/** 首次启动是否还没主动问过(问过一次就不再自动弹,设置里可随时手动开) */
export function shouldPromptOnLaunch(): boolean {
  return localStorage.getItem(ASKED_KEY) !== '1'
}

export function markPrompted(): void {
  localStorage.setItem(ASKED_KEY, '1')
}
