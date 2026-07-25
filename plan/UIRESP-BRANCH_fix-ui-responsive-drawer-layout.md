# Feature: Responsive Drawer layout for mobile/tablet

## Objective
Make the radar-immobilier UI usable on smartphone (390px) and tablet (768px) by converting fixed-width sidebar rails into DS Drawer components below 900px, fixing horizontal overflow on tables, constraining map overlays, and removing dead code.

## Scope / Guardrails
- Scope limited to ViewLayout responsive behavior, table overflow wrappers, map overlay constraints, and TopBar dead code removal.
- Quick wins only (spec §5.1) — no structural moves (§5.2), no AppShell migration, no DataTable, no palette token bascule.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/radar-immobilier` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development in repository-local worktree `./tmp/ui-responsive-drawer`.
- All new text in English. Discussions with the user may be in French.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `ui/src/lib/components/ViewLayout.svelte`
  - `ui/src/lib/components/TopBar.svelte` (deletion)
  - `ui/src/lib/components/sources-map/SourceConsole.svelte` (table wrapper only)
  - `ui/src/lib/components/reconciliation/ReconciliationView.svelte` (table wrapper only)
  - `ui/src/lib/components/admin/AdminView.svelte` (table wrapper only)
  - `ui/src/lib/components/maps/EvaluationMapView.svelte` (table wrapper only)
  - `ui/src/lib/components/maps/GeoCityMapBase.svelte` (overlay max-width only)
  - `plan/UIRESP-BRANCH_fix-ui-responsive-drawer-layout.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/*` (except this branch file)

## Feedback Loop
(none yet)

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- Rationale: All 4 changes are small, orthogonal quick wins on a single branch.

## Plan / Todo (lot-based)

- [x] **Lot 0 — Baseline & constraints**
  - [x] Read spec `docs/spec/STUDY_UI_CONVERGENCE_RESPONSIVE_2026-07.md` (§4.2, §5.1).
  - [x] Confirm worktree `./tmp/ui-responsive-drawer` on branch `fix/ui-responsive-drawer-layout`.
  - [x] Confirm Drawer DS API from LotFichePanel (props: open, title, description, side, closeLabel, onclose, snippet children).
  - [x] Confirm scope and guardrails.

- [x] **Lot 1 — ViewLayout responsive Drawers** (THE lever)
  - [x] Add matchMedia(max-width: 899px) reactive detection to ViewLayout.svelte.
  - [x] Import Drawer from @sentropic/design-system-svelte.
  - [x] Desktop (>=900px): keep current layout unchanged.
  - [x] Mobile/Tablet (<900px): replace left aside with Drawer side="left", right aside with Drawer side="right".
  - [x] Add floating toggle buttons (left/right) visible only <900px to open each Drawer.
  - [x] Add optional props: controlsDrawerTitle, selDrawerTitle for Drawer labels.
  - [x] Lot gate: `make typecheck` (only pre-existing errors), `make lint` (exit 0).

- [x] **Lot 2 — Table overflow-x-auto wrappers**
  - [x] SourceConsole.svelte: changed `overflow-y-auto` to `overflow-auto` on table container.
  - [x] ReconciliationView.svelte: changed `overflow-hidden` to `overflow-auto` on table container.
  - [x] EvaluationMapView.svelte: wrapped table in `overflow-x-auto` div.
  - [x] AdminView.svelte: already has `overflow-auto` — no change needed.

- [x] **Lot 3 — Overlay max-width + repli under 480px**
  - [x] GeoCityMapBase.svelte: added `flex-wrap` to segment toggle buttons (Province/Ville/Zone) so they wrap on narrow viewports instead of overflowing.
  - [x] Overlay containers already have `max-w-[calc(100%-1.5rem)]` and `max-w-xs` — sufficient now that map is full-width on compact.

- [x] **Lot 4 — Delete TopBar.svelte (dead code)**
  - [x] Verified zero imports/references (grep across ui/src/ and e2e-qa/).
  - [x] Deleted `ui/src/lib/components/TopBar.svelte` (48 lines, sole user of Header DS).

- [x] **Lot 5 — QA Playwright headless**
  - [x] Playwright headless (chromium 149.0, NOT port 9222) at 3 viewports x 2 views = 6 tests.
  - [x] ALL PASS: 0 horizontal overflow at all viewports.
  - [x] `make lint` exit 0.

## QA Results (Playwright headless, chromium, 2026-07-25)

| Viewport | View | scrollW | viewW | Overflow | Left toggle | Right toggle | Drawers open | Asides inline |
|---|---|---|---|---|---|---|---|---|
| 390×844 | Signaux | 390 | 390 | 0 | YES | YES | L+R OK | 0 |
| 390×844 | Sources | 390 | 390 | 0 | YES | YES | L+R OK | 0 |
| 768×1024 | Signaux | 768 | 768 | 0 | YES | YES | L+R OK | 0 |
| 768×1024 | Sources | 768 | 768 | 0 | YES | YES | L+R OK | 0 |
| 1440×900 | Signaux | 1440 | 1440 | 0 | no (desktop) | no (desktop) | n/a | 2 |
| 1440×900 | Sources | 1440 | 1440 | 0 | no (desktop) | no (desktop) | n/a | 2 |
