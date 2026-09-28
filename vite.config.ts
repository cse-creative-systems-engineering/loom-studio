import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'

/**
 * A `.woff2` imported from SCRIPT is the output typeface, which must travel
 * inside exports, so it is inlined as a data URL in dev and build alike (the
 * esbuild bundles do the same with `--loader:.woff2=dataurl`). Fonts reached
 * from a stylesheet `url()` are not module imports and keep Vite's normal
 * asset handling.
 */
function inlineFonts() {
  return {
    name: 'loom-inline-woff2',
    enforce: 'pre' as const,
    load(id: string) {
      if (!id.endsWith('.woff2')) return null
      return `export default ${JSON.stringify(`data:font/woff2;base64,${fs.readFileSync(id).toString('base64')}`)}`
    },
  }
}

export default defineConfig({
  root: '.',
  base: './',
  plugins: [inlineFonts(), react()],
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
