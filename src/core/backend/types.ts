export interface RepoMeta {
  id: string
  name: string
}

/** 新窗口开机要打开什么:file(绝对路径,文件关联/命令行)与 repo+doc(应用内)二选一 */
export interface WindowTarget {
  file?: string | null
  repo?: string | null
  doc?: string | null
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

export type GitChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'

export interface GitChange {
  path: string
  kind: GitChangeKind
}

export interface GitStatus {
  branch: string
  dirtyCount: number
  /** 未提交的变更明细(上限 500 条) */
  changes: GitChange[]
  ahead: number
  behind: number
}

export interface GitOpResult {
  ok: boolean
  changed: boolean
  message: string
  /** push 被拒且 rebase 冲突,需要用户二选一 */
  conflict?: boolean
  /** 拉取被本地修改/本地分叉阻碍,可提示「放弃本地并覆盖」 */
  divergent?: boolean
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
  /** 写入二进制文件(base64 编码;目录不存在自动创建)——编辑贴图入库用 */
  writeBinary(repoId: string, path: string, base64: string): Promise<void>
  /** 仓库内相对路径 → 可直接用于 <img src> 的 URL */
  assetUrl(repoId: string, path: string): string
  gitStatus(repoId: string): Promise<GitStatus>
  gitPull(repoId: string): Promise<GitOpResult>
  /** 放弃本地一切未推送内容,强制与远端一致(reset --hard 到上游;未跟踪文件保留) */
  gitPullForce(repoId: string): Promise<GitOpResult>
  gitSync(repoId: string, message?: string): Promise<GitOpResult>
  search(repoId: string, query: string): Promise<SearchHit[]>
  /** 外部链接用系统浏览器打开 */
  openExternal(url: string): Promise<void>
  /** 桌面端:把本地已有 git 仓库加入文库 */
  addRepoLocal(path: string): Promise<RepoMeta>
  /** 克隆远程仓库(HTTPS;私有仓库带 token,token 按 host 保存供后续 pull/push 复用) */
  addRepoClone(url: string, token?: string): Promise<RepoMeta>
  /** 从文库列表移除一条记录(只摘注册表,不删磁盘上的文件) */
  removeRepo(repoId: string): Promise<void>
  /** 桌面端:新开一个窗口并在其中打开指定目标(file 绝对路径 或 repo+doc) */
  openNewWindow(target: WindowTarget): Promise<void>
  /** 取走本窗口开机要打开的目标(只能取一次;主窗口通常为 null) */
  takeWindowTarget(): Promise<WindowTarget | null>
  /** 保存/更新某 host 的访问令牌(空 token 表示删除;host 传完整仓库地址也会被规范化成域名) */
  saveToken(host: string, token: string): Promise<void>
  /** 已保存令牌的域名列表(不含令牌值,仅供界面回显"存了哪些") */
  listTokenHosts(): Promise<string[]>
  /** 新建空文档(父目录自动创建;已存在则报错) */
  createFile(repoId: string, path: string): Promise<void>
  /** 新建文件夹(内置 .gitkeep 占位,保证空目录能进 git 同步) */
  createDir(repoId: string, path: string): Promise<void>
  /** 重命名文件或文件夹(仓库内移动) */
  renameEntry(repoId: string, from: string, to: string): Promise<void>
  /** 删除文件或文件夹(文件夹递归删除,不可恢复) */
  deleteEntry(repoId: string, path: string): Promise<void>
  /** 撤销单文件的本地修改(未跟踪文件=直接删除) */
  discardFile(repoId: string, path: string): Promise<void>
  /** 仓库内相对路径 → 磁盘绝对路径(复制路径 / 在文件管理器中显示) */
  absPath(repoId: string, path: string): Promise<string>
}
