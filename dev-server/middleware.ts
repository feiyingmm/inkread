import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { loadRepos, findRepo, resolveInRepo, type DevRepo } from './repos'
import { gitPull, gitPullForce, gitStatus, gitSync, run } from './git'

const TEXT_EXT = new Set(['md', 'markdown', 'txt', 'sql', 'html', 'htm', 'json', 'yml', 'yaml', 'xml', 'csv', 'js', 'ts', 'css', 'sh', 'py', 'java', 'properties', 'conf', 'ini', 'log'])
const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', ico: 'image/x-icon', bmp: 'image/bmp', pdf: 'application/pdf',
}

interface TreeNode {
  name: string
  path: string
  type: 'dir' | 'file'
  ext?: string
  children?: TreeNode[]
}

function sortNodes(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-CN')
  })
  for (const n of nodes) if (n.children) sortNodes(n.children)
}

/**
 * git 仓库:文件树 = 受版本控制 + 未被 .gitignore 忽略的文件(与文档库语义一致)。
 *
 * **只在文库根自己就是仓库时才走 git**:git 命令会沿父目录往上找仓库,拿一个躺在
 * 别人仓库里的普通文件夹跑 `ls-files`,判定用的是外层仓库的 .gitignore ——
 * 该目录整个被忽略时返回空,文件树就空白了。与 Rust 侧 fsops::open_repo_at 同规则。
 */
async function listRepoFiles(repoPath: string): Promise<string[] | null> {
  if (!fs.existsSync(path.join(repoPath, '.git'))) return null
  const r = await run(repoPath, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
  if (r.code !== 0) return null
  return r.stdout.split('\0').filter((s) => s.length > 0 && !s.startsWith('.git/'))
}

function assembleTree(files: string[]): TreeNode[] {
  const rootNodes: TreeNode[] = []
  const dirMap = new Map<string, TreeNode>()

  function ensureDir(dirPath: string): TreeNode[] {
    if (!dirPath) return rootNodes
    const found = dirMap.get(dirPath)
    if (found) return found.children!
    const i = dirPath.lastIndexOf('/')
    const parent = ensureDir(i < 0 ? '' : dirPath.slice(0, i))
    const node: TreeNode = {
      name: dirPath.slice(i + 1),
      path: dirPath,
      type: 'dir',
      children: [],
    }
    dirMap.set(dirPath, node)
    parent.push(node)
    return node.children!
  }

  for (const f of files) {
    const name = f.slice(f.lastIndexOf('/') + 1)
    const i = f.lastIndexOf('/')
    const dir = i < 0 ? '' : f.slice(0, i)
    // 目录段以 . 开头(.github/.claude/.obsidian 等)整条不进文档树
    if (dir.split('/').some((seg) => seg.startsWith('.'))) continue
    // .gitkeep 是空目录占位:目录挂进树,文件本身不显示;其余点文件跳过
    if (name.startsWith('.')) {
      if (name === '.gitkeep') ensureDir(dir)
      continue
    }
    const siblings = ensureDir(dir)
    siblings.push({ name, path: f, type: 'file', ext: path.extname(name).slice(1).toLowerCase() })
  }
  sortNodes(rootNodes)
  return rootNodes
}

async function buildTree(root: string, rel = ''): Promise<TreeNode[]> {
  if (!rel) {
    const files = await listRepoFiles(root)
    if (files) return assembleTree(files)
  }
  const abs = rel ? path.join(root, rel) : root
  const entries = await fsp.readdir(abs, { withFileTypes: true })
  const nodes: TreeNode[] = []
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    if (e.name === 'node_modules') continue
    const relPath = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) {
      const children = await buildTree(root, relPath)
      nodes.push({ name: e.name, path: relPath, type: 'dir', children })
    } else if (e.isFile()) {
      const ext = path.extname(e.name).slice(1).toLowerCase()
      nodes.push({ name: e.name, path: relPath, type: 'file', ext })
    }
  }
  sortNodes(nodes)
  return nodes
}

