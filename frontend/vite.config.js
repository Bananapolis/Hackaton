import { execSync } from 'child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

function getAppVersion() {
  if (process.env.VITE_APP_VERSION) return process.env.VITE_APP_VERSION
  try {
    const hash = execSync('git rev-parse --short HEAD').toString().trim()
    const date = execSync('git log -1 --format=%cd --date=short').toString().trim()
    return `${hash} · ${date}`
  } catch {
    return 'unknown'
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(getAppVersion()),
  },
  plugins: [react(), basicSsl()],
  server: {
    host: '0.0.0.0',
    https: true,
    proxy: {
      '/api': {
        target: 'http://localhost:9000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:9000',
        ws: true,
      },
      '/health': {
        target: 'http://localhost:9000',
        changeOrigin: true,
      },
      '/live': {
        target: 'http://localhost:8889',
        changeOrigin: true,
      },
    },
  },
})