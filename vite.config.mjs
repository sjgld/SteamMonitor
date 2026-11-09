import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/ui',
  base: './',
  esbuild: { jsx: 'automatic' },
  build: { outDir: '../../build/ui', emptyOutDir: true, license: true },
});
