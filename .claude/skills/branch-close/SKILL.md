---
name: branch-close
description: Close a branch — final validation, PR creation, merge, archive plan file
paths: "plan/**,PLAN.md"
allowed-tools: Read Write Bash Edit Glob Grep
---

# Branch Close

Workflow skill to close a branch through final validation, PR creation, merge, and archival of the plan file.

## Steps

1. **Verify all lots complete**
   - Read `plan/NN-BRANCH_<slug>.md` and confirm all lot checkboxes are `[x]` (except the last lot about to run).
   - All `## Feedback Loop` items are `acknowledged` / `clarification` / `cancelled` / `refuse` — no `blocked` / `attention` remaining.
   - Run the `scope-check` skill on the full diff to verify no unauthorized scope drift.

2. **Run final gate**
   ```bash
   make typecheck ENV=<branch-env>
   make lint ENV=<branch-env>
   make test ENV=test-<slug>
   make build ENV=<branch-env>
   make test-e2e API_PORT=<port> UI_PORT=<port> MAILDEV_UI_PORT=<port> ENV=e2e-<slug>
   ```

3. **Push branch and open PR**
   ```bash
   git push -u origin <type>/<slug>
   gh pr create --title "<branch title>" --body "$(cat plan/NN-BRANCH_<slug>.md)"
   ```
   PR body is the exact text of the branch plan (source of truth).

4. **Verify CI passes**
   ```bash
   gh run list --branch <type>/<slug> --limit 5
   ```
   Resolve failures before merging.

5. **Update `PLAN.md`**
   Mark the branch as `merged` in §1 and §3.

6. **Merge**
   ```bash
   gh pr merge <pr-number> --merge --no-delete-branch
   ```
   ONLY merge commit. NO squash, NO rebase merge. The branch is preserved.

7. **Archive the plan file**
   ```bash
   git mv plan/NN-BRANCH_<slug>.md plan/done/NN-BRANCH_<slug>.md
   make commit MSG="chore: archive plan file for <type>/<slug>"
   git push origin main
   ```

## Rules

- Do NOT delete the source branch.
- Do NOT use squash or rebase merge.
- Do NOT skip CI.
- If CI is flaky on a non-related test: document signature in the plan file, re-run, capture explicit user sign-off before merge.
