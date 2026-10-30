import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/*.config.js",
      "**/*.config.cjs",
      "**/*.config.ts",
      "**/drizzle/**",
      // Artefacts de docs/specs (stubs, scripts d'illustration) : pas du code produit,
      // pas linté comme tel (ex. docs/spec/reports/*.mjs utilisant process/console node).
      "docs/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node.js tooling scripts: declare the Node runtime globals they use
    // (process, console, setTimeout) instead of disabling no-undef.
    files: ["tools/make/*.mjs", "ui/e2e-real/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        setTimeout: "readonly",
      },
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
