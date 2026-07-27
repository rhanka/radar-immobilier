# Docs: Record the geo/immo authority boundary in `rules/`

## Objective

Write the geo/immo authority boundary into `rules/` so it survives an agent
change: today `grep -rlin "geo" rules/` returns zero file, and the boundary only
lives in one agent's private memory.

## Scope / Guardrails

- Documentation-only branch: no code, no schema, no migration, no runtime
  surface is touched.
- No Docker stack, no `make test`, no `make lint`, no k8s action — the host runs
  other agents' stacks and the demo; a documentary change needs none of them.
- Worktree: `.claude/worktrees/agent-ad53255d10efcf588`; root `ENV=dev` stays
  untouched and no branch stack is started.
- Selective staging, atomic commit, merge commit only.
- All new text is English (`rules/MASTER.md` → *Language Policy*).
- The rule describes a boundary; it issues no instruction to the `geo` project
  and nothing is written into the `geo` repository.

## Branch Scope Boundaries (MANDATORY)

- **Allowed Paths (implementation scope)**:
  - `rules/geo-immo-boundary.md` (new — under `GEOIMMOBND-EX1`)
  - `rules/MASTER.md` (one reference line — under `GEOIMMOBND-EX1`)
  - `plan/GEOIMMOBND-BRANCH_docs-geo-immo-boundary-rule.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `PLAN.md`, `.track/**`, `.agents/**`
  - `api/**`, `ui/**`, `packages/**`, `radar/**`, `tools/**`, `e2e/**`
  - `docs/**`
  - `rules/**` except the two files listed above
  - `plan/**` except this branch file
- **Conditional Paths (allowed only with explicit exception)**:
  - `rules/**` — default forbidden per `rules/MASTER.md` → *Branch Scope
    Control*; opened for this lot by `GEOIMMOBND-EX1` only.
  - `api/drizzle/*.sql`, `.github/workflows/**`, cross-repo paths — none used.
- **Exception process**:
  - Declare `GEOIMMOBND-EXn` in `## Feedback Loop` before touching any
    conditional or forbidden path. Include reason, impact, and rollback.

## Feedback Loop

- [x] `GEOIMMOBND-EX1` — **`rules/**` is authorized for this lot.**
  Paths: `rules/geo-immo-boundary.md` (new), `rules/MASTER.md` (one added
  reference line in *Other Rules Files*).
  Reason: `rules/**` is forbidden by default (`rules/MASTER.md` → *Branch Scope
  Control*), and the whole purpose of this branch is to move the geo/immo
  boundary out of a single agent's memory into the repository rules — it cannot
  be done anywhere else. The formal mechanism exists (`BRxx-EXn` per
  `rules/MASTER.md` and `rules/conductor.md` → *User question / answer
  protocol*) and is followed here; the branch ID is `GEOIMMOBND`.
  Impact: additive only — one new rules file plus one reference line. No
  existing rule text is modified, reordered, or deleted; no code path is
  affected.
  Rollback: `git revert` of the single commit removes the new file and the
  reference line, returning `rules/` to its exact prior state.
- [x] `policy` — placement decision: a new `rules/geo-immo-boundary.md`
  referenced from `rules/MASTER.md` → *Other Rules Files*, because the repo
  convention is one file per concern listed there, and no existing file owns
  this concern (`sources.md` covers immo-internal scraping/adapter etiquette,
  `conductor.md` covers in-repo orchestration).
- [x] `policy` — the draft
  `tmp/spec-geo-immo-phaseb/rules/candidates/geo-immo-boundary.md` was reused
  for the authority split, the contract/provenance shape, and the homonym
  invariant; its Phase-B implementation specifics (`PhaseBDocumentSource/v1`,
  capture-job status, migration registry) and its prescriptions addressed to
  `geo` were dropped to keep the rule neutral, symmetric, and durable.

## Orchestration Mode (AI-selected)

- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: a single documentary artifact plus one reference line.

## UAT Management (in orchestration context)

- No UAT: no UI, API, or runtime surface is affected.

## Plan / Todo (lot-based)

- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/conductor.md`, `rules/sources.md`, and
        `plan/BRANCH_TEMPLATE.md` to follow the existing convention.
  - [x] Confirm the measured gap: `grep -rlin "geo" rules/` returns zero file.
  - [x] Read the candidate draft in `tmp/spec-geo-immo-phaseb/rules/candidates/`.
  - [x] Confirm the formal scope-exception mechanism (`BRxx-EXn`) exists and
        declare `GEOIMMOBND-EX1` before touching `rules/**`.

- [x] **Lot 1 — Boundary rule**
  - [x] Add `rules/geo-immo-boundary.md`: authority split, non-interference,
        cross-boundary contract `{schema, version, uri, sha256, join_key,
        vintage}`, homonym invariant.
  - [x] Add the two measured 2026-07 operational rules: a withdrawal travels
        with its key `{city_slug, zone_ref_canon_v1, reglement_number}`, and a
        withdrawal is cache-delayed while a deposit is immediate.
  - [x] State that `rules/` is authoritative for this boundary and that agent
        memories are not.
  - [x] Reference the new file from `rules/MASTER.md` → *Other Rules Files*.
  - [x] Lot gate: documentation-only diff — `git diff --stat` limited to the
        three declared paths. No stack, no `make test`, no `make lint`.

- [ ] **Lot 2 — PR**
  - [x] Push the branch and open the PR.
  - [ ] Merge held: an infrastructure migration is in progress; this branch does
        not merge on its own initiative.
