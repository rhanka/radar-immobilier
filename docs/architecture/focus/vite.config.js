import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
export default defineConfig({
  base: './', cacheDir: '/tmp/immo-focus-vite-cache', plugins: [svelte()],
  resolve: { alias: { '@kit': '/kit/src' }, dedupe: ['svelte', '@xyflow/svelte', '@sentropic/design-system-svelte'] },
  build: { target: 'es2022', outDir: 'dist', cssCodeSplit: false,
    rollupOptions: { input: 'index.html', output: { inlineDynamicImports: true } } },
});
