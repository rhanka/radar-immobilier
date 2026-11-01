# Feature: UI service worker and local store continuity

## Objective
Deliver TODAY items (b) and (c) of POSITION IMMO (2026-11-01): coordination-only
UI worker and targeted local store sync. The DS/H5 kit belongs to another branch.

## Scope / Guardrails
- Use the owner-provided `.worktrees/ui-sw`, branch `feat/ui-sw-store-sync`.
- Make only; ENV last; no Python, environment-file reads or kubeconfig access.
- No deployment. No trailer or AI attribution in commits (owner instruction).
- Test stacks: `test-ui-sw` and `test-ui-continuity-e2e`; no published ports.
- Browser fixture binds only to a random container-loopback port.
- Every campaign tears down its own stack with `down -v`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `ui/public/immo-sw.js`, `ui/src/lib/sw/**`, `ui/src/lib/sync/**`
  - `ui/src/{App.svelte,main.ts,vite-env.d.ts}`
  - `ui/src/lib/{state/beta.ts,chat/chat-widget-layout.ts,router/router.ts}`
  - `ui/src/lib/auth/auth-store.ts` (invalidation and stale-response guard only)
  - `ui/src/lib/auth/auth-store.test.ts` (delayed-response regression)
  - `ui/src/lib/components/{chat/ChatWidgetHost.svelte,maps/SignauxMapView.svelte,workspace/ContextResume.svelte}`
  - `ui/e2e-real/ui-sync*`, this branch plan, `docs/operations/ui-continuity.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`, agent entrypoints
  - Other branch plans; DS/H5 implementation; `deploy/cutover/**`, `tools/make/cutover*`
- **Conditional Paths (allowed only with explicit exception)**:
  - `ui/{Dockerfile,vite.config.ts}`, nginx variants and header parity check
  - `tools/ui-continuity.*` (isolated verification entrypoint)
- **Exception process**: declare rationale, impact and rollback below before edits.

## Feedback Loop
- UISW-EX1: Dockerfile/Vite build stamps distinct client and worker identities and
  supports kill bytes at the stable URL. Build-only impact; rollback by old image.
- UISW-EX2: consume `fix/preprod-nginx-worker-csp` via merge, preserving current
  preprod proxy routes; add SW serving to all three nginx variants and parity.
  Static-serving impact only; rollback by old configuration.
- UISW-EX3: standalone Make/compose verification wrapper avoids `.env` reads,
  keeps dependencies in named volumes, invokes the existing real-stack E2E runner.
  No host ports or production effects; remove the wrapper to roll back.
- Navigation adoption needs router methods to update geographic/hash views
  coherently; isolated `.set()` of activeRouteView is forbidden.
- Review runs in this session: owner forbids workflow/background agents.

## Orchestration Mode (AI-selected)
- [x] Single branch; execute all work directly in this session.

## UAT Management (in orchestration context)
- Root UAT remains unchanged; qualification uses isolated synthetic test stacks.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read rules and inherited diff; retain correct build/bootstrap work.
  - [x] Consume prepared preprod worker CSP correction with a merge commit.
- [ ] **Lot B — Coordination worker**
  - [x] Image stamping and disabled-build kill bytes at the stable worker URL.
  - [x] Nonblocking client registration, stopped-worker reconnect and update API.
  - [x] Worker validates browser clients and probes the complete live client set.
  - [x] Embedded wire/state contracts and preprod-only runtime gate.
  - [ ] Closed protocol, browser-client validation, handshake and reconnect.
  - [ ] Compatible update, targeted invalidation, kill switch and build identities.
  - [ ] Three nginx variants: JS, no-cache, 404, security-header inheritance.
- [ ] **Lot C — Local state sync**
  - [x] Svelte preference integration keeps chat layout, basemap and route ownership.
  - [x] Per-tab context engine, session epochs and explicit adoption guards.
  - [x] Storage-failure boundary and same-origin invalidation channel.
  - [x] Bounded context projection and fail-closed version validation.
  - [x] Stable scalar codecs and receive-without-write preference adapter.
  - [ ] Four stable scalar preferences; codecs, Svelte adapters, no receive rewrite.
  - [ ] Versioned bounded contexts, explicit adoption, session isolation.
  - [ ] Unknown schemas preserved; storage failures degrade without retries.
- [ ] **Lot T — Verification**
  - [x] Session/context isolation unit regressions; delayed auth response rejected.
  - [ ] UI unit tests, codec/adapter/isolation regressions and scoped legacy tests.
  - [ ] Typecheck, lint, API and MCP tests.
  - [ ] Playwright: two tabs, N/N-1/N+1, refusal, reconnect, rollback, kill.
- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Operating procedure and French report at the requested conductor path.
- [ ] **Lot N — Delivery**
  - [ ] Push branch, open English PR, record full head SHA and CI state.
  - [ ] Merge remains the owner's action; preserve branch.
