import type { Backend, FileContent, GitOpResult, GitStatus, RepoMeta, SearchHit, TreeNode, WindowTarget } from './types'

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

export const devBackend: Backend = {
  listRepos: () => get<RepoMeta[]>('/api/repos'),
  listTree: (repo) => get<TreeNode[]>(`/api/tree?repo=${enc(repo)}`),
  readFile: (repo, path) => get<FileContent>(`/api/file?repo=${enc(repo)}&path=${enc(path)}`),
  writeFile: (repo, path, content) =>
    post<void>(`/api/write?repo=${enc(repo)}&path=${enc(path)}`, { content }),
  writeBinary: (repo, path, base64) =>
    post<void>(`/api/write-binary?repo=${enc(repo)}&path=${enc(path)}`, { base64 }),
  assetUrl: (repo, path) => `/api/raw?repo=${enc(repo)}&path=${enc(path)}`,
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
}
