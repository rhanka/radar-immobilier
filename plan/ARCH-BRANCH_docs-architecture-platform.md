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
- [ ] **Lot 2 — Render with h2a Focus and open the local HTML page.**
- [ ] **Lot 3 — Verify Mermaid rendering, links and documentation diff.**

## Merge / Close
- [ ] Local documentation handoff; no production action or branch merge requested.
