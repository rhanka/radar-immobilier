# Feature: Cross-repository architecture map

## Objective
- [x] Document immo, geo and poc-k8s components, access and current processing boundaries.

## Scope / Guardrails
- [x] Documentation only; no deployment, data mutation or application changes.
- [x] Worktree: `tmp/architecture-platform`, branch `docs/architecture-platform`.
- [x] Commands through Make; environment argument last; no application stack started.
- [x] Root checkout and other repositories remain unchanged.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `docs/architecture.md`
  - `docs/architecture/**`
  - `plan/ARCH-BRANCH_docs-architecture-platform.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.track/**`
  - Other branch plans; application, infrastructure and other repositories.
- **Conditional Paths**:
  - None.

## Feedback Loop
- [x] Use current remote immo/geo references and newer poc-k8s local HEAD; record provenance.
- [x] Distinguish live reads, declared configuration and future work.
- [x] Record the live OVH refresh / committed MinIO grounding destination mismatch.
- [x] Use the installed h2a FocusSnapshot renderer; document preview has no Track writes.

## Orchestration Mode (AI-selected)
- [x] Single documentation branch; no delegated implementation.

## UAT Management (in orchestration context)
- [x] Standalone local documentation preview; existing application UAT is unaffected.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Read rules, inventory sources and establish scope.**
- [x] **Lot 1 — Architecture diagrams and evidence register.**
- [x] **Lot 2 — Render with h2a Focus and open the local HTML page.**
- [x] **Lot 3 — Verify Mermaid rendering, links and documentation diff.**
  - [x] Scope check and static syntax checks pass; all four diagrams render in Chromium.
  - [x] Browser checks: zoom, full-screen, Escape, seven navigation links; no page overflow at 1440px/390px.
- [x] **Lot 4 — Owner feedback: PV ownership and refactoring baseline.**
  - [x] Compare September full-auto design and current Graphify CAS work, not only the June refresh study.
  - [x] Show all four stages inside Immo ownership, the direct deterministic PG feed and atomic canonical projection.
  - [x] Distinguish the deployed paths from E1–E5 target and Geo's geographic contribution.
  - [x] Regenerate Focus HTML; Chromium renders four diagrams with zoom/full-screen/Escape and no desktop/mobile page overflow.
- [ ] **Lot 5 — Reconcile infrastructure and processing resource identities.**
  - [x] Obtain the owner-requested independent Gemini 3.8 High review via h2a run agy; verdict NEEDS CHANGES at 2ab8da2b.
  - [x] Add environment-qualified store identities and the live Geo PDF reader to the infrastructure overview.
  - [x] Map each Immo DB and object-store role to environment-qualified shared identifiers in both diagrams.
  - [x] Verify reader/writer arrows against source and whitelisted deployment configuration.
  - [x] Reuse Geo bucket/API identities in diagram 3; distinguish shared PDF reads from preprod normalized products.
  - [x] Regenerate Focus; verify 16 shared resource identities and all four diagrams in Chromium.
  - [x] Confirm the resource check rejects baseline 73762926 and passes the corrected document.
  - [ ] Reconcile independent findings against main and runtime; do not promote declared legacy Jobs to active paths.
- [ ] **Lot 6 — Owner feedback: effective storage and eradication status.**
  - [x] Re-fetch main, check migration PRs and re-audit whitelisted live preprod bindings; #670 remains draft, MinIO still configured for API.
  - [ ] Obtain OVH production read-only evidence; never substitute the legacy SCW cluster.
  - [ ] Exclude unobserved legacy paths from operational diagrams and regenerate Focus.
  - [x] Remove unobserved SCW/grounding templates and unverified production storage from diagrams 1–2; keep live MinIO API bindings.

## Merge / Close
- [ ] Local documentation handoff; no production action or branch merge requested.
