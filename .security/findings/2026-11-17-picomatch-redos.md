# picomatch ReDoS through single-branch repeated extglobs

- Status: proposed on 2026-11-17; no risk acceptance or owner signature yet.
- Register rows: `EXC-2026-11-17-picomatch` and its seven inherited findings
  (`-typescript-estree`, `-fdir`, `-svelte-check`, `-tinyglobby`,
  `-tinyglobby-vitest`, `-vite`, `-vitest`).

## Advisory

- GHSA-FC5Q-39XC-VJPF / CVE-2026-112366 — high (CVSS 7.5),
  `picomatch <= 4.0.7`, no patched release (npm `latest` is still 4.0.7).
  Findings from the CI audit gate on 2026-11-17: `picomatch@4.0.7`
  (direct), plus inherited findings on `@typescript-eslint/typescript-estree@8.59.4`,
  `fdir@6.5.0`, `svelte-check@4.4.8`, `tinyglobby@0.2.16`,
  `tinyglobby@0.2.17` (`node_modules/vitest/node_modules/tinyglobby`),
  `vite@6.4.5` and `vitest@5.0.3`.

## Reachability

Dev and build tooling only: eslint (`@typescript-eslint`), `svelte-check`,
`vite` and `vitest` glob repository-controlled file patterns at lint, check,
build and test time. No production runtime parses attacker-controlled glob
patterns; the shipped images run the compiled API/UI, not these tools. A
malicious pattern would first have to land in the repository, so the
practical exposure is build-time resource exhaustion on an ephemeral CI
runner.

## Removal plan

Upgrade the `picomatch` chain as soon as a patched picomatch release exists
(lockfile refresh through Make, then rescan), or on the next vite/vitest
major that drops the affected range. Until then the rows stay proposed:
only the owner can accept them (status, accepted_by, accepted_on, expires),
which is what would let the audit gate pass.
