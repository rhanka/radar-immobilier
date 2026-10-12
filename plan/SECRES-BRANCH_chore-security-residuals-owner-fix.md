# Chore: Resolve dependency security residuals

## Objective
- [x] Preserve all #854 fixes at `42ec4a05e92204899abd490f41dfd2537734fe77` and remove the five high and two medium npm findings through a Tailwind 4 migration.
- [x] Preserve the reviewed, uncommitted Tailwind patch and its reproducible evidence.
- [x] Consume owner-approved geo 0.6.3 with MapLibre 6.4.1 and remove the critical inherited findings before any merge.

## Scope / Guardrails
- [x] Work only in `tmp/security-residuals-owner-fix`, branch `chore/security-residuals-owner-fix`; no other repository/worktree changes.
- [x] Make-only, container-only dependency execution; regenerate `package-lock.json` through Make; no host node_modules, Python or model keys. Owner explicitly requested background Sol agents for independent checks.
- [x] Owner decision on 2026-10-12 authorizes commits via `make commit` and pushing this correction to existing PR #854 (`chore/deps-security-hotfix-2`), followed by CI and independent Opus/Fable technical review. No merge, deployment, tag, permission changes, trailers, audit suppression or owner risk signatures.
- [x] Test stack `ENV=test-secres-tailwind`: API 8857, UI 5357, Maildev UI 1157, Postgres 5557, S3 9157, Obscura 9257, SMTP 1057; `ENV` last in every Make command.
- [x] Evidence directory `/home/antoinefa/src/radar-immobilier/tmp/security-residual-evidence/sol-tailwind`; ignored build artifacts and temporary Compose overrides are not committed.
- [x] Use temporary Compose volume mounts for nested UI/immo-mcp dependencies; disable install scripts and model keys; clean all dedicated volumes at completion.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**: `ui/package.json`, Make-regenerated `package-lock.json`, `ui/postcss.config.cjs`, `ui/tailwind.config.cjs`, `ui/src/app.css`, `ui/src/app.test.ts`, `plan/SECRES-BRANCH_chore-security-residuals-owner-fix.md`, `.security/findings/*`, `.security/vulnerability-register.yaml` (resolved with evidence only).
- [x] **Forbidden Paths (must not change in this branch)**: `Makefile`, `docker-compose*`, `rules/**`, `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.github/workflows/**`, `api/**`, source packages, other branch plans, all other worktrees/repositories.
- [x] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**: `ui/src/**/*.svelte`, `ui/src/**/*.test.ts`, `ui/src/main.ts`, `ui/src/main.test.ts`, `ui/src/lib/maps/maplibre-worker.ts`, `ui/vite.config.ts`, `ui/e2e-qa/**`, `ui/playwright.maplibre.config.ts`, `ui/nginx/default.conf`, `deploy/k8s/nginx/default.conf` under BR854-EX1; `package.json` under BR854-EX2.
- [x] **BR854-EX1**: owner approved geo 0.6.3 on 2026-10-12. Its engine requires named MapLibre 6 exports and application worker setup before maps mount. Its default raw worker imports a relative shared module, so use the helper's injected Vite worker loader. Add bounded startup/browser checks and serve JS assets without SPA fallback with `worker-src 'self'` in both nginx configurations. Impact: map initialization and worker hosting only; rollback: revert geo/worker/hosting hunks together, which restores the security blocker. No root checkout, other repository, live cluster or CI workflow edits.
- [x] **BR854-EX2**: strict installation resolved engine MapLibre 6.14.0 beside the application's 6.4.1. Strict dedupe fails ERESOLVE; an engine-only override leaves the peer resolver selecting 6.14.0 (retained `geo063-integration/dedupe.log` and `update-aligned.log`). Pin MapLibre globally to the same verified 6.4.1; this satisfies both published `^6.4.1` ranges and prevents renderer/worker mismatch without relaxing peers. Impact: one additional exact override; all existing overrides remain. Rollback: remove that line and regenerate through Make, restoring the mismatched-version blocker.
- [x] **BR854-EX3**: the new UI resolved an unnecessary nested geo-core 0.6.3 even though existing 0.6.1 satisfies its `^0.6.0` dependency. Keep UI geo-core at the same 0.6.1 as the existing engine override, scoped to `@sentropic/geo-ui-svelte`; API geo-core 0.1.2 remains unchanged. Impact: one scoped core override, no core API migration. Rollback: remove that object and regenerate through Make. Strict installation and full resolution comparison must pass.
- [x] **BR854-EX4**: keep regenerated dependency manifests/lockfile, initial branch plan and individual browser/CSS test files coherent when they exceed 150 changed lines. Other commits remain bounded and selectively staged. Impact: larger mechanically generated or indivisible review units; rollback: revert the relevant logical commit, never hand-edit partial dependency resolutions.

