import { defineConfig } from 'electron-vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    build: {
      lib: {
        entry: resolve(__dirname, 'electron/main.js')
      },
      outDir: 'dist-electron'
    }
  },
  preload: {
    build: {
      lib: {
        entry: resolve(__dirname, 'electron/preload.js')
      },
      outDir: 'dist-electron'
    }
  },
  renderer: {
    root: '.',
    plugins: [vue()],
    server: {
      host: '127.0.0.1'
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'index.html')
      },
      outDir: 'dist'
    }
  }
});
