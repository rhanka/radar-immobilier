# Feature: Lockfile integrity for every installed entry + install-script inventory

## Objective
- [x] Give every installed entry of the root `package-lock.json` a `resolved` URL and an
  `integrity` SRI, without changing any version, so a builder can `npm ci` the lock with no
  integrity relaxation (sentropic A-LIVE enablement plan, workstream W6).
- [x] Inventory the 19 entries flagged `hasInstallScript` and record an explicit decision.

## Scope / Guardrails
- Worktree `tmp/lock-integrity`, branch `fix/lock-integrity` from `origin/main` (`43c873e0d`).
- No version change: the lock key set, key order, `name`/`version` and every field other than
  the added `resolved`/`integrity` stay byte-identical.
- No `.github/**`, no `Makefile`, no `docker-compose*.yml`, no Dockerfile change.
- Make-only for qualification gates, `ENV=test-lockint` last, stacks removed with `down -v`.
- No Python; Node-only scratch tooling kept outside the repository.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**: `package-lock.json`, `package.json` (`allowScripts` field only), this plan.
- **Forbidden Paths**: `Makefile`, `docker-compose*.yml`, `rules/**`, `.github/**`,
  `api/Dockerfile`, `ui/Dockerfile`, agent entry points, other branch plans.
- **Conditional Paths**: none required.

## Feedback Loop
- attention: `ui/Dockerfile` runs `npm install` without `--ignore-scripts`. With npm >= 11.19 the
  new `allowScripts` denials keep it script-free; with an older npm it would still run the
  scripts. Follow-up candidate, out of this branch's scope.

## Root cause
- Commit `cb371d5d0` (2026-07-10, Dependabot remediation) regenerated the whole lock from an
  existing `node_modules` tree (16 k lines changed). Arborist copied the actual-tree metadata,
  which carried no `resolved`/`integrity`, and the lock lost them for 812 entries. Later
  targeted bumps re-added them only for the entries they touched (614 still missing on main).
- `npm install --package-lock-only` does not repair this: it trusts the existing lock entries
  and leaves them without integrity (verified, 607 still missing after the run).

## Repair method
- Scratch Node script: for each installed entry lacking `resolved`/`integrity`, fetch
  `https://registry.npmjs.org/<name>/<version>` (alias entries use their `name` field), assert
  the returned `name@version` matches, and insert `dist.tarball` + `dist.integrity` right after
  `version` (npm field order).
- Compare script: same 831 keys in the same order, same `name`/`version` everywhere, top-level
  fields identical, the only differences are 607 added `resolved` and 607 added `integrity`.

## Counts (root lock, 831 keys)
| Category | Before | After |
| --- | --- | --- |
| Root project (`""`) | 1 | 1 |
| Workspace directories (`api`, `ui`, `packages/*`) | 7 | 7 |
| Workspace links (`link: true`, no integrity by design) | 7 | 7 |
| Installed registry entries | 816 | 816 |
| Installed entries missing `resolved`/`integrity` | 607 | 0 |
| Entries with `hasInstallScript` | 19 | 19 |

## Install-script decision
- All 19 entries are denied by name in the root `allowScripts` field (15 package names).
- None is needed at runtime: esbuild resolves its `@esbuild/<platform>` optional binary; the
  tree-sitter grammars are loaded by `@sentropic/engram` as `.wasm` through `web-tree-sitter`;
  the engram postinstall is a no-op (no `engram-memory/` in the tarball); tesseract.js runs an
  OpenCollective banner; fsevents is darwin-only and ships a prebuilt binary.
- Allowing the tree-sitter scripts would trigger `node-gyp rebuild` (Python + C toolchain) for
  `tree-sitter-lua`, which ships no prebuild; this conflicts with the no-Python policy.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline**: worktree from `origin/main`, counts, history bisection of the drop.
- [x] **Lot 1 — Repair**: registry fill, version-identity proof, `npm install --package-lock-only`
  stable (npm 11.16 / Node 24 and npm 11.21 / Node 22, and container npm 11.19 via `make install`).
- [x] **Lot 2 — Scripts**: inventory, runtime checks without scripts, `allowScripts` denials.
- [x] **Lot 3 — Qualification**: `npm ci --ignore-scripts --strict-peer-deps --workspaces
  --include-workspace-root` with an empty cache (every tarball checked against its SRI), plain
  `npm ci` runs no dependency script, `npm audit signatures`, `npm audit --package-lock-only
  --omit=dev` unchanged, Make gates (typecheck, lint, UI tests, build, immo-mcp tests, API tests).
- [ ] **Merge & close**: owner-controlled.
