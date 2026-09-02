/** 构建时由 vite define 注入(package.json version) */
declare const __APP_VERSION__: string

/**
 * highlight.js 的单语言入口没带 .d.ts(只有主包和 lib/common 有),
 * 而按需注册语言必须走这些子路径 —— 见 core/markdown/pipeline.ts 顶部的说明。
 */
declare module 'highlight.js/lib/languages/*' {
  import type { LanguageFn } from 'highlight.js'
  const language: LanguageFn
  export default language
}

/**
 * pdfjs-dist 的 legacy 构建(带 polyfill,给老版 Android WebView 用,见 core/pdf.ts)
 * 与默认构建同一套 API,但包里没有给这条子路径配 .d.ts,这里把类型指回主包。
 */
declare module 'pdfjs-dist/legacy/build/pdf.mjs' {
  export * from 'pdfjs-dist'
}
