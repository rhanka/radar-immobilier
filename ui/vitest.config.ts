import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    // Resolve Svelte to its browser/client runtime, not the SSR build.
    // Without this, `mount(...)` resolves to svelte/index-server and throws
    // `lifecycle_function_unavailable` when a component test renders a .svelte
    // file. Mirrors vite.config.ts conditions used for the browser bundle.
    conditions: ["browser", "svelte", "module", "import", "default"],
    alias: {
      $lib: fileURLToPath(new URL("./src/lib", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts"],
    // Components import Svelte; keep it inline so the browser condition wins.
    server: {
      deps: {
        inline: [/svelte/, /@testing-library\/svelte/],
      },
    },
  },
});
