import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify('test'),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    reporters: ['default', 'junit'],
    outputFile: {
      junit: './vitest-results.xml',
    },
    coverage: {
      reportsDirectory: './coverage',
      reporter: ['text', 'html', 'cobertura'],
      exclude: ['src/main.jsx', 'src/test/**', '**/*.config.*'],
    },
  },
})
