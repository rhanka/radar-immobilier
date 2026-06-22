import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

const base = process.env.GITHUB_PAGES === "true" ? "/radar-immobilier/" : "/";
const apiProxyTarget = process.env.API_PROXY_TARGET ?? "http://localhost:3000";

// Harnais QA (test navigateur de composants isolés). N'EST PAS inclus dans le
// build prod : activé uniquement quand QA_HARNESS=1 (lancé par Playwright).
const qaHarness = process.env.QA_HARNESS === "1";
const harnessInput = qaHarness
  ? {
      main: fileURLToPath(new URL("./index.html", import.meta.url)),
      "pdf-overlay": fileURLToPath(
        new URL("./e2e-qa/harness/pdf-overlay.html", import.meta.url),
      ),
    }
  : undefined;

export default defineConfig({
  base,
  plugins: [svelte()],
  resolve: {
    conditions: ["browser", "svelte", "module", "import", "default"],
    alias: {
      $lib: fileURLToPath(new URL("./src/lib", import.meta.url)),
    },
  },
  build: harnessInput ? { rollupOptions: { input: harnessInput } } : {},
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/health": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
      // /api couvre l'automatisation (ÉV11) et le chat + son flux SSE (ÉV9) ;
      // same-origin en dev donc pas de CORS cote navigateur.
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
});
