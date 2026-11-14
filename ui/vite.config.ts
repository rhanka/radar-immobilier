import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import { lucideDeepImports } from "./vite-plugins/lucide-deep-imports";

const base = process.env.GITHUB_PAGES === "true" ? "/radar-immobilier/" : "/";
const apiProxyTarget = process.env.API_PROXY_TARGET ?? "http://localhost:3000";

// Harnais QA (test navigateur de composants isolés). N'EST PAS inclus dans le
// build prod : activé uniquement quand QA_HARNESS=1 (lancé par Playwright).
const qaHarness = process.env.QA_HARNESS === "1";

// J1.2d/e: build the real UI as an artifact (`VITE_ARTIFACT_MODE=1`): app
// paths go through the named reader ops (src/lib/net/artifact-transport.ts).
const artifactMode = process.env.VITE_ARTIFACT_MODE === "1";
// Artifact basemap tiles (immo owns VITE_BASEMAP_TILE_URL). The build wrapper
// tools/make/ui-artifact-env.mjs sets it for `build:artifact`; the LIVE dev
// server on the builder pod runs this config without the wrapper and the host
// no longer passes it, so artifact mode defaults it here to the SAME value
// (tools/make/git-artifact-descriptor.test.mjs checks both paths agree). An
// explicit environment value (the wrapper's) always wins.
export const ARTIFACT_BASEMAP_TILE_URL = "/__artifacts/tiles/v1/osm/{z}/{x}/{y}";
const artifactBasemapDefault = artifactMode && !process.env.VITE_BASEMAP_TILE_URL?.trim()
  ? ARTIFACT_BASEMAP_TILE_URL : undefined;
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
      "signals-relevance": fileURLToPath(
        new URL("./e2e-qa/harness/signals-relevance.html", import.meta.url),
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
  ...(artifactBasemapDefault
    ? { define: { "import.meta.env.VITE_BASEMAP_TILE_URL": JSON.stringify(artifactBasemapDefault) } } : {}),
  // Build only: per-icon @lucide/svelte imports (app + design system) keep the
  // ~7 000-module icon barrel out of the module graph.
  plugins: [svelte(), lucideDeepImports()],
  resolve: {
    conditions: ["browser", "svelte", "module", "import", "default"],
    alias: [
      // J1.2d/e artifact build: swap the no-op boot hook for the transport
      // installer. Absent (app build), the transport is never bundled.
      ...(artifactMode
        ? [{ find: /^\.\/lib\/net\/artifact-boot$/,
          replacement: fileURLToPath(new URL("./src/lib/net/artifact-boot.artifact.ts", import.meta.url)) }]
        : []),
      { find: "$lib", replacement: fileURLToPath(new URL("./src/lib", import.meta.url)) },
    ],
  },
  // `vite dev` (A-LIVE builder pod): the dep optimizer cannot pre-bundle the
  // `?url` import of the maplibre worker inside @sentropic/geo-ui-svelte and the
  // dev server exits at startup. Serve that package unbundled instead
  // (measured by the sentropic pod-4live run on cc9f7ce2c).
  optimizeDeps: { exclude: ["@sentropic/geo-ui-svelte"] },
  build: harnessInput ? { rollupOptions: { input: harnessInput } } : {},
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      // Match production: stream geo bytes directly, without API enrichment
      // or response interception/decompression. Headers (including Vary) pass through.
      "/api/geo/collections": {
        target: process.env.GEO_OGC_BASE_URL ?? "https://api.preprod.geo.sent-tech.ca",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/geo/, ""),
      },
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
