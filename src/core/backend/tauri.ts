import type { Backend } from './types'

/** M4 里程碑实现:invoke Rust 命令(git2/fs/搜索/keyring),与 DevBackend 同契约 */
export const tauriBackend: Backend = new Proxy({} as Backend, {
  get(_t, prop) {
    throw new Error(`TauriBackend.${String(prop)} 尚未实现(M4 里程碑)`)
  },
})
