# Tailwind 3 build-chain vulnerabilities (braces, postcss-selector-parser)

- Status: open — exception PROPOSED, UNSIGNED (accepted_by: null, accepted_on: null)
- Owner: repository owner (to confirm)
- Review by: 2026-11-09 (UTC)
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

UI build/dev tooling only: `tailwindcss ^3.4.4` is a `ui` devDependency loaded
by PostCSS (`ui/postcss.config.cjs`) over repository content paths
(`ui/tailwind.config.cjs`). The UI image copies only `ui/dist` into nginx. No
production endpoint parses attacker-controlled CSS or glob patterns. A pull
request can still cause build-time resource exhaustion on the ephemeral CI runner.

## Why not fixed here

Removing the chain requires the Tailwind 4 migration (separate work; PR #828
closed). `npm audit fix --force` is not a compatibility proof.

## Removal plan

Validated Tailwind 4 migration, root lockfile regenerated through Make, CSS
output and UI checked, rescan, delete the register rows.
