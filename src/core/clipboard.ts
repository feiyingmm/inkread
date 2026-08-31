/**
 * 复制文本到剪贴板。
 *
 * 不能只依赖 `navigator.clipboard`:Tauri 的 WebView 走的是 `http://tauri.localhost`,
 * 不是安全上下文,Android WebView 上该 API 可能整个缺席或直接抛错。
 * 拿不到就退回 `execCommand('copy')`,两条路都走不通才报错给用户。
 */
export async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return
    }
  } catch {
    /* 落到下面的兜底 */
  }

  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.top = '0'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  ta.setSelectionRange(0, text.length)
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  document.body.removeChild(ta)
  if (!ok) throw new Error('系统不允许复制,请长按手动选择')
}
