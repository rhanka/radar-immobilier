# Feature: Per-icon @lucide/svelte imports in the UI build

## Objective
Cut the UI build module graph (memory and duration on the small single-build builder VM) by rewriting barrel `@lucide/svelte` named imports into per-icon deep imports, with an unchanged `build:artifact` contract and `ui/dist` output.

## Scope / Guardrails
- Owner GO of 2026-11-12; branch `perf/ui-lucide-per-icon-imports` from `origin/main`; no merge.
- Build-only Vite plugin; the builder still calls `build:artifact` and reads `ui/dist`.
- Only named imports of exactly `@lucide/svelte` are rewritten; other forms stay and warn.
- Unknown or non-icon names fail the build with the importer and the name.
- No Python; never read environment files; never use the operator kube config.
- Visual comparison on Chrome CDP port 9333 only; measurements in `node:24-bookworm-slim` at `--cpus=1`.
- Commits carry no AI attribution trailer (owner instruction overrides the generic trailer rule).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `ui/vite.config.ts`
  - `ui/vite-plugins/**`
  - `ui/vitest.config.ts`
  - `ui/tsconfig.json`
  - `ui/tsconfig.node.json`
  - `plan/LUCIDEDEEP-BRANCH_perf-ui-lucide-per-icon-imports.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `package.json`, `package-lock.json`, `sentropic.artifact.json`, `tools/make/ui-artifact-env.mjs`
  - `plan/NN-BRANCH_*.md` (other branches)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `LUCIDEDEEP-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- [x] Measurement probes (module census, hook timers, CPU profile) stay outside the repository.
- [x] attention: resolving the barrel with Rollup `this.resolve()` loads it back into the graph (3 163 modules instead of 1 334); the plugin resolves with Node from the importer, and the real-build test checks the whole graph, tree-shaken modules included.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch** (single build-config change, one test cycle)
- [ ] **Multi-branch**
- Rationale: one plugin, one config hook, no runtime code change.

## UAT Management (in orchestration context)
- [x] No UI behaviour change intended; rendering parity is proven by e2e plus a before/after screenshot comparison instead of a root UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/testing.md`.
  - [x] Branch from `origin/main` (`d4642bb72`); env `test-lucide-deep` for make gates.
  - [x] Baseline measured on `origin/main` at 1 vCPU (modules, wall time, memory peak, dist size).
- [x] **Lot 1 — Plugin**
  - [x] `ui/vite-plugins/lucide-deep-imports.ts`, wired in `ui/vite.config.ts` (app build and `build:artifact`).
  - [x] Unit tests: index reader, rewrite with aliases, node_modules importers, untouched forms, unknown names, real Vite build.
  - [x] Lot gate: `make typecheck`, `make lint`, `make test-ui`, `harness verify --category static|unit`.
- [ ] **Lot 2 — Measures and parity**
  - [x] Before/after: modules, wall time, memory peak, dist size; phase timings and CPU profile.
  - [x] 5 key screens compared on Chrome 9333 (byte-identical screenshots).
  - [ ] Rendering parity: `make test-e2e ENV=test-lucide-e2e`.
- [ ] **Lot 3 — Delivery**
  - [ ] PR to `main` with measures and profile; CI green; no merge.
