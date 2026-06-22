import { defineConfig, devices } from "@playwright/test";

/**
 * Config Playwright pour les harnais de COMPOSANTS ISOLÉS (bug #5 PDF).
 *
 * Build dédié avec QA_HARNESS=1 (inclut e2e-qa/harness/*.html), servi par
 * `vite preview` sur dist-qa. Aucun stack docker, /api mocké par les tests.
 */
export default defineConfig({
  testDir: "./e2e-qa",
  testMatch: /.*\.harness\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4318",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command:
      "QA_HARNESS=1 npm run build && QA_HARNESS=1 npm run preview -- --port 4318 --strictPort",
    url: "http://127.0.0.1:4318/e2e-qa/harness/pdf-overlay.html",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
