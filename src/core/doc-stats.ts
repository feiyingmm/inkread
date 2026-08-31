/** 编辑视图底部的字数统计 */
export interface DocStats {
  /** 不含空白字符的字数(中文按字算,英文按字符算 —— 与语雀口径一致) */
  chars: number
  lines: number
  /** 当前选中的字数(不含空白);0 表示没选中 */
  selected: number
}

function countChars(text: string): number {
  return text.replace(/\s+/g, '').length
}

export function docStats(text: string, selection = ''): DocStats {
  return {
    chars: countChars(text),
    lines: text ? text.split('\n').length : 0,
    selected: countChars(selection),
  }
}
