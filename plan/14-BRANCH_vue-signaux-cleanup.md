# Feature: Signaux rail cleanup — drop "Référence A", keep only "Nouveau B"

## Objective
Simplify the Signaux left rail to a single vivier view: remove the "Référence A"
tab/pipeline **and the entire "Référence A / Nouveau B" tab band** (the `Tabs`
switcher + its header), keep "Nouveau B" as the sole, default, header-less view.
Returning users with a persisted legacy-A key must migrate to B (never blank).
Second delegated patch (§3 signal-card cleanup) is already implemented and verified
as PR #514 (`feat/vue-p05-carte-signal-etape`) — it is folded into this promotion
circuit by rebase+merge, NOT re-implemented here.

First exercise of the preprod→prod promotion flow, gated by i-cond (no self-merge).

## Owner-locked scope (i-cond [8bda1a] relay, LOCKED)
- **First promotion test = FOCUSED = Lot A + #514 ONLY.**
- #511 (P01) / #513 (P04) / #512 (P02) = verified, promoted as a **batch just after**, once the flow is proven.
- #509 = **EXCLUDED** from this circuit.
- Owner precision (verbatim): remove "Référence A" = remove the **whole tab band** too (`Tabs`/`Select` switcher + its band/header, not just panel A's content) → no visible switcher; `panelB` renders **directly** as the sole view with no tab header; `selectMode`/`activeMode` become dead → removed.

## Scope / Guardrails
- Scope limited to the Signaux rail vivier-mode UI, its direct coupling, and the persisted-mode migration; UI-only (no `api/**`, no `packages/**`, no model).
- Migration IN scope (BR14-EX1): default + legacy-A persisted key → B. The A-projection machinery is KEPT as the migration safety net (a residual A key renders in B, never blank) — this is graceful degradation, not a user-facing A path (the A rail is gone). Full purge = Lot A2 (tracked, deferred).
- Make-only workflow, no direct Docker commands. `ENV=<env>` is the LAST make arg.
- Root workspace `~/src/radar-immobilier` reserved for user dev/UAT (`ENV=dev`, fixed ports 8801/5301/1101) — untouched.
- Branch development in repository-local isolated worktree `./tmp/worktrees/vue-signaux-cleanup` (this file lives there). Never system `/tmp`, never root checkout.
- Automated tests on dedicated `ENV=feat-vue-signaux-cleanup` with non-UAT ports (e.g. `API_PORT=8802 UI_PORT=5302 MAILDEV_UI_PORT=1102`). `down -v` after any stack.
- All new text in English. Discussions with the user in French.

## Pre-step (owner recoverability requirement — DONE)
- `git tag ref-a-last-valid bd3320d` (main tip = PR #518, contains a working "Référence A") created and pushed to origin → the A pipeline is cleanly recoverable after removal. Confirmed by i-cond.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope — Lot A rail-focused)**:
  - `ui/src/lib/components/maps/SignauxRail.svelte`
  - `ui/src/lib/components/maps/SignauxRail.test.ts`
  - `ui/src/lib/components/maps/SignauxMapView.svelte` (default subset-key coupling → B)
  - `ui/src/lib/signals/vivier-view-mode.ts` (+ `vivier-view-mode.test.ts`) — **migration only** (BR14-EX1 GRANTED): `initialVivierSubsetKey` default + legacy-A → `B_SUBSET_KEY`; `routeSubsetKey`/`reconcileVivierRouteSubset` A→B coercion for deep-links. KEEP `modeFromSubsetKey` (detection) + A-projection machinery (safety net). NO purge of A helpers here (= Lot A2).
  - `ui/src/lib/signals/legacy-filter-a-golden.test.ts` — ADAPT its URL-state block only (default + legacy-A → B); its projection/fail-closed golden stays FROZEN (it protects the kept A-projection safety net). DELETE deferred to Lot A2 with the machinery — deleting it now would leave `projectLegacyVivierA` unprotected.
  - `ui/src/lib/router/filter-persistence.test.ts` — ADAPT the `subsetKeyFromRoute` migration contract (every "revient à A" → "migre vers B"); it mirrors `initialVivierSubsetKey`.
  - `plan/14-BRANCH_vue-signaux-cleanup.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `api/**`, `packages/**` (UI-only patch)
- **Conditional Paths (allowed only with explicit exception)**:
  - Deep purge of now-unreachable A helpers in `vivier-view-mode.ts` (`projectLegacyVivierA`, `keyFromAFlags`, `aFlagsFromKey`, `DEFAULT_A_FLAGS`, `AFlags`, `A_SUBSET_KEY`) = **Lot A2** (TRACKED, deferred; requires the invariant "no A key ever reaches projection" to be provable). Out of this branch's scope.
  - `ui/src/lib/signals/signal-date-filter.ts` (+ test) — only if the default-key coupling requires it.
- **Exception process**:
  - Declare `BR14-EXn` in `## Feedback Loop` before touching any conditional/forbidden path, with reason + impact + rollback.

## Lots
- **Lot A — Remove "Référence A" + the whole tab band, default B, migrate A→B**
  - Test-first (RED→GREEN), critical cases:
    - **no A-B tab/band rendered, `panelB` visible immediately** (no `Tabs`, no switcher, no "Référence A" text);
    - **fresh default = B** (no stored key → lands on B, not the old A default `z|m|p`);
    - **persisted legacy-A key `z|m|p` → lands on B** (migration; never blank);
    - B axes (zonage/résidentiel/précoce) + exclusions unchanged.
  - `SignauxRail.svelte`: drop A imports (`DEFAULT_A_FLAGS`, `keyFromAFlags`, `aFlagsFromKey`, `type AFlags`, `type VivierViewMode`); drop `activeMode`/`aFlags`/`aFlagsFor`/`toggleAFlag`/`selectMode`/`TAB_LABELS`/`panelA`; **remove the `Tabs` component + its band/header entirely**; render `panelB` directly (no `{#key activeMode}`); `activeKey = keyForVivierB(bAxes)`; keep B intact (`bAxes`, `toggleBAxis`, `keyForVivierB`, `bAxesFromVivierKey`, `DEFAULT_B_AXES`, `panelB`, exclusions).
  - Migration (BR14-EX1): `vivier-view-mode.ts` `initialVivierSubsetKey` default + legacy-A → `B_SUBSET_KEY`; `routeSubsetKey`/`reconcileVivierRouteSubset` coerce residual A → B for deep-links. KEEP `modeFromSubsetKey` + A-projection as safety net.
  - Coupling: `SignauxMapView.svelte` default subset-key → B (`vivier-v2`) so a reload lands on B.
  - Tests: adapt `SignauxRail.test.ts` (drop the "Référence A"/tab + A-axis assertions → "no tab band, panelB immediate" + "fresh default = B" + "residual A key → B default"); adapt `vivier-view-mode.test.ts` (route/stored A→B + fresh default → B); adapt `legacy-filter-a-golden.test.ts` URL-state block; adapt `filter-persistence.test.ts` `subsetKeyFromRoute` contract.
  - Gate: `lot-gate` = `make typecheck` + vitest on `ENV=feat-vue-signaux-cleanup` (ports 8802/5302/1102). **RESULT (GREEN)**: typecheck 0 errors; full UI suite `1326 passed | 10 todo` (95 files, 0 failures); the 6 touched files 108/108. No persistent stack started (only `run --rm` containers) → nothing to `down -v`.
- **Lot B — §3 signal-card cleanup = fold PR #514 (NO re-implementation)**
  - Tracked item `01M06H40B4SWTM5DC1GPM5DGJ5` (§3 "Nettoyage carte signal"). Its 3 changes = exactly PR #514 (remove highlight block, remove "Effet densifiant" everywhere on the signal-card path, replace the "Signal" sub-label with the compact étape bubble). Verified live preprod (Référence A + Nouveau B).
  - Action: rebase `feat/vue-p05-carte-signal-etape` onto main, then i-cond gates merge → preprod → owner UAT → prod. No new code.
- **Lot A2 (DEFERRED, TRACKED) — deep purge of A-projection machinery in `vivier-view-mode.ts`**
  - i-cond verdict: purge the A helpers only WHEN the invariant "no A key ever reaches projection" is provable (route/storage/deep-link/reconcile). Out of this branch. Tracked as a follow-up item so the full clean is not forgotten.

## Promotion flow (mapped for i-cond — CD #518, `PREPROD_CD_ENABLED=true`)
- `deploy` (main→prod legacy) ÉTEINT; `deploy-preprod` (main→preprod) ACTIF; `promote-prod` (tag `v*`→prod by digest, ancestry-guarded) is the only prod path.
- Steps: rebase `feat/vue-p05-carte-signal-etape` onto main → i-cond gates merge → push main auto-deploys **preprod** from main → owner UAT → tag `v<semver>` promotes the main digest to **prod**.
- **Preprod consequence**: merging to main overwrites the manual image 481f85f → preprod loses #509/#511/#512/#513 until the batch merges (#509 excluded → stays absent). Temporary, bounded, verified-features; flagged to owner via i-cond. No prod impact from the merge (prod only on tag).

## Feedback Loop
- `acknowledge` (i-cond [8bda1a]) — verdict APPROVED: Lot A = rail/band/state removal + default B + migration A→B (BR14-EX1); keep `modeFromSubsetKey` + A-projection as migration net; Lot A2 = deferred purge, TRACK it.
- `acknowledge` (owner via i-cond) — precision LOCKED: remove the whole "Référence A / Nouveau B" tab band; `panelB` renders directly; add test "no A-B tab/band, panelB visible immediately". Scope LOCKED to Lot A + #514 only.
- `acknowledge` (i-cond) — GO Lot A; tag `ref-a-last-valid bd3320d` approved.
- `BR14-EX1` (GRANTED by i-cond) — `vivier-view-mode.ts` migration edits (default + legacy-A → B; deep-link A→B coercion). Reason: returning users must land on B, never blank. Impact: mode-persistence entry points only, A-projection kept. Rollback: revert file + `git tag ref-a-last-valid bd3320d`.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + lots** (Lot A new code; Lot B = fold existing #514; Lot A2 conditional). Single branch, i-cond-gated promotion; no self-merge.
- Rationale: One coherent Signaux-cleanup promotion unit for the first preprod→prod test; #514 folds in by rebase (never cherry-pick).

## Gate (MANDATORY)
- NO self-merge. i-cond gates: merge → preprod deploy → owner UAT → prod promotion.
- Consensus review ≥2 peers before requesting the gate; `harness check scope` clean.
