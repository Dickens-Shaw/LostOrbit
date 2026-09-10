import { defineConfig } from 'vite'

export default defineConfig({
  root: '.',
  publicDir: false,
  server: {
    port: 4173,
    open: '/preview/index.html',
  },
})
