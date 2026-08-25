import type { Backend } from './types'
import { devBackend } from './dev'
import { tauriBackend } from './tauri'

declare global {
  interface Window {
    __TAURI__?: unknown
    __TAURI_INTERNALS__?: unknown
  }
}

export const isTauri = typeof window !== 'undefined' && (!!window.__TAURI__ || !!window.__TAURI_INTERNALS__)

export const backend: Backend = isTauri ? tauriBackend : devBackend

export * from './types'
