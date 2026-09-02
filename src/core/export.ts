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

/**
 * A4 纸在 96dpi 下的像素宽度(210mm)。导出图片按这个宽度排版,而不是屏幕上的实际宽度。
 *
 * 为什么不用屏幕宽度(2026-09-02 用户反馈):同一份 CSS 在不同宽度下换行、列宽、
 * 网格列数都不一样 —— 窗口 630px 宽时导出的图和打印预览(A4)版式对不上,
 * 而且窗口一缩,导出的图还会跟着变形。固定成纸宽后,导出的图与打印件是同一个版式,
 * 也与窗口大小无关。
 */
const PAGE_WIDTH = 794
/** 纸张内边距,约 10mm —— 让出图看起来就是一张纸,而不是贴边的截图 */
const PAGE_PADDING = 38

/**
 * 把当前正文导出为 PNG 长图。
 *
 * 做法是**克隆到一张离屏"纸"上再截**,不直接截屏幕上那个元素:
 * 屏幕宽度随窗口变,而导出应当稳定并与打印一致(见 `PAGE_WIDTH`)。
 *
 * 为什么要分片:Chromium 的 canvas 单边上限 65535px、面积也有上限,手机上更早触顶
 * —— 一篇长文轻松几万像素高,整张画必然失败。所以按 `SLICE_HEIGHT` 切成多张,
 * 文件名带序号。返回的是切好的 blob 列表,交给调用方决定往哪写。
 *
 * 两个容易踩的坑:
 * - **字体**:不等 `document.fonts.ready` 就截,中文字体还没就位,出图是兜底字形
 * - **底色**:深色模式下正文本身背景透明,html2canvas 会画成黑底甚至透明,
 *   所以显式取当前纸色当背景
 */
export async function exportProseImages(
  proseEl: HTMLElement,
  /** 进度回调:`done === 0` 是"开始,共 total 张"。超长文档要几十秒,不报进度会像卡死 */
  onProgress?: (done: number, total: number) => void,
): Promise<Blob[]> {
  const { default: html2canvas } = await import('html2canvas')

  // 中文字体动辄 10MB,没加载完就截图会得到兜底字形
  if (document.fonts?.ready) await document.fonts.ready

  const styles = getComputedStyle(document.documentElement)
  const paper = styles.getPropertyValue('--bg-card').trim() || '#ffffff'

  // 离屏的一张"纸":定宽、纸色底、留边;挪到视口外而不是 display:none
  // —— 隐藏元素量不出尺寸,html2canvas 会得到 0×0
  const sheet = document.createElement('div')
  sheet.style.cssText = [
    'position:fixed',
    'left:-20000px',
    'top:0',
    `width:${PAGE_WIDTH}px`,
    `padding:${PAGE_PADDING}px`,
    'box-sizing:border-box',
    `background:${paper}`,
    'z-index:-1',
    'pointer-events:none',
  ].join(';')

  const clone = proseEl.cloneNode(true) as HTMLElement
  // 屏幕上的宽度限制(.prose 的 max-width、is-wide 之类)在纸上没有意义,铺满纸面
  clone.style.maxWidth = 'none'
  clone.style.width = '100%'
  // 交互件不进图,和导出 HTML 的处理保持一致
  clone
    .querySelectorAll('.fold-btn, .code-copy, .code-more, .code-wrap-btn, .head-anchor')
    .forEach((el) => el.remove())
  clone.querySelectorAll('.fold-hidden').forEach((el) => el.classList.remove('fold-hidden'))
  clone.querySelectorAll('.is-clipped').forEach((el) => el.classList.remove('is-clipped'))
  clone.querySelectorAll('.table-wrap.is-sticky-head').forEach((el) => el.classList.remove('is-sticky-head'))
  sheet.appendChild(clone)
  document.body.appendChild(sheet)

  /**
   * 一张图最多截多高(CSS 像素;位图像素是它的 2 倍,见下面的 scale)。
   *
   * 硬限制来自 Chromium 的 canvas:单边 65535px、面积约 268M px²,**移动端小得多**
   * (常见只有 4096~8192 单边)。超了不会报错,而是静默给一张空白图 —— 所以宁可保守。
   * 桌面 15000 × 2 = 30000 像素高,一般文档一张就够;真的超长才会分段。
   */
  const SLICE_CSS = /android|iphone|ipad|ipod/i.test(navigator.userAgent) ? 4000 : 15000

  const toBlob = (c: HTMLCanvasElement): Promise<Blob> =>
    new Promise((ok, err) =>
      c.toBlob((b) => (b ? ok(b) : err(new Error('生成图片失败'))), 'image/png'),
    )

  const out: Blob[] = []
  try {
    // 等一帧,让浏览器按新宽度重排完再截
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const totalCss = sheet.scrollHeight
    const parts = Math.max(1, Math.ceil(totalCss / SLICE_CSS))
    onProgress?.(0, parts)
    for (let i = 0; i < parts; i++) {
      const y = i * SLICE_CSS
      const h = Math.min(SLICE_CSS, totalCss - y)
      /**
       * **分段截,而不是截完整张再切**:整张 canvas 一旦越过上面那些上限就是空白,
       * 而且几万像素高的位图峰值内存很吓人(1588×30000×4B ≈ 190MB)。
       * 按段截每次只占一段的内存,多长的文档都导得出来。
       */
      const canvas = await html2canvas(sheet, {
        backgroundColor: paper,
        // 固定 2 倍图:1 倍在高分屏上发虚;跟设备 dpr 走会让同一份文档在不同机器导出不一样
        scale: 2,
        useCORS: true,
        logging: false,
        // 让百分比与媒体查询按纸宽算,而不是按真实窗口
        windowWidth: PAGE_WIDTH,
        width: sheet.scrollWidth,
        y,
        height: h,
      })
      out.push(await toBlob(canvas))
      // 用完立刻释放,别让多张大位图同时压在内存里
      canvas.width = 0
      canvas.height = 0
      onProgress?.(i + 1, parts)
    }
  } finally {
    sheet.remove()
  }
  return out
}
