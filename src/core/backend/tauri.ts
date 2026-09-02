import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import type {
  Backend,
  EntryInfo,
  FileContent,
  FontManifest,
  FontProgress,
  GitOpResult,
  GitStatus,
  InstalledFont,
  RepoMeta,
  SearchHit,
  TreeNode,
  WindowTarget,
} from './types'

/** 打包运行时:invoke Rust 命令(git2/fs/搜索),与 DevBackend 同契约 */
export const tauriBackend: Backend = {
  listRepos: () => invoke<RepoMeta[]>('list_repos'),
  listTree: (repoId) => invoke<TreeNode[]>('list_tree', { repoId }),
  readFile: (repoId, path) => invoke<FileContent>('read_file', { repoId, path }),
  writeFile: (repoId, path, content) => invoke<void>('write_file', { repoId, path, content }),
  writeBinary: (repoId, path, base64) => invoke<void>('write_binary', { repoId, path, base64 }),
  assetUrl: (repoId, path) => convertFileSrc(`${repoId}/${path}`, 'repo'),
  exportFile: (path, content) => invoke<void>('export_file', { path, content }),
  exportBinary: (path, base64) => invoke<void>('export_binary', { path, base64 }),
  gitStatus: (repoId) => invoke<GitStatus>('git_status', { repoId }),
  gitPull: (repoId) => invoke<GitOpResult>('git_pull', { repoId }),
  gitPullForce: (repoId) => invoke<GitOpResult>('git_pull_force', { repoId }),
  gitSync: (repoId, message) => invoke<GitOpResult>('git_sync', { repoId, message }),
  search: (repoId, query) => invoke<SearchHit[]>('search_repo', { repoId, query }),
  openExternal: (url) => openUrl(url),
  addRepoLocal: (path) => invoke<RepoMeta>('add_repo_local', { path }),
  addRepoClone: (url, token) => invoke<RepoMeta>('add_repo_clone', { url, token }),
  removeRepo: (repoId) => invoke<void>('remove_repo', { repoId }),
  openNewWindow: (target) => invoke<void>('open_new_window', { target }),
  takeWindowTarget: () => invoke<WindowTarget | null>('take_window_target'),
  saveToken: (host, token) => invoke<void>('save_token', { host, token }),
  listTokenHosts: () => invoke<string[]>('list_token_hosts'),
  createFile: (repoId, path) => invoke<void>('create_file', { repoId, path }),
  createDir: (repoId, path) => invoke<void>('create_dir', { repoId, path }),
  renameEntry: (repoId, from, to) => invoke<void>('rename_entry', { repoId, from, to }),
  deleteEntry: (repoId, path) => invoke<void>('delete_entry', { repoId, path }),
  discardFile: (repoId, path) => invoke<void>('git_discard_file', { repoId, path }),
  absPath: (repoId, path) => invoke<string>('abs_path', { repoId, path }),
  entryInfo: (repoId, path) => invoke<EntryInfo>('entry_info', { repoId, path }),
  fontManifest: () => invoke<FontManifest>('font_manifest'),
  fontInstalled: () => invoke<InstalledFont[]>('font_installed'),
  fontInstall: (meta) => invoke<InstalledFont>('font_install', { meta }),
  fontUninstall: (id) => invoke<void>('font_uninstall', { id }),
  // convertFileSrc 会按平台拼出正确形态:Windows/Android 是 http://inkfont.localhost/<id>,
  // 其余平台是 inkfont://localhost/<id>
  fontUrl: (id) => convertFileSrc(id, 'inkfont'),
  onFontProgress: async (cb) => {
    const { listen } = await import('@tauri-apps/api/event')
    return listen<FontProgress>('font-progress', (e) => cb(e.payload))
  },
}
