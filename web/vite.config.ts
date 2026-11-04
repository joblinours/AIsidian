import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  base: '/',
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  build: { outDir: '../dist/public', emptyOutDir: true, assetsInlineLimit: 0, sourcemap: false },
  server: { proxy: { '/api': 'http://localhost:8090' } },
});
