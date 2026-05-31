import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      external: ['microsoft-cognitiveservices-speech-sdk', 'onnxruntime-web'],
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/mqtt': {
        target: 'ws://localhost:9001',
        ws: true,
        changeOrigin: true,
      },
      '/ws/signaling': {
        target: 'ws://localhost:4000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
