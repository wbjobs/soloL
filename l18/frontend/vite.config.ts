import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import traeSoloBadge from 'vite-plugin-trae-solo-badge'

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: ['babel-plugin-react-dev-locator'],
      },
    }),
    tsconfigPaths(),
    traeSoloBadge(),
  ],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    include: [
      'three',
      '@react-three/fiber',
      '@react-three/drei',
    ],
  },
})
