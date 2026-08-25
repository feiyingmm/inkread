// 把 Vditor 运行时资源拷进 public/,由 Vite 静态服务(dev)与构建产物(build)直接携带。
// 走 public 而非 dev 中间件:script 标签请求会被 Vite 模块管线接管导致 404,public 目录优先级最高无此问题。
import { cpSync, existsSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const src = path.join(root, 'node_modules', 'vditor', 'dist')
const dest = path.join(root, 'public', 'vditor', 'dist')

if (!existsSync(src)) {
  console.error('[copy-vditor] 未找到 node_modules/vditor/dist,先 npm install')
  process.exit(1)
}
rmSync(dest, { recursive: true, force: true })
cpSync(src, dest, { recursive: true })
console.log('[copy-vditor] vditor 资源已拷贝到 public/vditor/dist')
