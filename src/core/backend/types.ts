export interface RepoMeta {
  id: string
  name: string
}

export interface TreeNode {
  name: string
  path: string
  type: 'dir' | 'file'
  ext?: string
  children?: TreeNode[]
}

export interface FileContent {
  content: string
  mtime: number
}

export interface GitStatus {
  branch: string
  dirtyCount: number
  dirtyFiles: string[]
  ahead: number
  behind: number
}

export interface GitOpResult {
  ok: boolean
  changed: boolean
  message: string
  /** push 被拒且 rebase 冲突,需要用户二选一 */
  conflict?: boolean
}

export interface SearchHit {
  path: string
  line: number
  preview: string
  nameMatch: boolean
}

/**
 * 前端唯一数据出口。
 * DevBackend(开发期,HTTP→Vite Node 中间件→系统 git/fs)
 * TauriBackend(打包后,invoke→Rust git2/fs)两实现同契约。
 */
export interface Backend {
  listRepos(): Promise<RepoMeta[]>
  listTree(repoId: string): Promise<TreeNode[]>
  readFile(repoId: string, path: string): Promise<FileContent>
  writeFile(repoId: string, path: string, content: string): Promise<void>
  /** 仓库内相对路径 → 可直接用于 <img src> 的 URL */
  assetUrl(repoId: string, path: string): string
  gitStatus(repoId: string): Promise<GitStatus>
  gitPull(repoId: string): Promise<GitOpResult>
  gitSync(repoId: string, message?: string): Promise<GitOpResult>
  /** 冲突解决:local=以本地为准,remote=以远端为准 */
  gitResolve(repoId: string, strategy: 'local' | 'remote'): Promise<GitOpResult>
  search(repoId: string, query: string): Promise<SearchHit[]>
  /** 外部链接用系统浏览器打开 */
  openExternal(url: string): Promise<void>
  /** 桌面端:把本地已有 git 仓库加入文库 */
  addRepoLocal(path: string): Promise<RepoMeta>
  /** 克隆远程仓库(HTTPS;私有仓库带 token,token 按 host 保存供后续 pull/push 复用) */
  addRepoClone(url: string, token?: string): Promise<RepoMeta>
}
