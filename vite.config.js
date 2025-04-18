import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  root: path.resolve(__dirname, 'public'),
  publicDir: path.resolve(__dirname, 'public'),
  server: {
    port: 3000,
    strictPort: true,
    headers: {
      'Content-Type': 'text/javascript'
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3420',
        changeOrigin: true,
        ws: true
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@utils': path.resolve(__dirname, 'src/utils'),
      '@components': path.resolve(__dirname, 'src/components'),
      '@store': path.resolve(__dirname, 'src/store'),
      'three$': 'https://cdn.jsdelivr.net/npm/three@0.132.2/build/three.module.js',
      'three/examples/jsm/': 'https://cdn.jsdelivr.net/npm/three@0.132.2/examples/jsm/',
      'three/examples/jsm/controls/OrbitControls': 'https://cdn.jsdelivr.net/npm/three@0.132.2/examples/jsm/controls/OrbitControls.js'
    }
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'public/modern.html')
    }
  }
})
