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
      "maplibre-security": fileURLToPath(
        new URL("./e2e-qa/harness/maplibre-security.html", import.meta.url),
      ),
      "pdf-overlay": fileURLToPath(
        new URL("./e2e-qa/harness/pdf-overlay.html", import.meta.url),
      ),
      "pdf-switch": fileURLToPath(
        new URL("./e2e-qa/harness/pdf-switch.html", import.meta.url),
      ),
      "pdf-nav": fileURLToPath(
        new URL("./e2e-qa/harness/pdf-nav.html", import.meta.url),
      ),
      "rail-filter": fileURLToPath(
        new URL("./e2e-qa/harness/rail-filter.html", import.meta.url),
      ),
      "precoce-b-persistence": fileURLToPath(
        new URL("./e2e-qa/harness/precoce-b-persistence.html", import.meta.url),
      ),
      "geo-level": fileURLToPath(
        new URL("./e2e-qa/harness/geo-level.html", import.meta.url),
      ),
      "navdrill-lotclick": fileURLToPath(
        new URL("./e2e-qa/harness/navdrill-lotclick.html", import.meta.url),
      ),
      "sel-panel": fileURLToPath(
        new URL("./e2e-qa/harness/sel-panel.html", import.meta.url),
      ),
      "focus-scope": fileURLToPath(
        new URL("./e2e-qa/harness/focus-scope.html", import.meta.url),
      ),
      "lot-fiche-geo": fileURLToPath(
        new URL("./e2e-qa/harness/lot-fiche-geo.html", import.meta.url),
      ),
      "lot-fields": fileURLToPath(
        new URL("./e2e-qa/harness/lot-fields.html", import.meta.url),
      ),
      "consistency-scorecard": fileURLToPath(
        new URL("./e2e-qa/harness/consistency-scorecard.html", import.meta.url),
      ),
      "basemap-menu": fileURLToPath(
        new URL("./e2e-qa/harness/basemap-menu.html", import.meta.url),
      ),
    }
  : undefined;

export default defineConfig({
  base,
  define: {
    // Client build identity (see ui-state position §b): the loaded bundle
    // carries its own id so tabs on N/N-1 deployments can be told apart.
    // Injected from IMMO_CLIENT_BUILD_ID (Dockerfile stamps the deployment
    // sha); dev and unstamped builds read "unknown".
    __IMMO_CLIENT_BUILD_ID__: JSON.stringify(
      process.env.IMMO_CLIENT_BUILD_ID ?? "unknown",
    ),
    __IMMO_SW_ENABLED__: process.env.IMMO_SW_ENABLED !== "false",
  },
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
