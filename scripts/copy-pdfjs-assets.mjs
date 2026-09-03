// 把 pdf.js 运行时按地址现取的外部资源拷进 public/,与 copy-vditor 同一套路
// (走 public 而非 dev 中间件的理由见那份脚本)。
//
// pdf.js 6 把两类东西拆出了主包,不给就**静默**出错 —— 渲染照常 resolve、只在 console 里 warn:
// - wasm/:JBIG2 / JPEG2000 / ICC 解码器。缺了,扫描版 PDF 整页画成白纸(只有 JPEG 封面正常)
// - cmaps/:CJK 字体的 CID→Unicode 映射。缺了,非嵌入的 GBK / UniGB 字体整个加载失败,文本层空、无法选中查找
//
// wasm/ 里排除 quickjs-eval.*(469KB):那是 XFA 表单的脚本引擎,墨阅不开 enableXfa、也不跑表单脚本,
// 白占安装包体积。用"排除法"而不是"列白名单":pdf.js 将来新增解码器时能自动跟上。
// standard_fonts/(820KB)不拷:浏览器里 pdf.js 默认用系统字体替代非嵌入的标准 14 字体,本机 135 本 PDF 无一告警。
import { cpSync, existsSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const srcRoot = path.join(root, 'node_modules', 'pdfjs-dist')
const destRoot = path.join(root, 'public', 'pdfjs')

const DIRS = [
  { name: 'wasm', filter: (from) => !path.basename(from).startsWith('quickjs-eval') },
  { name: 'cmaps', filter: () => true },
]

if (!existsSync(srcRoot)) {
  console.error('[copy-pdfjs-assets] 未找到 node_modules/pdfjs-dist,先 npm install')
  process.exit(1)
}
rmSync(destRoot, { recursive: true, force: true })
for (const { name, filter } of DIRS) {
  cpSync(path.join(srcRoot, name), path.join(destRoot, name), { recursive: true, filter })
}
console.log(`[copy-pdfjs-assets] pdf.js ${DIRS.map((d) => d.name).join(' / ')} 已拷贝到 public/pdfjs/`)
