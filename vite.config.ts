import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { inkreadDevServer } from './dev-server/middleware'

// Vditor 运行时资源由 scripts/copy-vditor.mjs 拷入 public/vditor(postinstall 自动执行)
export default defineConfig({
  plugins: [vue(), inkreadDevServer()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5173 },
  clearScreen: false,
})
