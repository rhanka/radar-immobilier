/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{svelte,ts}"],
  theme: {
    extend: {
      // Project palette aliased onto @sentropic design-system semantic tokens
      // so it stays theme-reactive instead of carrying hardcoded hex values.
      colors: {
        radar: {
          ink: "var(--st-semantic-text-primary)",
          teal: "var(--st-semantic-action-primary)",
          amber: "var(--st-semantic-feedback-warning)",
          signal: "var(--st-semantic-feedback-info)",
          risk: "var(--st-semantic-feedback-error)",
        },
      },
    },
  },
  plugins: [],
};
