import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

const base = process.env.GITHUB_PAGES === "true" ? "/radar-immobilier/" : "/";
const apiProxyTarget = process.env.API_PROXY_TARGET ?? "http://localhost:3000";

export default defineConfig({
  base,
  plugins: [svelte()],
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL("./src/lib", import.meta.url)),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/health": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
});
