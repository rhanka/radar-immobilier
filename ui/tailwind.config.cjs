/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{svelte,ts}"],
  theme: {
    extend: {
      colors: {
        radar: {
          ink: "#17202a",
          teal: "#0f766e",
          amber: "#b45309",
          signal: "#2563eb",
          risk: "#dc2626",
        },
      },
    },
  },
  plugins: [],
};
