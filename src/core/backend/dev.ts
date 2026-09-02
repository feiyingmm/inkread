import type {
  Backend,
  EntryInfo,
  FileContent,
  GitOpResult,
  GitStatus,
  RepoMeta,
  SearchHit,
  TreeNode,
  WindowTarget,
} from './types'

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `请求失败: ${res.status}`)
  return data as T
}

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `请求失败: ${res.status}`)
  return data as T
}

const enc = encodeURIComponent

/** 开发模式落盘:借浏览器下载,文件名取路径最后一段 */
function download(path: string, blob: Blob): void {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = path.split(/[/\\]/).pop() || 'export'
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export const devBackend: Backend = {
  listRepos: () => get<RepoMeta[]>('/api/repos'),
  listTree: (repo) => get<TreeNode[]>(`/api/tree?repo=${enc(repo)}`),
  readFile: (repo, path) => get<FileContent>(`/api/file?repo=${enc(repo)}&path=${enc(path)}`),
  writeFile: (repo, path, content) =>
    post<void>(`/api/write?repo=${enc(repo)}&path=${enc(path)}`, { content }),
  writeBinary: (repo, path, base64) =>
    post<void>(`/api/write-binary?repo=${enc(repo)}&path=${enc(path)}`, { base64 }),
  assetUrl: (repo, path) => `/api/raw?repo=${enc(repo)}&path=${enc(path)}`,
  // 开发模式没有保存对话框,退回浏览器下载
  exportFile: (path, content) => {
    download(path, new Blob([content], { type: 'text/plain;charset=utf-8' }))
    return Promise.resolve()
  },
  exportBinary: (path, base64) => {
    const bin = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    download(path, new Blob([bin], { type: 'application/octet-stream' }))
    return Promise.resolve()
  },
  gitStatus: (repo) => get<GitStatus>(`/api/status?repo=${enc(repo)}`),
  gitPull: (repo) => post<GitOpResult>(`/api/pull?repo=${enc(repo)}`),
  gitPullForce: (repo) => post<GitOpResult>(`/api/pull-force?repo=${enc(repo)}`),
  gitSync: (repo, message) => post<GitOpResult>(`/api/sync?repo=${enc(repo)}`, { message }),
  search: (repo, query) => get<SearchHit[]>(`/api/search?repo=${enc(repo)}&q=${enc(query)}`),
  openExternal: (url) => {
    window.open(url, '_blank', 'noopener')
    return Promise.resolve()
  },
  addRepoLocal: () =>
    Promise.reject(new Error('开发模式请编辑 dev-server/repos.local.json 添加仓库')),
  addRepoClone: () =>
    Promise.reject(new Error('开发模式请编辑 dev-server/repos.local.json 添加仓库')),
  removeRepo: () =>
    Promise.reject(new Error('开发模式请编辑 dev-server/repos.local.json 移除仓库')),
  openNewWindow: () => Promise.reject(new Error('开发模式不支持多窗口')),
  takeWindowTarget: (): Promise<WindowTarget | null> => Promise.resolve(null),
  saveToken: () =>
    Promise.reject(new Error('开发模式凭据走系统 git,无需配置令牌')),
  listTokenHosts: () => Promise.resolve([]),
  createFile: (repo, path) => post<void>(`/api/create-file?repo=${enc(repo)}&path=${enc(path)}`),
  createDir: (repo, path) => post<void>(`/api/create-dir?repo=${enc(repo)}&path=${enc(path)}`),
  renameEntry: (repo, from, to) => post<void>(`/api/rename?repo=${enc(repo)}&path=${enc(from)}&to=${enc(to)}`),
  deleteEntry: (repo, path) => post<void>(`/api/delete?repo=${enc(repo)}&path=${enc(path)}`),
  discardFile: (repo, path) => post<void>(`/api/discard-file?repo=${enc(repo)}&path=${enc(path)}`),
  absPath: (repo, path) => get<{ path: string }>(`/api/abs-path?repo=${enc(repo)}&path=${enc(path)}`).then((r) => r.path),
  entryInfo: (repo, path) => get<EntryInfo>(`/api/entry-info?repo=${enc(repo)}&path=${enc(path)}`),
  // 字体扩展要落盘到应用数据目录、并靠 Rust 注册的 inkfont 协议加载,浏览器里两样都没有。
  // 开发模式下字体页只剩「内置」与「本机系统字体」两区,那两区是纯前端探测,照常可用。
  fontManifest: () => Promise.resolve({ version: 0, fonts: [] }),
  fontInstalled: () => Promise.resolve([]),
  fontInstall: () => Promise.reject(new Error('开发模式不支持下载字体,请在打包后的应用里使用')),
  fontUninstall: () => Promise.resolve(),
  fontUrl: () => '',
  onFontProgress: () => Promise.resolve(() => {}),
}