## Feedback Loop
- [x] `clarification`: owner chose correction before fusion; critical/high findings remain blocking, no temporary acceptance.
- [x] `attention`: v4 changes cascade layers, Preflight, palette, utility scale names, hover capability, space/divide selectors and minimum browser support (Safari 16.4, Chrome 111, Firefox 128); preserve measured styles and report visual UAT separately.
- [x] `attention`: inventory finds legacy `shadow-sm`, `rounded-sm`, `rounded`, `outline-none`, `space-y-*`, `divide-y` and semantic radar colors; no plugin or @apply migration is currently needed.
- [x] `attention`: geo 0.6.3 is now published; verify fresh tarballs, signatures and Sigstore before installation. Merge remains blocked until integration, critical/high audit, build, UI tests and attribution/worker browser checks pass; no risk acceptance is authorized.
- [x] `clarification`: browser causal probe found MapLibre's unlayered `position: relative` overriding Tailwind 4's layered absolute utility on local map hosts (height 0). Browser-only absolute positioning restored height 520 and selected the real Delson lot; use scoped absolute/inset CSS in both local map components and retain the host-height browser regression assertion.
- [x] `attention`: browser acceptance shares the dedicated nginx container's network namespace, avoiding host-interface changes from concurrent Docker stacks; external raster completion is a prerequisite before normal two-second UI assertions, and intentional raster aborts during gestures remain recorded.
- [x] `attention`: exact prior author model/effort is unavailable; retained `geo063-integration/REVIEW-SELECTION.md` records formal harness selection failure. Owner-requested Opus/Fable reviews are independent technical reviews and do not establish author-complementary consensus.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch**: coordinator owns tracked implementation; independent owner-requested Sol seats write only separate external evidence directories. No cherry-picks.
- [ ] **Multi-branch**: not selected.

## UAT Management (in orchestration context)
- [x] Coordinator alone organizes root UAT at stable `http://localhost:5301`; this seat must not touch root or claim visual validation without a browser.
- [ ] Coordinator verifies navigation, cards, forms/focus, map legends, responsive layouts, semantic themes and mobile hover behavior on the integrated exact patch.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read required project rules, #854 plan and harness skills; confirm clean worktree and exact parent SHA.
  - [x] Inspect Make gates, PostCSS/Tailwind configuration, global CSS and legacy utility usage; dedicated ports are free.
  - [x] Capture root audit JSON (13: 3 critical, 5 high, 2 medium, 3 low), dependency versions/integrity and baseline production CSS/build through Make.
  - [x] Select matching stable `tailwindcss` / `@tailwindcss/postcss` 4.3.3, verified registry integrity with lifecycle scripts disabled; replace JS configuration with CSS-native theme/source declarations.
  - [x] Preserve measured RGB palette through CSS theme tokens; rename small shadows/radii and outline utilities to their v4 equivalents; retain gray-200 base borders and pointer cursors.