async function searchRepo(repo: DevRepo, query: string) {
  const q = query.toLowerCase()
  const hits: { path: string; line: number; preview: string; nameMatch: boolean }[] = []
  const MAX = 200

  const gitFiles = await listRepoFiles(repo.path)
  if (gitFiles) {
    for (const relPath of gitFiles) {
      if (hits.length >= MAX) break
      const name = relPath.slice(relPath.lastIndexOf('/') + 1)
      if (name.toLowerCase().includes(q)) {
        hits.push({ path: relPath, line: 0, preview: name, nameMatch: true })
      }
      const ext = path.extname(name).slice(1).toLowerCase()
      if (!TEXT_EXT.has(ext)) continue
      const abs = path.join(repo.path, relPath)
      let stat
      try {
        stat = await fsp.stat(abs)
      } catch {
        continue
      }
      if (stat.size > 4 * 1024 * 1024) continue
      const content = await fsp.readFile(abs, 'utf-8')
      if (!content.toLowerCase().includes(q)) continue
      const lines = content.split('\n')
      for (let i = 0; i < lines.length && hits.length < MAX; i++) {
        const idx = lines[i].toLowerCase().indexOf(q)
        if (idx < 0) continue
        const start = Math.max(0, idx - 40)
        hits.push({
          path: relPath,
          line: i + 1,
          preview: lines[i].slice(start, idx + query.length + 60).trim(),
          nameMatch: false,
        })
      }
    }
    return hits
  }

  async function walk(rel: string) {
    if (hits.length >= MAX) return
    const abs = rel ? path.join(repo.path, rel) : repo.path
    const entries = await fsp.readdir(abs, { withFileTypes: true })
    for (const e of entries) {
      if (hits.length >= MAX) return
      if (e.name.startsWith('.') || e.name === 'node_modules') continue
      const relPath = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        await walk(relPath)
      } else if (e.isFile()) {
        const ext = path.extname(e.name).slice(1).toLowerCase()
        if (e.name.toLowerCase().includes(q)) {
          hits.push({ path: relPath, line: 0, preview: e.name, nameMatch: true })
        }
        if (!TEXT_EXT.has(ext)) continue
        const stat = await fsp.stat(path.join(abs, e.name))
        if (stat.size > 4 * 1024 * 1024) continue
        const content = await fsp.readFile(path.join(abs, e.name), 'utf-8')
        if (!content.toLowerCase().includes(q)) continue
        const lines = content.split('\n')
        for (let i = 0; i < lines.length && hits.length < MAX; i++) {
          const idx = lines[i].toLowerCase().indexOf(q)
          if (idx < 0) continue
          const start = Math.max(0, idx - 40)
          hits.push({
            path: relPath,
            line: i + 1,
            preview: lines[i].slice(start, idx + query.length + 60).trim(),
            nameMatch: false,
          })
        }
      }
    }
  }

  await walk('')
  return hits
}

/** 目录子树统计:文件数 / 子目录数 / 总字节(与 Rust 侧 fsops::dir_stats 同规则) */
async function dirStats(abs: string, depth = 0): Promise<{ files: number; dirs: number; bytes: number }> {
  const acc = { files: 0, dirs: 0, bytes: 0 }
  if (depth > 16) return acc
  let entries
  try {
    entries = await fsp.readdir(abs, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue
    const child = path.join(abs, e.name)
    if (e.isDirectory()) {
      acc.dirs++
      const sub = await dirStats(child, depth + 1)
      acc.files += sub.files
      acc.dirs += sub.dirs
      acc.bytes += sub.bytes
    } else if (e.isFile()) {
      acc.files++
      try {
        acc.bytes += (await fsp.stat(child)).size
      } catch {
        /* 读不到就不计 */
      }
    }
  }
  return acc
}

/** 条目信息(与 Rust 侧 fsops::entry_info 同契约) */
async function entryInfo(abs: string, rel: string) {
  const stat = await fsp.stat(abs)
  const info: Record<string, unknown> = {
    path: rel,
    absPath: abs,
    isDir: stat.isDirectory(),
    size: stat.size,
    mtime: stat.mtimeMs,
    ctime: stat.birthtimeMs || undefined,
  }
  if (stat.isDirectory()) {
    const { files, dirs, bytes } = await dirStats(abs)
    info.size = bytes
    info.fileCount = files
    info.dirCount = dirs
  } else if (TEXT_EXT.has(path.extname(rel).slice(1).toLowerCase()) && stat.size <= 4 * 1024 * 1024) {
    const text = await fsp.readFile(abs, 'utf-8')
    info.lines = text.length === 0 ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
    info.chars = [...text].length
  }
  return info
}

function json(res: ServerResponse, data: unknown, code = 200) {
  res.statusCode = code
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = ''
    req.on('data', (c) => (buf += c))
    req.on('end', () => resolve(buf))
    req.on('error', reject)
  })
}

