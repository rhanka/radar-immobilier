import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // When running vitest on the host (without Docker node_modules volumes),
      // point workspace packages to the current worktree sources so tests
      // pick up the latest schema exports.
      "@radar/domain": fileURLToPath(
        new URL("../packages/radar-domain/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["tests/**/*.spec.ts", "src/**/*.test.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
