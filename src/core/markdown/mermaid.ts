let mermaidLib: typeof import('mermaid').default | null = null
let seq = 0

/** 渲染容器内全部 mermaid 块;深浅色切换时重复调用即重渲染 */
export async function renderMermaidBlocks(root: HTMLElement, dark: boolean): Promise<void> {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('.mermaid-block'))
  if (blocks.length === 0) return
  if (!mermaidLib) {
    mermaidLib = (await import('mermaid')).default
  }
  mermaidLib.initialize({
    startOnLoad: false,
    theme: dark ? 'dark' : 'neutral',
    securityLevel: 'loose',
    fontFamily: 'inherit',
  })
  for (const block of blocks) {
    const src = block.querySelector('.mermaid-src')?.textContent ?? ''
    const target = block.querySelector<HTMLElement>('.mermaid-target')
    if (!target || !src.trim()) continue
    try {
      const { svg } = await mermaidLib.render(`inkmmd-${++seq}`, src)
      target.innerHTML = svg
      block.classList.add('is-rendered')
    } catch (e) {
      document.getElementById(`dinkmmd-${seq}`)?.remove()
      target.innerHTML = `<div class="mermaid-error">Mermaid 渲染失败:${errMsg(e)}</div>`
      block.classList.add('is-rendered')
    }
  }
}import { errMsg } from '@/core/errmsg'

