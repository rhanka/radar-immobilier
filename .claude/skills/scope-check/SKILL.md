---
name: scope-check
description: Verify modified files against branch allowed/forbidden/conditional paths
paths: "plan/**"
allowed-tools: Read Bash Grep Glob
---

# Scope Check

Workflow skill to verify that modified files respect branch scope boundaries declared in `plan/NN-BRANCH_<slug>.md`.

## Steps

1. **Read scope boundaries**
   Parse the `## Branch Scope Boundaries (MANDATORY)` section and extract:
   - **Allowed Paths**: globs where implementation is permitted.
   - **Forbidden Paths**: globs that must not be modified.
   - **Conditional Paths**: globs that require a `BRxx-EXn` exception.
   Also extract any declared exceptions from `## Feedback Loop`.

2. **Get modified files**
   ```bash
   git diff --name-only HEAD~1     # committed
   git diff --cached --name-only   # staged
   git diff --name-only            # unstaged
   ```
   Deduplicate.

3. **Classify each file**
   For each file, match against scope in order:
   - **Allowed** → `OK`.
   - **Forbidden** → `VIOLATION`.
   - **Conditional**:
     - Exception declared (`BRxx-EXn` with rationale + impact + rollback) → `OK (exception BRxx-EXn)`.
     - No exception → `VIOLATION (missing exception)`.
   - **No match** → `WARNING (unknown path)`.

4. **Report**
   ```
   | File                                  | Status                  | Detail                   |
   |---------------------------------------|-------------------------|--------------------------|
   | api/src/services/foo.ts               | OK                      | Allowed: api/**          |
   | Makefile                              | VIOLATION               | Forbidden                |
   | api/drizzle/0042.sql                  | OK (exception BR04-EX1) | Conditional with except. |
   | scripts/deploy.sh                     | WARNING                 | Unknown path             |
   ```

5. **If any VIOLATION**: stop. Either revert the file, or declare a `BRxx-EXn` exception in the plan file and re-run.

## Rules

- Run this skill before every commit on branches with sensitive scope.
- Conductor MUST run this before parallel sub-agent dispatch.
- Unknown paths (`WARNING`) are not blocking but should be added to Allowed (or removed) explicitly.
