import { defineConfig } from 'vite'

const service = 'http://localhost:48217'

export default defineConfig({
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 4000 },
  // `pnpm dev` against a running service, which only accepts its own origin
  server: { proxy: { '/api': { target: service, changeOrigin: true, headers: { origin: service } } } },
})
