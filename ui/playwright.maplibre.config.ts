import { defineConfig } from "@playwright/test";

if (!process.env.MAPLIBRE_BASE_URL) {
  throw new Error("MAPLIBRE_BASE_URL must point to the production nginx acceptance image");
}
export default defineConfig({
  testDir: "./e2e-qa",
  testMatch: "maplibre-security.harness.spec.ts",
  workers: 1, retries: 0,
  expect: { timeout: 2000 },
  reporter: [["list"]],
  use: { baseURL: process.env.MAPLIBRE_BASE_URL, viewport: { width: 1100, height: 800 },
    trace: "retain-on-failure", screenshot: "only-on-failure",
    launchOptions: { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
      args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } },
});
