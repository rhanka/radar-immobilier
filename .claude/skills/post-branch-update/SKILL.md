---
name: post-branch-update
description: Update rules and skills after a branch merges — absorb learnings, refine patterns
paths: "PLAN.md,plan/done/**,rules/**"
allowed-tools: Read Write Edit Bash Grep Glob
---

# Post-Branch Update

Run this after a branch is merged to keep `rules/` and `.claude/skills/` current with the latest patterns.

## Steps

1. **Identify what the branch changed**
   ```bash
   git log main~10..main --oneline --stat | head -60
   ```

2. **Check whether rules need updating**
   - **API patterns** (new service, new route convention) → `rules/MASTER.md` or a new sub-rule.
   - **Source adapter conventions** (new adapter shape, new scraping pattern) → `rules/sources.md`.
   - **Scoring evolutions** (new criterion, new evidence shape) → `rules/scoring.md`.
   - **Test patterns** (new helpers, new fixtures) → `rules/testing.md`.
   - **Workflow changes** (new make targets, new env conventions) → `rules/workflow.md`.
   - **Incident learnings** (bugs caused by missing rules) → add a WARNING block to the relevant rule with the date and root cause.

3. **Check whether skills need updating**
   - New make targets → update `lot-gate` and `branch-close` skills.
   - New radar-specific operation → add a new skill in `.claude/skills/`.
   - Deprecated commands → prune from all skills.

4. **Context budget**
   - `rules/MASTER.md` must stay readable in one view (target < 200 lines).
   - Sub-rules should focus on a single domain (< 150 lines).
   - If a rule grows too large, split into a sub-rule with narrower `paths:`.

5. **Update `PLAN.md`**
   - Move the branch to `merged` in §1 and §3.
   - Reorder remaining branches if dependencies changed.
   - Note any new branches spawned from learnings.

6. **Commit**
   ```bash
   git add rules/ .claude/skills/ PLAN.md
   make commit MSG="chore: post-branch rules + skills update after <branch-name>"
   ```
