---
description: "Branching, commits, PR, orchestration workflow for radar-immobilier"
paths: ["plan/**", "PLAN.md", "BRANCH.md"]
tags: [workflow]
---

# Workflow

## Branching model

- Single integration branch: `main`.
- All work happens on feature/chore/fix branches with the `<type>/<slug>` convention:
  - `feat/<slug>` — new feature or capability.
  - `chore/<slug>` — repo plumbing, infra, scaffolding.
  - `fix/<slug>` — bug fix.
  - `refacto/<slug>` — pure refactor with no behavior change.
  - `docs/<slug>` — documentation only.
- Branch numbering follows `PLAN.md` (`BR-NN`); the corresponding plan file is `plan/NN-BRANCH_<type>-<slug>.md`.

## Branch lifecycle

1. Conductor (human or agent) picks the next branch from `PLAN.md` §5 scheduling.
2. Create repository-local worktree: `git worktree add ./tmp/<slug> -b <type>/<slug> main`.
   Do not use system `/tmp` for branch worktrees.
3. Author / refine `plan/NN-BRANCH_<slug>.md` from `plan/BRANCH_TEMPLATE.md`.
4. Execute lots in order; each lot ends with its lot gate (`typecheck`, `lint`, `test`, optional `test-e2e`).
5. UAT when the branch impacts UI: present it on the **root checkout** at the
   fixed dev ports (stable URL `http://localhost:5301`), never on a per-branch
   worktree port. See `rules/MASTER.md` → *UAT Environment* and `rules/conductor.md`.
6. Push branch; verify CI green.
7. Merge via **merge commit** (no squash, no rebase merge); leave the branch alive.
8. Move `plan/NN-BRANCH_<slug>.md` to `plan/done/`.

## Commit conventions

- Subject: `type(scope): description` — single line, ≤ 72 chars when possible.
- Types: `feat`, `fix`, `chore`, `refacto`, `docs`, `test`, `ci`.
- Body (optional) wraps at 72 chars; explain the *why*.
- Footer always includes `Co-Authored-By: <Agent Name> <noreply@…>` when an agent contributed (handled by `make commit MSG=...`).

## Atomic commit rules

- One logical change per commit.
- Max 150 lines / 10–15 files per commit.
- Selective staging only: `git add <path1> <path2>`. NEVER `git add .` / `-A`.
- Update `BRANCH.md` checkboxes in the same commit as the work it tracks.

## PR / merge

- Open PR with the branch name as title; body describes what changed and which lot is closed.
- CI green is mandatory before merge.
- When verifying GitHub Actions through connector/API tooling, use the full 40-character head SHA, not an abbreviated SHA. The workflow-run helper may return no runs for short SHAs and is scoped to pull-request-triggered runs; an empty result is not proof that Actions did not run. Cross-check the GitHub Actions UI or `gh` before bypassing CI.
- Merge commit is the only allowed strategy (sentropic policy inherited).
- After merge, do NOT delete the source branch.

## Cross-repo work

- Changes to `../poc-k8s/`, `../sentropic/`, `../graphify/` require an explicit `BRxx-EXn` exception in the branch file.
- Open a separate PR in the target repo; reference the radar branch in the PR body.

## Roadmap maintenance

- After every merge, update `PLAN.md` §1 with the new state (merged / active / pending).
- If a branch is reordered or its scope changes substantially, update `PLAN.md` §3 catalog accordingly.
- Status updates go at the top of `PLAN.md` with a date stamp.
