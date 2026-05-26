import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.spec.ts", "src/**/*.test.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
