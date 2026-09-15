import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
export default defineConfig({
  base: './', cacheDir: '/tmp/immo-focus-vite-cache', plugins: [svelte()],
  optimizeDeps: { exclude: ['@xyflow/svelte'] },
  esbuild: { supported: { 'template-literal': false } },
  resolve: { dedupe: ['svelte', '@xyflow/svelte'] },
  build: { target: 'es2022', outDir: 'dist', cssCodeSplit: false,
    rollupOptions: { input: 'index.html', output: { inlineDynamicImports: true } } },
});
