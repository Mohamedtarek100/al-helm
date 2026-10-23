import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Configure VITE_BASE_PATH to the Pages repository path (e.g. /al-helm/).
// Root deployments use '/'; local builds retain a relative base by default.
const pagesBase = process.env.VITE_BASE_PATH

export default defineConfig({
  base: pagesBase || './',
  plugins: [react()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
})
