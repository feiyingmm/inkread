const KNOWN_KEYS = new Set(['产品', '项目', '功能', '类型', '创建', '最后更新', '状态', '作者', '主题', '用途', '版本', '分支'])

const BADGE_KEYS = new Set(['状态', '类型'])

/**
 * 放不下的值让它独占一整行(多出两三倍宽度,省略号来得晚很多)。
 * 用实测宽度而不是按字数猜 —— 中英混排、字号、窗口宽度都会变,字数阈值总有踩不准的时候。
 * 正文字体(霞鹜文楷)是 webfont,加载完字宽会变,所以 fonts.ready 后再量一遍。
 */
function widenOverflowingRows(card: HTMLElement): void {
  const measure = (): void => {
    if (!card.isConnected) return
    const rows = Array.from(card.querySelectorAll<HTMLElement>('.meta-item'))
    const overflowing = rows.filter((row) => {
      const v = row.querySelector<HTMLElement>('.meta-val')
      return !!v && v.scrollWidth > v.clientWidth + 1
    })
    for (const row of overflowing) row.classList.add('meta-item--wide')
  }
  measure()
  void document.fonts?.ready.then(measure).catch(() => {})
}

/**
 * 识别 claude-docs 元信息块(文档开头的 blockquote,内为 `- **键**: 值` 列表),
 * 转换为结构化信息卡;不匹配则原样保留。
 */
export function transformInfoCards(root: HTMLElement): void {
  const candidates = Array.from(root.children).slice(0, 4).filter((el) => el.tagName === 'BLOCKQUOTE')
  for (const bq of candidates) {
    const list = bq.querySelector(':scope > ul')
    if (!list) continue
    const items: { key: string; valueHtml: string; plain: string }[] = []
    let hit = 0
    for (const li of Array.from(list.children)) {
      const strong = li.querySelector(':scope > strong')
      if (!strong) {
        items.length = 0
        break
      }
      const key = (strong.textContent ?? '').trim()
      const clone = li.cloneNode(true) as HTMLElement
      clone.querySelector(':scope > strong')?.remove()
      const valueHtml = clone.innerHTML.replace(/^\s*[::]\s*/, '')
      const plain = (clone.textContent ?? '').replace(/^\s*[::]\s*/, '').trim()
      items.push({ key, valueHtml, plain })
      if (KNOWN_KEYS.has(key)) hit++
    }
    if (items.length === 0 || hit < 3) continue

    const card = document.createElement('div')
    card.className = 'meta-card'
    for (const { key, valueHtml, plain } of items) {
      const row = document.createElement('div')
      row.className = 'meta-item'
      const k = document.createElement('span')
      k.className = 'meta-key'
      k.textContent = key
      const v = document.createElement('span')
      v.className = BADGE_KEYS.has(key) ? 'meta-val meta-badge' : 'meta-val'
      v.innerHTML = valueHtml
      // 再长也只显示一行,截断处出省略号;悬停看全文
      if (plain) v.title = plain
      row.append(k, v)
      card.append(row)
    }
    bq.replaceWith(card)
    // 进了真实 DOM 才能量宽度
    widenOverflowingRows(card)
    return
  }
}
