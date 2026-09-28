import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: '.',
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
    target: 'chrome140',
    rollupOptions: {
      input: {
        index: 'index.html',
        // The detached preview window is a second renderer entry.
        preview: 'preview.html',
        // Run on desktop: the design as a real, frameless window.
        desktop: 'desktop.html',
      },
    },
  },
  server: { port: 5178, strictPort: true },
})
