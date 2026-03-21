import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_API_TARGET || 'http://127.0.0.1:9000',
        changeOrigin: true,
      },
      '/ws': {
        target: process.env.VITE_DEV_API_TARGET || 'http://127.0.0.1:9000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    reporters: ['default', 'junit'],
    outputFile: {
      junit: 'vitest-results.xml',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'lcov', 'cobertura'],
      thresholds: {
        lines: 30,
        functions: 15,
        branches: 30,
        statements: 30
      },
    },
  },
});
  