/** Vite 开发期中间件:与 Rust 层同契约的本机后端(调系统 git.exe 与 fs) */
export function inkreadDevServer(): Plugin {
  return {
    name: 'inkread-dev-server',
    configureServer(server) {
      server.middlewares.use('/api', (req, res, next) => {
        handle(req, res).catch((err: Error) => {
          json(res, { error: err.message ?? String(err) }, 500)
        })
        async function handle(req: IncomingMessage, res: ServerResponse) {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const route = url.pathname
          const repoId = url.searchParams.get('repo') ?? ''
          const relPath = url.searchParams.get('path') ?? ''

          if (route === '/repos') {
            return json(
              res,
              // git 标志与 Rust 侧同规则:现探 .git,不落配置
              loadRepos().map(({ id, name, path: repoPath }) => ({
                id,
                name,
                git: fs.existsSync(path.join(repoPath, '.git')),
              })),
            )
          }

          const repo = findRepo(repoId)
          if (!repo) return json(res, { error: `未知仓库: ${repoId}` }, 404)

          switch (route) {
            case '/tree':
              return json(res, await buildTree(repo.path))
            case '/file': {
              const abs = resolveInRepo(repo, relPath)
              const stat = await fsp.stat(abs)
              const content = await fsp.readFile(abs, 'utf-8')
              return json(res, { content, mtime: stat.mtimeMs })
            }
            case '/raw': {
              const abs = resolveInRepo(repo, relPath)
              if (!fs.existsSync(abs)) return json(res, { error: '文件不存在' }, 404)
              const ext = path.extname(abs).slice(1).toLowerCase()
              res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream')
              fs.createReadStream(abs).pipe(res)
              return
            }
            case '/status':
              return json(res, await gitStatus(repo.path))
            case '/pull':
              return json(res, await gitPull(repo.path))
            case '/pull-force':
              return json(res, await gitPullForce(repo.path))
            case '/sync': {
              const body = JSON.parse((await readBody(req)) || '{}') as { message?: string }
              return json(res, await gitSync(repo.path, body.message ?? 'docs: 更新文档'))
            }
            case '/write': {
              const body = JSON.parse((await readBody(req)) || '{}') as { content?: string }
              const abs = resolveInRepo(repo, relPath)
              await fsp.writeFile(abs, body.content ?? '', 'utf-8')
              return json(res, { ok: true })
            }
            case '/write-binary': {
              const body = JSON.parse((await readBody(req)) || '{}') as { base64?: string }
              const abs = resolveInRepo(repo, relPath)
              await fsp.mkdir(path.dirname(abs), { recursive: true })
              await fsp.writeFile(abs, Buffer.from(body.base64 ?? '', 'base64'))
              return json(res, { ok: true })
            }
            case '/search': {
              const q = url.searchParams.get('q') ?? ''
              if (!q.trim()) return json(res, [])
              return json(res, await searchRepo(repo, q.trim()))
            }
            case '/abs-path': {
              return json(res, { path: resolveInRepo(repo, relPath) })
            }
            case '/entry-info': {
              const abs = resolveInRepo(repo, relPath)
              return json(res, await entryInfo(abs, relPath))
            }
            case '/create-file': {
              const abs = resolveInRepo(repo, relPath)
              if (fs.existsSync(abs)) return json(res, { error: '同名文件已存在' }, 409)
              await fsp.mkdir(path.dirname(abs), { recursive: true })
              await fsp.writeFile(abs, '', 'utf-8')
              return json(res, { ok: true })
            }
            case '/create-dir': {
              const abs = resolveInRepo(repo, relPath)
              if (fs.existsSync(abs)) return json(res, { error: '同名目录已存在' }, 409)
              await fsp.mkdir(abs, { recursive: true })
              // 空目录进不了 git,放置占位文件保证多端同步不丢目录
              await fsp.writeFile(path.join(abs, '.gitkeep'), '', 'utf-8')
              return json(res, { ok: true })
            }
            case '/delete': {
              if (!relPath.trim()) return json(res, { error: '不能删除仓库根目录' }, 400)
              const abs = resolveInRepo(repo, relPath)
              if (!fs.existsSync(abs)) return json(res, { error: '目标不存在' }, 404)
              const stat = await fsp.stat(abs)
              if (stat.isDirectory()) await fsp.rm(abs, { recursive: true })
              else await fsp.unlink(abs)
              return json(res, { ok: true })
            }
            case '/rename': {
              const to = url.searchParams.get('to') ?? ''
              if (!relPath.trim() || !to.trim()) return json(res, { error: '路径为空' }, 400)
              const src = resolveInRepo(repo, relPath)
              const dst = resolveInRepo(repo, to)
              if (!fs.existsSync(src)) return json(res, { error: '源文件不存在' }, 404)
              if (fs.existsSync(dst)) return json(res, { error: '目标名称已存在' }, 409)
              await fsp.mkdir(path.dirname(dst), { recursive: true })
              await fsp.rename(src, dst)
              return json(res, { ok: true })
            }
            case '/discard-file': {
              if (!relPath.trim()) return json(res, { error: '路径为空' }, 400)
              resolveInRepo(repo, relPath) // 越界校验
              // 未跟踪文件 = 删除;tracked = 恢复 HEAD 版本(含已暂存改动)
              const st = await run(repo.path, ['status', '--porcelain', '--', relPath])
              if (st.stdout.startsWith('??')) {
                await fsp.rm(resolveInRepo(repo, relPath), { recursive: true, force: true })
              } else {
                const r = await run(repo.path, ['checkout', 'HEAD', '--', relPath])
                if (r.code !== 0) return json(res, { error: r.stderr || '撤销失败' }, 500)
              }
              return json(res, { ok: true })
            }
            default:
              next()
          }
        }
      })
    },
  }
}
