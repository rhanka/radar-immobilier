/** @type {import('tailwindcss').Config} */

// ─────────────────────────────────────────────────────────────────────────────
// Design-system bridge.
//
// The @sentropic `sent-tech` theme exposes flat semantic tokens as CSS custom
// properties (`--st-semantic-*`). It does NOT expose a full 50→950 color ramp as
// runtime variables. The theme is, however, literally built on the Tailwind
// `slate` ramp — its token VALUES are slate values:
//
//   surface-subtle  #f8fafc = slate-50      text-secondary #475569 = slate-600
//   border-subtle   #e2e8f0 = slate-200     text-muted     #64748b = slate-500
//   border-strong   #94a3b8 = slate-400     text-primary   #0f172a = slate-900
//   surface-inverse #0f172a = slate-900
//
// So we remap the neutral `slate` scale onto the DS semantic tokens shade-by-
// shade (faithful & lossless): every existing `text-slate-*` / `bg-slate-*` /
// `border-slate-*` class now resolves through a `var(--st-semantic-*)` token
// without editing any .svelte file. Each `var()` carries the matching slate
// fallback so utilities still resolve outside the themed wrapper (portals).
//
// Accent families (teal = project brand; amber/red/emerald/rose/blue/violet/
// sky/yellow/orange/green = status / feedback badges) are NOT remapped: see
// BRANCH.md "JUSTIFIED RESIDUAL". The DS exposes a single flat value per
// feedback role (no light/dark ramp as vars), and the brand accent is teal by
// project decision (DS action-* is blue). Remapping them would be a visual
// regression, not compliance — same exception class as the SVG-hex data-viz.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Helper: a Tailwind color value that resolves to a DS semantic token, with the
 * matching slate fallback so it still renders if `--st-*` is not in scope.
 */
const st = (token, fallback) => `var(--st-semantic-${token}, ${fallback})`;

module.exports = {
  content: ["./index.html", "./src/**/*.{svelte,ts}"],
  theme: {
    extend: {
      colors: {
        // Neutral scale → DS semantic tokens (the compliance bridge).
        // Shades without an exact DS token map to the nearest one; slate is
        // neutral so the sub-shade drift is visually negligible.
        slate: {
          50: st("surface-subtle", "#f8fafc"), // page / subtle backgrounds
          100: st("surface-subtle", "#f1f5f9"), // light fills / light borders
          200: st("border-subtle", "#e2e8f0"), // default borders / dividers
          300: st("border-strong", "#cbd5e1"), // strong dividers / faint text
          400: st("border-strong", "#94a3b8"), // muted text / strong border
          500: st("text-muted", "#64748b"), // muted / placeholder text
          600: st("text-secondary", "#475569"), // secondary body text
          700: st("text-primary", "#334155"), // emphasized text → primary (keeps it dark)
          800: st("text-primary", "#1e293b"), // strong text
          900: st("text-primary", "#0f172a"), // primary text / titles
          950: st("text-primary", "#020617"), // strongest text / inverse bg
        },
        // Project brand accent (kept as-is, documented residual — see header).
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
