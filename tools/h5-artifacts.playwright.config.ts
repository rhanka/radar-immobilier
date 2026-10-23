import { defineConfig, devices } from "@playwright/test";

/**
 * H5 reader browser config (ARTEFACTS A6).
 *
 * Real Chromium against the real reader content app with synthetic
 * fixtures (specs spin their own localhost server; no mocks, no stack).
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
