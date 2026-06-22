import { defineConfig, devices } from "@playwright/test";

/**
 * Config Playwright QA NAVIGATEUR — UI SEULE (anti-OOM).
 *
 * Aucun stack docker : on build la UI (`npm run build`) puis on la sert avec
 * `vite preview` (static, zéro postgres/api). Les routes /api sont MOCKÉES par
 * chaque test via `page.route` (fixtures), ce qui permet de rendre les vues
 * authentifiées sans backend. Un seul navigateur Chromium (cache local).
 */
export default defineConfig({
  testDir: "./e2e-qa",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4317",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run preview -- --port 4317 --strictPort",
    url: "http://127.0.0.1:4317/",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
