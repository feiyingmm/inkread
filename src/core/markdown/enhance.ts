/**
 * 渲染后的正文增强(在真实 DOM 上做,需要量宽高所以放在 afterRender 里):
 * 长表格首行吸顶、超长代码块折叠、代码块折行开关、标题锚点。
 * 点击行为统一由 MarkdownView 的事件委托处理,这里只负责把按钮/标记装上去。
 */

/** 超过这么多行的代码块先折起来 */
const LONG_CODE_LINES = 26

/** 等宽字体下超过这么多"半角宽"就算长行,给折行开关 */
const LONG_LINE_WIDTH = 80

/** 全角字符(中日韩、全角标点)在等宽字体里占两格,按字符数算会低估一半 */
const WIDE_CHAR = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/

function displayWidth(line: string): number {
  let w = 0
  for (const c of line) w += WIDE_CHAR.test(c) ? 2 : 1
  return w
}

/**
 * 标出"比一屏还高"的表格,让 MarkdownView 给它做浮动表头。
 *
 * 为什么不用 `position: sticky`:表格外层 `.table-wrap` 是 `overflow-x: auto`
 * (宽表格靠它横滚),这就让它成了滚动容器,sticky 只会吸在这个容器内部,
 * 而容器没有纵向滚动 → 永远不触发。想让 sticky 参照页面,就得放开 overflow,
 * 宽表格便没法横滚了;想让容器纵向滚,就得限高,平白多一层嵌套滚动
 * (INDEX.md 那种通篇长表格的文档会变成滚一下卡一下)。
 * 所以改用「另画一份表头浮在上面」:滚动行为完全不变,宽表格照样横滚。
 */
export function markTallTables(root: HTMLElement): void {
  const limit = window.innerHeight * 0.8
  for (const wrap of Array.from(root.querySelectorAll<HTMLElement>('.table-wrap'))) {
    const table = wrap.querySelector('table')
    if (!table || !table.tHead) continue
    if (table.getBoundingClientRect().height > limit) wrap.classList.add('has-float-head')
  }
}

/**
 * 给某张表格造一份表头副本。列宽按真表头实测值写死(配合 table-layout: fixed),
 * 否则副本自己排版会跟正文的列对不齐。
 */
export function buildFloatHead(wrap: HTMLElement): HTMLElement | null {
  const table = wrap.querySelector('table')
  const thead = table?.tHead
  if (!table || !thead) return null
  const widths = Array.from(thead.querySelectorAll('th')).map((th) => th.getBoundingClientRect().width)
  const clone = document.createElement('table')
  clone.style.tableLayout = 'fixed'
  clone.style.width = `${table.getBoundingClientRect().width}px`
  const headClone = thead.cloneNode(true) as HTMLTableSectionElement
  Array.from(headClone.querySelectorAll('th')).forEach((th, i) => {
    if (widths[i] !== undefined) (th as HTMLElement).style.width = `${widths[i]}px`
  })
  clone.append(headClone)
  return clone
}

export function setupCodeBlocks(root: HTMLElement): void {
  for (const block of Array.from(root.querySelectorAll<HTMLElement>('.code-block'))) {
    const pre = block.querySelector<HTMLElement>('.code-pre')
    const code = pre?.querySelector('code')
    const acts = block.querySelector('.code-acts')
    if (!pre || !code) continue

    const codeLines = (code.textContent ?? '').replace(/\n+$/, '').split('\n')
    // 折行开关只给长行的块加,短代码块不摆没用的按钮。
    // 用"最长一行多少字符"判断而不是量 scrollWidth —— 量宽度得等字体与布局稳定,
    // afterRender 这个时机量出来偏小(实测 691px 的块当时只报 633,按钮就没加上)
    const maxWidth = codeLines.reduce((m, l) => Math.max(m, displayWidth(l)), 0)
    if (acts && !acts.querySelector('.code-wrap-btn') && maxWidth > LONG_LINE_WIDTH) {
      const btn = document.createElement('button')
      btn.className = 'code-copy code-wrap-btn'
      btn.type = 'button'
      btn.textContent = '折行'
      btn.title = '长行折行显示(默认横向滚动)'
      acts.prepend(btn)
    }

    // 超长折叠:整文件视图(.json/.sql 直接打开)不折,那本来就是要看全的
    if (block.classList.contains('code-block--file')) continue
    if (codeLines.length > LONG_CODE_LINES && !block.querySelector('.code-more')) {
      block.classList.add('is-clipped')
      const more = document.createElement('button')
      more.className = 'code-more'
      more.type = 'button'
      more.textContent = `展开全部 ${codeLines.length} 行`
      more.dataset.lines = String(codeLines.length)
      block.append(more)
    }
  }
}

/** 标题末尾挂一个「#」:点一下复制指向本节的 Markdown 链接(悬停才显形) */
export function setupHeadingAnchors(root: HTMLElement): void {
  for (const h of Array.from(root.querySelectorAll<HTMLElement>('h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]'))) {
    if (h.querySelector('.head-anchor')) continue
    const btn = document.createElement('button')
    btn.className = 'head-anchor'
    btn.type = 'button'
    btn.textContent = '#'
    btn.title = '复制本节链接(Markdown 格式)'
    h.append(btn)
  }
}

/** 标题的纯文字(去掉折叠三角与锚点按钮) */
export function headingText(h: HTMLElement): string {
  const clone = h.cloneNode(true) as HTMLElement
  for (const b of Array.from(clone.querySelectorAll('button'))) b.remove()
  return (clone.textContent ?? '').trim()
}
