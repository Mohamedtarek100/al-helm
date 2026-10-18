import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Relative base keeps the build working both at the domain root and under a
// GitHub Pages repository path (e.g. https://user.github.io/al-helm/).
// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
})
