import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  plugins: [react()],
  css: {
    devSourcemap: true,
    modules: false,
    preprocessorOptions: {
      scss: {
        additionalData: `@import "@/styles/theme.css";`
      }
    }
  },
  root: __dirname,
  publicDir: 'public',
  server: {
    port: 3000,
    strictPort: true,
    cors: true,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/javascript'
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3420',
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      },
      '/settings': {
        target: 'http://localhost:3420',
        changeOrigin: true
      },
      '/bruno_demo_temp': {
        target: 'http://localhost:3420',
        changeOrigin: true
      },
      '/ws': {
        target: 'ws://localhost:3420',
        changeOrigin: true,
        ws: true
      },
      '/auth': {
        target: 'http://localhost:3420',
        changeOrigin: true,
        secure: false
      }
    },
    hmr: {
      overlay: false
    },
    watch: {
      usePolling: true,
      interval: 100
    },
    mimeTypes: {
      'application/javascript': ['jsx', 'tsx']
    }
  },
  preview: {
    port: 3000,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3420',
        changeOrigin: true,
        ws: true
      },
      '/settings': {
        target: 'http://localhost:3420',
        changeOrigin: true
      },
      '/bruno_demo_temp': {
        target: 'http://localhost:3420',
        changeOrigin: true
      },
      '/ws': {
        target: 'ws://localhost:3420',
        changeOrigin: true,
        ws: true
      }
    }
  },
  clearScreen: false,
  cacheDir: '.vite-cache',
  resolve: { 
    extensions: ['.js', '.jsx', 'ts', 'tsx', '.json'],
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@utils': path.resolve(__dirname, 'src/utils'),
      '@components': path.resolve(__dirname, 'src/components'),
      '@store': path.resolve(__dirname, 'src/store'),
      '@fortawesome/fontawesome-free/webfonts': path.resolve(__dirname, 'node_modules/@fortawesome/fontawesome-free/webfonts')
    }
  },
  optimizeDeps: {
    include: ['three/examples/jsm/loaders/DRACOLoader'],
    exclude: ['three/examples/js/libs/draco/draco_decoder.js']
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        modern: path.resolve(__dirname, 'src/modern.html')
      },
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name.includes('Room') || 
              assetInfo.name.includes('3d') ||
              assetInfo.name.match(/\.(glb|gltf)$/)) {
            return 'assets/[name].[hash][extname]';
          }
          return 'assets/[name][extname]';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js'
      }
    },
    cssCodeSplit: true,
    assetsDir: 'vendors/webfonts',
    outDir: 'dist',
    emptyOutDir: true
  }
})
