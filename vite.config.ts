import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // comlink is only reached through the lazily imported Auto UV engine; pre-bundle it so the dev server does not
  // discover it mid-session and reload the page
  optimizeDeps: { include: ['comlink'] },
})