- [x] **Lot 1 — Tailwind 4 migration**
  - [x] Select matching stable Tailwind/PostCSS releases; remove superseded autoprefixer and JS configuration; restrict content scanning to existing UI paths.
  - [x] Move semantic radar palette to CSS theme tokens and adapt necessary utilities/cascade defaults against baseline evidence.
  - [x] Regenerate the root lockfile through Make, verify #854 dependency resolutions/overrides preserved and no new advisory chain.
  - [x] Lot gate: six scoped CSS tests and bundle comparison pass; all 72 palette tokens match, no used utility missing; spacing/divider selector changes require coordinator UAT.
- [x] **Lot 2 — Gates & bounded handoff**
  - [x] Clean container installation; `make typecheck`, `make lint`, `make build`, `make smoke-ui-bundle`, `make test-ui`; all final exits 0; UI suite 1,661 passed and ten todo.
  - [x] Audit after: 13 to 6 findings, high 5 to 0, medium 2 to 0; 3 critical and 3 low remain; npm exit 1 / Make exit 2, no suppression.
  - [x] Mark eight proven Tailwind register entries resolved (two advisory rows aggregate into one npm package finding); retain every unrelated row and null signature.
  - [x] Check every diff hunk against scope; `make clean ENV=test-secres-tailwind` exits 0, dedicated volumes removed and no host dependencies remain.
  - [x] Handoff file inventory, versions, audit delta, gate exits and UAT checklist in the external evidence directory; MapLibre upstream blocker remains coordinator-owned; no merge-ready claim.
- [x] **Lot 3 — Owner-approved geo 0.6.3 integration**
  - [x] Verify exact publication identity, scripts, tarball SRI, npm signatures and Sigstore attestations.
  - [x] Install exact engine/UI 0.6.3 and MapLibre 6.4.1 through Make with strict peers and lifecycle scripts disabled; preserve all #854 overrides and unrelated resolutions.
  - [x] Use named MapLibre exports and await the fully bundled worker before application mount.
  - [x] Serve module/worker JS with correct MIME, missing assets as 404, and same-origin worker CSP in standalone and cluster configurations.
  - [x] Validate startup ordering, actual map/worker loading and inert hostile attribution in built browser assets; retain dependency tree and shipped asset hashes.
  - [x] Run fresh scoped checks followed by typecheck, lint, UI tests, build, bundle smoke and critical/high npm audit; reconcile independent Sol findings.
  - [x] Update security evidence and only proven resolved rows, retain null owner signatures; clean the dedicated test stack and hand off the exact patch. No merge or deployment.
- [ ] **Lot 4 — Owner-authorized publication and review**
  - [x] Record publication authorization and commit boundaries; baseline diff/new-file hashes exactly match the reviewed snapshot before documentation updates.
  - [x] Commit verified dependency manifests and generated lockfile; exact implementation bytes remain identical to the reviewed snapshot.
  - [x] Commit CSS-native Tailwind configuration and compatibility tests.
    - [x] Commit CSS-native configuration, preserved palette and removed superseded v3 configuration.
    - [x] Commit the six CSS compatibility checks.
  - [x] Commit component utility migrations in bounded groups.
    - [x] Commit signals and source review utility migrations.
    - [x] Commit map wrappers and opportunity views utility migrations.
    - [x] Commit shell and administration utility migrations.
  - [x] Commit MapLibre startup, named exports and unit-test adaptations.
  - [x] Commit worker hosting and browser acceptance harness.
    - [x] Commit same-origin worker CSP, JS MIME and missing-worker 404 parity.
    - [x] Commit real-engine/browser fixtures and browser assertions.
      - [x] Commit real-engine/native/provider fixtures and worker-ready entry points.
      - [x] Commit browser worker, attribution and remount assertions.
  - [ ] Commit proven security-register resolutions and findings.
  - [ ] Push a clean descendant to the unchanged PR #854 remote branch.
  - [ ] Verify new CI on the full pushed SHA and reconcile Opus/Fable technical reviews.
