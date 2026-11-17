# picomatch ReDoS — GHSA-fc5q-39xc-vjpf (2026-11-17)

## Finding

- Advisory: `GHSA-fc5q-39xc-vjpf` — "picomatch vulnerable to ReDoS through
  single-branch repeated extglobs", severity high (CVSS 7.5 per npm audit).
- Direct package: `picomatch@4.0.7` at `node_modules/picomatch`.
- Propagated (metavulnerability) findings on the build/test chain:
  `fdir@6.5.0`, `tinyglobby@0.2.16`, `tinyglobby@0.2.17`
  (`node_modules/vitest/node_modules/tinyglobby`), `vite@6.4.5`,
  `vitest@5.0.3`, `svelte-check@4.4.8`,
  `@typescript-eslint/typescript-estree@8.59.4`.

## State of fixes

- `npm audit --package-lock-only` reports `fixAvailable: false` for every
  package in the chain.
- `picomatch@4.0.7` is the latest published picomatch release; no patched
  release exists at the time of writing.
- The previous Quality gates run on this branch (same vite/vitest lockfile
  entries) passed the audit gate; the advisory appeared in the npm audit
  database between the two runs. This finding is not introduced by the
  llm-mesh 0.38.2 bump (the lockfile diff touches only
  `@sentropic/llm-mesh-refresh`).

## Exposure

- picomatch runs at build and test time only (vite, vitest, svelte-check,
  typescript-eslint), over glob patterns controlled by this repository.
- No production request path reaches it: the API and UI production images do
  not ship vite, vitest or svelte-check.

## Proposed disposition

- Register rows `EXC-2026-11-17-picomatch-*` are PROPOSED and UNSIGNED.
  They suppress nothing until the owner accepts them (status `accepted`,
  `accepted_by`, `accepted_on`, `expires` filled in by the owner).
- Removal: upgrade the chain as soon as a picomatch release fixing
  GHSA-fc5q-39xc-vjpf is published and consumed by vite/vitest, rescan
  through `make audit-security`, delete the rows.
