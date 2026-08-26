import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'
import { inkreadDevServer } from './dev-server/middleware'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string }

// tauri android dev 真机调试时由 CLI 注入局域网 IP,vite 需监听 0.0.0.0 且 HMR 走该 IP
const devHost = process.env.TAURI_DEV_HOST

// Vditor 运行时资源由 scripts/copy-vditor.mjs 拷入 public/vditor(postinstall 自动执行)
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [vue(), inkreadDevServer()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    host: devHost || false,
    hmr: devHost ? { protocol: 'ws', host: devHost, port: 5174 } : undefined,
  },
  clearScreen: false,
})
