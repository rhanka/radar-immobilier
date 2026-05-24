import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

const base = process.env.GITHUB_PAGES === "true" ? "/radar-immobilier/" : "/";

export default defineConfig({
  base,
  plugins: [svelte()],
  server: {
    host: "0.0.0.0",
    port: 5173,
  },
});
