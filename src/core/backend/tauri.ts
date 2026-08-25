import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import type {
  Backend,
  FileContent,
  GitOpResult,
  GitStatus,
  RepoMeta,
  SearchHit,
  TreeNode,
} from './types'

/** 打包运行时:invoke Rust 命令(git2/fs/搜索),与 DevBackend 同契约 */
export const tauriBackend: Backend = {
  listRepos: () => invoke<RepoMeta[]>('list_repos'),
  listTree: (repoId) => invoke<TreeNode[]>('list_tree', { repoId }),
  readFile: (repoId, path) => invoke<FileContent>('read_file', { repoId, path }),
  writeFile: (repoId, path, content) => invoke<void>('write_file', { repoId, path, content }),
  writeBinary: (repoId, path, base64) => invoke<void>('write_binary', { repoId, path, base64 }),
  assetUrl: (repoId, path) => convertFileSrc(`${repoId}/${path}`, 'repo'),
  gitStatus: (repoId) => invoke<GitStatus>('git_status', { repoId }),
  gitPull: (repoId) => invoke<GitOpResult>('git_pull', { repoId }),
  gitPullForce: (repoId) => invoke<GitOpResult>('git_pull_force', { repoId }),
  gitSync: (repoId, message) => invoke<GitOpResult>('git_sync', { repoId, message }),
  search: (repoId, query) => invoke<SearchHit[]>('search_repo', { repoId, query }),
  openExternal: (url) => openUrl(url),
  addRepoLocal: (path) => invoke<RepoMeta>('add_repo_local', { path }),
  addRepoClone: (url, token) => invoke<RepoMeta>('add_repo_clone', { url, token }),
  saveToken: (host, token) => invoke<void>('save_token', { host, token }),
}
