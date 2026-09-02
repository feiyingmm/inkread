/** 以 dir 为基准解析相对路径(处理 ./ 与 ../),返回仓库内规范化路径 */
export function resolvePath(dir: string, rel: string): string {
  const parts = dir ? dir.split('/').filter(Boolean) : []
  for (const seg of rel.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}

export function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

export function extOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1).toLowerCase()
}

export const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'])
export const TEXT_EXTS = new Set(['txt', 'sql', 'html', 'htm', 'json', 'yml', 'yaml', 'xml', 'csv', 'js', 'ts', 'css', 'sh', 'py', 'java', 'properties', 'conf', 'ini', 'log'])

/** 可重排的电子书:一章一屏地读,套用墨阅自己的排版 */
export const EBOOK_EXTS = new Set(['epub', 'mobi', 'prc', 'azw', 'azw3'])

export function fileKind(path: string): 'markdown' | 'image' | 'text' | 'ebook' | 'pdf' | 'html' | 'other' {
  const ext = extOf(path)
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (EBOOK_EXTS.has(ext)) return 'ebook'
  if (ext === 'pdf') return 'pdf'
  // html 单独一档:渲染着读(消毒后进 .prose),而不是当源码看
  if (ext === 'html' || ext === 'htm') return 'html'
  if (TEXT_EXTS.has(ext)) return 'text'
  return 'other'
}
