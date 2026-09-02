import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { errMsg } from '@/core/errmsg'
import { isMainWindow } from '@/core/window'
import { backend, type GitOpResult, type GitStatus, type RepoMeta, type TreeNode } from '@/core/backend'
import { sortTree } from '@/core/tree-sort'

export const useRepoStore = defineStore('repo', () => {
  const repos = ref<RepoMeta[]>([])
  /**
   * 当前文库 id。**同步**地先信 localStorage 里那条,不等 `init()` 校验完 ——
   * 有了它,「读上次那篇文档」就能和「扫整棵文件树」并行发出去,而不是排在树后面。
   * Android 上外置存储的 stat 慢一个量级,文库大一点这一等就是肉眼可见的白屏
   * (2026-09-02 用户反馈"启动打开上次文档明显有延迟")。
   * 万一这个 id 已经失效,`init()` 会立刻纠正,代价只是一次白跑的 IPC。
   */
  const currentRepoId = ref<string>((isMainWindow && localStorage.getItem('inkread:repo')) || '')
  const tree = ref<TreeNode[]>([])
  const status = ref<GitStatus | null>(null)
  const loading = ref(false)
  const pulling = ref(false)
  const error = ref('')

  /**
   * 当前文库是不是 git 仓库。普通文件夹文库(本地小说等)没有分支/变更/远端可言,
   * 同步相关的 UI 与启动自动拉取都要跳过 —— 不然只会一路弹"git 状态不可用"。
   * 文库列表还没回来时按 true 处理:免得启动瞬间 git 库的状态栏先闪一下"本地文库"。
   */
  const currentIsGit = computed(() => {
    const cur = repos.value.find((r) => r.id === currentRepoId.value)
    return cur ? cur.git : true
  })

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
    // 显示顺序统一在前端裁决(两个后端的排序规则不一致,见 tree-sort.ts)
    tree.value = sortTree(await backend.listTree(currentRepoId.value))
    refreshStatus()
  }

  async function refreshStatus() {
    // 普通文件夹文库不必去问 git,问了也只会拿到一个错误
    if (!currentIsGit.value) {
      status.value = null
      return
    }
    try {
      status.value = await backend.gitStatus(currentRepoId.value)
    } catch {
      status.value = null
    }
  }

  /** 返回 pull 结果消息;changed 时已刷新文件树 */
  async function pull(): Promise<GitOpResult> {
    if (!currentIsGit.value) {
      return { ok: false, changed: false, message: '当前文库是普通文件夹,没有 git 远端可拉取' }
    }
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

  return {
    repos, currentRepoId, currentIsGit, tree, status, loading, pulling, error,
    init, setCurrent, refresh, refreshStatus, pull, exists,
  }
})
