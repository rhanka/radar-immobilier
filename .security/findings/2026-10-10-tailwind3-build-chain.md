# Tailwind 3 build-chain vulnerabilities (braces, postcss-selector-parser)

- Status: resolved on 2026-10-11 by the SECRES Tailwind 4 migration; no risk acceptance or owner signature.
- Register rows: `EXC-2026-10-10-braces`, `-micromatch`, `-fast-glob`, `-chokidar`,
  `-tailwindcss-braces`, `-postcss-selector-parser`, `-postcss-nested`,
  `-tailwindcss-selector-parser`

## Advisories

- GHSA-vfj7-8cjw-p6xm / CVE-2026-93687 — high (CVSS 7.5), `braces <=3.0.3`, no patched release.
  Findings: `braces@3.0.3`, `micromatch@4.0.8`, `fast-glob@3.3.3`,
  `tailwindcss@3.4.19` (root `node_modules`), `chokidar@3.6.0`
  (`node_modules/tailwindcss/node_modules/chokidar`).
- GHSA-rj75-hqrm-r3gf / CVE-2026-104844 — medium (CVSS 5.9),
  `postcss-selector-parser <7.1.6`, patched `7.1.6` (outside consumers' `^6`).
  Findings: `postcss-selector-parser@6.1.4`, `postcss-nested@6.2.0`, `tailwindcss@3.4.19`.

## Reachability

Historical exposure: UI build/dev tooling only; `tailwindcss ^3.4.4` was a `ui` devDependency loaded
by PostCSS (`ui/postcss.config.cjs`) over repository content paths
(`ui/tailwind.config.cjs`). The UI image copies only `ui/dist` into nginx. No
production endpoint parses attacker-controlled CSS or glob patterns. A pull
request can still cause build-time resource exhaustion on the ephemeral CI runner.

## Resolution and evidence

The SECRES patch replaces Tailwind 3.4.19 with `tailwindcss@4.3.3` and
`@tailwindcss/postcss@4.3.3`. The PostCSS plugin handles prefixing; autoprefixer
and the legacy JS configuration are removed. Content scanning remains bounded
to `ui/index.html` and `ui/src/**/*.{svelte,ts}`. CSS theme declarations preserve
the 72 used RGB palette tokens and the five theme-reactive radar aliases.
Small radii/shadows and outline classes use their v4 names; base border colors
and button cursors preserve the previous defaults.

Evidence (outside commits):
`tmp/security-residual-evidence/sol-tailwind/`, sibling of this worktree.

- `audit-before.json`: 13 findings (3 critical, 5 high, 2 moderate, 3 low).
- `audit-after.json`: 6 findings (3 critical, 0 high, 0 moderate, 3 low).
  The seven removed npm package findings correspond to eight register rows:
  npm aggregates the two Tailwind advisory chains into one high package finding.
- `dependency-after.log`: no braces, micromatch, fast-glob, postcss-nested,
  postcss-selector-parser or Tailwind 3 copy remains in the installed tree.
- `lockfile-preservation.json`: root metadata/overrides and all overlapping
  unrelated package records are unchanged; only Tailwind, its jiti loader and
  UI dependency metadata change. The #854 fixes are preserved.
- `install-clean.log`: `make exec-api CMD='npm ci --ignore-scripts'` passes;
  npm verifies lockfile integrity without executing lifecycle scripts.
- `typecheck.log`, `lint-final.log`, `build-final.log`,
  `smoke-ui-bundle.log`, `test-ui.log`: all Make gates pass (exit 0).
  UI tests: 125 files pass, one skipped; 1,659 tests pass, ten todo.
- `test-css-scoped-final.log`: four CSS compilation regression tests pass.
- `css-comparison-final.log`, `bundle-before/`, `bundle-after/`,
  `bundle-hashes.txt`: all 72 palette tokens are equal; no used utility is
  missing after required renames. Four absent v3 scan artifacts come from code
  or prose, not UI class attributes (`!container`, `!ring`, `!filter`, `grow`).

## Verification limits and integration gate

The migration-only audit captured above exited 1 (Make exited 2) because three
MapLibre-chain critical findings and three unrelated low findings remained.
The integrated 2026-10-12 SECRES receipt adds geo 0.6.3/MapLibre 6.4.1:
`geo063-integration/audit-after.json` now has zero critical/high/moderate and
three unchanged, unsuppressed low findings. No risk acceptance was added.

The integrated receipt includes 1,664 passing UI tests, six passing real-map
browser scenarios, typecheck/lint, production build and worker-hosting checks.
It also fixes the observed cascade collision where MapLibre's unlayered
relative positioning overrode Tailwind 4's absolute utility on local map hosts;
scoped positioning restores nonzero height and genuine lot selection.

CSS compilation and unit tests do not establish visual equivalence. Coordinator
UAT remains required for navigation/cards, forms and keyboard focus, legends,
responsive lists/dividers, nested themes and touch hover behavior. V4 introduces
CSS cascade layers, capability-gated hover, last-child spacing/divider selectors,
and minimum browser versions Safari 16.4, Chrome 111 and Firefox 128. No browser
UAT, production deployment or merge was performed by this implementation seat.
