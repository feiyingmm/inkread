import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface DevRepo {
  id: string
  name: string
  path: string
}

const here = path.dirname(fileURLToPath(import.meta.url))
const localFile = path.join(here, 'repos.local.json')

const DEFAULT_REPOS: DevRepo[] = [
  { id: 'claude-docs', name: 'claude-docs', path: 'D:\\Jack\\claude-docs' },
]

/** 读取本机仓库注册表;不存在时生成默认配置文件(repos.local.json 不入 git) */
export function loadRepos(): DevRepo[] {
  if (!fs.existsSync(localFile)) {
    fs.writeFileSync(localFile, JSON.stringify(DEFAULT_REPOS, null, 2), 'utf-8')
    return DEFAULT_REPOS
  }
  try {
    const list = JSON.parse(fs.readFileSync(localFile, 'utf-8')) as DevRepo[]
    return list.filter((r) => r.id && r.path)
  } catch {
    return DEFAULT_REPOS
  }
}

export function findRepo(id: string): DevRepo | undefined {
  return loadRepos().find((r) => r.id === id)
}

/** 把仓库内相对路径解析为绝对路径,并防止路径穿越 */
export function resolveInRepo(repo: DevRepo, rel: string): string {
  const abs = path.resolve(repo.path, rel.replace(/^[/\\]+/, ''))
  const root = path.resolve(repo.path)
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error(`路径越界: ${rel}`)
  }
  return abs
}
