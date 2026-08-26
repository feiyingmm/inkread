/**
 * 统一提取错误文案。
 *
 * Tauri 的 invoke 在 Rust 返回 `Err(String)` 时,reject 的是**字符串本身**而非 Error 对象,
 * 直接取 `.message` 会拿到 undefined —— 真实原因被整个吞掉(线上表现为「操作失败:undefined」,
 * 2026-08-26 用户反馈)。这里把 string / Error / 其他任意值统一收敛成可读文案。
 */
export function errMsg(e: unknown): string {
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object') {
    const m = (e as { message?: unknown }).message
    if (typeof m === 'string' && m) return m
    try {
      return JSON.stringify(e)
    } catch {
      /* 循环引用等,退回 String() */
    }
  }
  return String(e)
}
