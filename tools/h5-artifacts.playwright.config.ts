import { defineConfig, devices } from "@playwright/test";

/**
 * H5 reader browser config (ARTEFACTS A6).
 *
 * Real Chromium against source reader content with synthetic authority
 * and operation ports. This is not final-image or receiving-API proof.
 * Explicitly selects the same specs the integrator excludes from Vitest:
 * testDir ../api/tests/e2e with testMatch artifacts-reader*.spec.ts.
 */
export default defineConfig({
  testDir: "../api/tests/e2e",
  testMatch: "artifacts-reader*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "../tmp/artefacts-mcp-a6/playwright-results",
  expect: { timeout: 1_500 },
  timeout: 60_000,
  use: {
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
});
