import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  root: path.resolve(__dirname, 'public'),
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'public/index.html'),
        // Add other HTML files in future, settings & history
      },
    },
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