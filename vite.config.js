// vite.config.js
import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  // Set your project root (the folder that contains index.html)
  root: __dirname, 
  // Build output directory (you may use 'dist' or another folder)
  build: {
    outDir: 'dist'
  },
  resolve: {
    alias: {
      'three/examples/jsm/': path.resolve(__dirname, 'node_modules/three/examples/jsm/')
    }
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3400',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
        secure: false,
        logLevel: 'debug',
      },
    },
  },
});
