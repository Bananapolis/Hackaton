import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const devApiTarget = process.env.VITE_DEV_API_TARGET || 'http://127.0.0.1:9000'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: devApiTarget,
        changeOrigin: true,
      },
      '/health': {
        target: devApiTarget,
        changeOrigin: true,
      },
      '/ws': {
        target: devApiTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
