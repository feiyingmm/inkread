import { defineStore } from 'pinia'
import { ref } from 'vue'
import { errMsg } from '@/core/errmsg'
import { isMainWindow } from '@/core/window'
import { backend, type GitOpResult, type GitStatus, type RepoMeta, type TreeNode } from '@/core/backend'

export const useRepoStore = defineStore('repo', () => {
  const repos = ref<RepoMeta[]>([])
  const currentRepoId = ref<string>('')
  const tree = ref<TreeNode[]>([])
  const status = ref<GitStatus | null>(null)
  const loading = ref(false)
  const pulling = ref(false)
  const error = ref('')

  async function init() {
    loading.value = true
    error.value = ''
    try {
      repos.value = await backend.listRepos()
      // 只有主窗口跟随"上次打开的文库";副窗口由 WindowTarget 指定,不读全局键,
      // 否则多窗口会互相把当前文库改掉(localStorage 在同进程所有窗口间共享)
      const saved = isMainWindow ? localStorage.getItem('inkread:repo') : null
      if (saved && repos.value.some((r) => r.id === saved)) {
        currentRepoId.value = saved
      } else if (!repos.value.some((r) => r.id === currentRepoId.value)) {
        currentRepoId.value = repos.value[0]?.id ?? ''
      }
      if (currentRepoId.value) await refresh()
    } catch (e) {
      error.value = errMsg(e)
    } finally {
      loading.value = false
    }
  }

  /** 切换当前仓库并刷新文件树 */
  async function setCurrent(id: string) {
    if (id === currentRepoId.value) return
    currentRepoId.value = id
    if (isMainWindow) localStorage.setItem('inkread:repo', id)
    tree.value = []
    status.value = null
    await refresh()
  }

  async function refresh() {
    tree.value = await backend.listTree(currentRepoId.value)
    refreshStatus()
  }

  async function refreshStatus() {
    try {
      status.value = await backend.gitStatus(currentRepoId.value)
    } catch {
      status.value = null
    }
  }

  /** 返回 pull 结果消息;changed 时已刷新文件树 */
  async function pull(): Promise<GitOpResult> {
    pulling.value = true
    try {
      const r = await backend.gitPull(currentRepoId.value)
      if (r.changed) await refresh()
      else refreshStatus()
      return r
    } catch (e) {
      return { ok: false, changed: false, message: errMsg(e) }
    } finally {
      pulling.value = false
    }
  }

  /** 在树中查找路径对应节点是否存在 */
  function exists(path: string): boolean {
    function walk(nodes: TreeNode[]): boolean {
      for (const n of nodes) {
        if (n.path === path) return true
        if (n.type === 'dir' && n.children && path.startsWith(n.path + '/') && walk(n.children)) return true
      }
      return false
    }
    return walk(tree.value)
  }

  return { repos, currentRepoId, tree, status, loading, pulling, error, init, setCurrent, refresh, refreshStatus, pull, exists }
})
