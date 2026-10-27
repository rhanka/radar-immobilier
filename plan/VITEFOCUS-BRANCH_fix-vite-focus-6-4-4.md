# Feature: Fix the Focus Vite and DOMPurify advisories

## Objective
Resolve GHSA-587h-7wmj-h5pm in Focus with Vite 6.4.4, then resolve GHSA-cg2g-xh64-v4q7 and GHSA-mrv2-3pqr-j5jr in the root and Focus trees with DOMPurify 3.4.17.

## Scope / Guardrails
- Follow the owner's Vite and `consigne-sol-dompurify.md` assignments; no push or merge.
- Use Make targets and containers; never read environment files or run Python.
- Each lockfile change must affect only the requested package; stop on any unrelated npm change or disk space below 10 GiB.
- Run one Docker campaign at a time and remove its containers afterward.
- Commit through a local recovery repository; keep the shared Git directory read-only.
- Keep each commit at or below 150 changed lines, with an English Conventional Commit subject only.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `package.json`
  - `package-lock.json`
  - `docs/architecture/focus/package.json`
  - `docs/architecture/focus/package-lock.json`
  - `docs/architecture/focus/render-mermaid.mjs`
  - `.security/findings/2026-10-21-vite-ghsa-587h.md`
  - `.security/findings/2026-10-24-dompurify-ghsa-cg2g.md`
  - `plan/VITEFOCUS-BRANCH_fix-vite-focus-6-4-4.md`
  - `RAPPORT-SOL-VITE-FOCUS.md` (owner-requested delivery receipt, outside the bundle)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - Other branch plans, application code, and generated documentation
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - None.
- **Exception process**:
  - Record reason, impact, and rollback here before expanding scope.
  - VITEFOCUS-EX1: the owner's DOMPurify assignment extends scope to both root manifests and its finding. Impact: exact override and DOMPurify resolution only. Rollback: revert the DOMPurify commits; Vite 6.4.4 remains intact.
  - VITEFOCUS-EX2: Focus reads Mermaid's prebundled runtime, which embeds affected DOMPurify 3.4.12 and ignores the dependency override. The requested fix requires bundling Mermaid's core module against installed DOMPurify instead. Impact: renderer build tooling only, unchanged dependency inventory. Rollback: revert the renderer commit, restoring the affected embedded copy.

## Feedback Loop
- [x] The owner's delivery instruction overrides the generic commit-trailer requirement.
- [x] The French delivery report follows the owner's explicit language instruction.
- [x] Build tooling adaptations belong to temporary Makefiles; no project Makefile changes.
- [x] DOMPurify audits are clear; the root's separate body-parser/Zod high findings still block merging and have no risk acceptance.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, sequential verification and local bundle delivery.
- [ ] Multi-branch.

## UAT Management (in orchestration context)
- [x] Dependency patch only; automated checks run in this worktree without starting root UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read the assignment, master, workflow, security, and testing rules.
  - [x] Confirm `fix/vite-focus-6-4-4` at `3ffd7fd7a96aeaea9844a93d3ce44620733c443b`.
  - [x] Snapshot the lockfile and run the read-only baseline audit.
  - [x] Use `ENV=test-vite-focus` as the last Make argument.
  - [x] No application services or API/UI/Maildev ports; isolated Chromium uses port 9238.
- [x] **Lot 1 — Dependency patch**
  - [x] Pin the Focus Vite declaration to exactly 6.4.4.
  - [x] Regenerate through the existing containerized `deps` target.
  - [x] Prove equal package counts and no changes outside the Vite declaration and resolution.
- [x] **Lot 2 — Verification and security record**
  - [x] Run the existing Focus build and test targets in containers.
  - [x] Rescan without changing manifests; report remaining findings separately.
  - [x] Update the Vite finding with observed Focus verification.
- [x] **Lot 3 — Delivery**
  - [x] Create selective, bounded commits in the recovery repository.
  - [x] Create a bundle excluding the exact supplied base and audit it in a fresh repository.
  - [x] Write the French report with commit SHA, bundle path, and SHA-256.
  - [x] Clean up campaign containers; do not push.
- [x] **Lot 4 — DOMPurify patch**
  - [x] Resume the recovery repository above `6dccb58892629c6f0b6f92f29103407c308b64fe`.
  - [x] Set root override and Focus direct dependency to exactly 3.4.17.
  - [x] Regenerate via containerized Make targets; prove stable entry counts and no unrelated changes.
  - [x] Remove the renderer's use of Mermaid's embedded DOMPurify 3.4.12; verify it bundles the installed sanitizer.
- [x] **Lot 5 — DOMPurify verification**
  - [x] Audit both trees without modifying manifests; list all remaining findings.
  - [x] Run CI quality commands: typecheck, lint, API/UI builds, bundle smoke, all workspace unit/integration tests.
  - [x] Run Focus tests and complete Mermaid/HTML/PDF build.
  - [x] Record advisories, Mermaid dependency paths, exposure, remediation, and observed verification.
  - [x] Use `ENV=test-dompurify`, one Compose project, one test worker, no published application ports.
- [x] **Lot 6 — DOMPurify delivery**
  - [x] Create bounded subject-only commits and a bundle excluding `3ffd7fd7a96aeaea9844a93d3ce44620733c443b`.
  - [x] Audit the bundle in a fresh repository seeded only with the base; compare trees and delivered files.
  - [x] Append the French delivery receipt with final SHA and bundle SHA-256.
  - [x] Restore generated documents and remove campaign containers/volumes with `down -v --remove-orphans`.
