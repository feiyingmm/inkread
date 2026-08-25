import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { inkreadDevServer } from './dev-server/middleware'

export default defineConfig({
  plugins: [vue(), inkreadDevServer()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5173 },
  clearScreen: false,
})
