---
name: branch-init
description: Initialize a new branch with worktree, BRANCH.md from template, and environment setup
allowed-tools: Read Write Bash Glob
---

# Branch Init

Workflow skill to initialize a new branch with a clean worktree, a `plan/NN-BRANCH_<slug>.md` from the template, and a unique port mapping.

## Steps

1. **Pick the next branch number from `PLAN.md`** and the type (`feat` / `fix` / `chore` / `refacto` / `docs`).

2. **Create the worktree**
   ```bash
   git worktree add tmp/<slug> -b <type>/<slug> main
   ```

3. **Verify the branch**
   ```bash
   git -C tmp/<slug> branch --show-current
   ```
   Must output `<type>/<slug>`. Abort if mismatch.

4. **Read the template**
   Read `plan/BRANCH_TEMPLATE.md` in full. This is the formatting contract.

5. **Create the branch plan file**
   Write `plan/NN-BRANCH_<type>-<slug>.md` from the template with:
   - **Title**: feature name.
   - **Objective**: one or two sentences.
   - **Scope / Guardrails**: areas in scope, constraints.
   - **Branch Scope Boundaries**:
     - Allowed Paths: implementation globs.
     - Forbidden Paths: at minimum `Makefile`, `docker-compose*.yml`, `rules/**`, `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `plan/NN-BRANCH_*.md` (other branches).
     - Conditional Paths: sensitive paths requiring `BRxx-EXn`.
   - **Orchestration Mode**: mono-branch (default) or multi-branch with rationale.
   - **Plan / Todo**: lot-by-lot breakdown starting with Lot 0 (baseline).

6. **Allocate ports based on branch index**
   - `API_PORT=88<nn>` (e.g., 8801, 8802, …).
   - `UI_PORT=53<nn>` (e.g., 5301, 5302, …).
   - `MAILDEV_UI_PORT=11<nn>` (e.g., 1101, 1102, …).
   Record the allocation in the branch plan file (Lot 0). Check `PLAN.md` to avoid collisions with active branches.

7. **Commit**
   ```bash
   cd tmp/<slug>
   git add plan/NN-BRANCH_<type>-<slug>.md
   make commit MSG="chore: init branch plan for <type>/<slug>"
   ```

## Rules

- Write the branch plan AFTER worktree creation, never before.
- Never use `git add .` or `git add -A`.
- `ENV` must be last argument in all `make` commands.
- Follow `plan/BRANCH_TEMPLATE.md` structure exactly — no `###` headers, no prose dumps, checkbox-only tasks.
- The first iteration must be detailed: lot-by-lot tasks, file-level test lists, UAT checklists when UI is impacted.
