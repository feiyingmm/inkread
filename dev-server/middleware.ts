import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { loadRepos, findRepo, resolveInRepo, type DevRepo } from './repos'
import { gitPull, gitStatus, gitSync } from './git'

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

async function buildTree(root: string, rel = ''): Promise<TreeNode[]> {
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
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-CN')
  })
  return nodes
}

async function searchRepo(repo: DevRepo, query: string) {
  const q = query.toLowerCase()
  const hits: { path: string; line: number; preview: string; nameMatch: boolean }[] = []
  const MAX = 200

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
            return json(res, loadRepos().map(({ id, name }) => ({ id, name })))
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
            case '/search': {
              const q = url.searchParams.get('q') ?? ''
              if (!q.trim()) return json(res, [])
              return json(res, await searchRepo(repo, q.trim()))
            }
            default:
              next()
          }
        }
      })
    },
  }
}
