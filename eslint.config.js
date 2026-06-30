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
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
