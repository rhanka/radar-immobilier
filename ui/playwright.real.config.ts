import { defineConfig, devices } from "@playwright/test";

/**
 * Real-stack Playwright suite (6H): the production UI image (nginx) and API
 * image on a synthetic, seeded database. Run only through
 * `make test-e2e ENV=test-*` (tools/make/e2e-real.sh), never against preprod
 * or prod. Distinct from the mocked UI-only suite in `e2e-qa/`.
 */
const stateDir = process.env.E2E_STATE_DIR ?? "/e2e-state";
const baseURL = process.env.PLAYWRIGHT_UI_BASE_URL ?? "http://localhost:8080";

export default defineConfig({
  testDir: "./e2e-real",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  outputDir: "../tmp/e2e-real/test-results",
  reporter: [["list"], ["json", { outputFile: "../tmp/e2e-real/report.json" }]],
  use: {
    // Loopback relay to the UI container (secure context, see the runner).
    baseURL,
    storageState: `${stateDir}/member.json`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
