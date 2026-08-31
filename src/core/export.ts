/** 把当前渲染的正文导出为自包含 HTML(样式内联、图片转 dataURL、Mermaid 已是内联 SVG) */
export async function buildExportHtml(title: string, proseEl: HTMLElement): Promise<string> {
  let css = ''
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) css += rule.cssText + '\n'
    } catch {
      /* 跨域样式表跳过 */
    }
  }

  const clone = proseEl.cloneNode(true) as HTMLElement
  // 交互件不进导出:折叠三角、代码块按钮(复制/格式化/折行)、展开全部、标题锚点
  clone.querySelectorAll('.fold-btn, .code-copy, .code-more, .head-anchor').forEach((el) => el.remove())
  clone.querySelectorAll('.fold-hidden').forEach((el) => el.classList.remove('fold-hidden'))
  // 折起来的代码块、限高的长表格在静态 HTML 里要摊开,否则导出的文档缺内容
  clone.querySelectorAll('.is-clipped').forEach((el) => el.classList.remove('is-clipped'))
  clone.querySelectorAll('.table-wrap.is-sticky-head').forEach((el) => el.classList.remove('is-sticky-head'))

  const imgs = Array.from(clone.querySelectorAll('img'))
  await Promise.all(
    imgs.map(async (img) => {
      try {
        const res = await fetch(img.src)
        const blob = await res.blob()
        const dataUrl = await new Promise<string>((ok, err) => {
          const fr = new FileReader()
          fr.onload = () => ok(String(fr.result))
          fr.onerror = err
          fr.readAsDataURL(blob)
        })
        img.src = dataUrl
      } catch {
        /* 拉取失败保留原地址 */
      }
    }),
  )

  const root = document.documentElement
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  return (
    `<!doctype html><html lang="zh-CN" data-brand="${root.dataset.brand ?? 'ink'}" data-mode="${root.dataset.mode ?? 'light'}">` +
    `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${esc(title)}</title><style>${css}</style></head>` +
    `<body style="margin:0;background:var(--bg-card)">` +
    `<div class="prose-wrap" style="max-width:56em;margin:0 auto"><div class="prose">${clone.innerHTML}</div></div>` +
    `</body></html>`
  )
}
