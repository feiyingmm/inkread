import { reactive } from 'vue'

export interface ToastItem {
  id: number
  text: string
  error: boolean
}

export const toasts = reactive<ToastItem[]>([])

let seq = 0

export function toast(text: string, error = false): void {
  const item: ToastItem = { id: ++seq, text, error }
  toasts.push(item)
  setTimeout(
    () => {
      const i = toasts.findIndex((t) => t.id === item.id)
      if (i >= 0) toasts.splice(i, 1)
    },
    error ? 4500 : 2200,
  )
}
