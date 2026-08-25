const KNOWN_KEYS = new Set(['产品', '项目', '功能', '类型', '创建', '最后更新', '状态', '作者', '主题', '用途', '版本', '分支'])

const BADGE_KEYS = new Set(['状态', '类型'])

/**
 * 识别 claude-docs 元信息块(文档开头的 blockquote,内为 `- **键**: 值` 列表),
 * 转换为结构化信息卡;不匹配则原样保留。
 */
export function transformInfoCards(root: HTMLElement): void {
  const candidates = Array.from(root.children).slice(0, 4).filter((el) => el.tagName === 'BLOCKQUOTE')
  for (const bq of candidates) {
    const list = bq.querySelector(':scope > ul')
    if (!list) continue
    const items: { key: string; valueHtml: string }[] = []
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
      let html = clone.innerHTML.replace(/^\s*[::]\s*/, '')
      items.push({ key, valueHtml: html })
      if (KNOWN_KEYS.has(key)) hit++
    }
    if (items.length === 0 || hit < 3) continue

    const card = document.createElement('div')
    card.className = 'meta-card'
    for (const { key, valueHtml } of items) {
      const row = document.createElement('div')
      row.className = 'meta-item'
      const k = document.createElement('span')
      k.className = 'meta-key'
      k.textContent = key
      const v = document.createElement('span')
      v.className = BADGE_KEYS.has(key) ? 'meta-val meta-badge' : 'meta-val'
      v.innerHTML = valueHtml
      row.append(k, v)
      card.append(row)
    }
    bq.replaceWith(card)
    return
  }
}
