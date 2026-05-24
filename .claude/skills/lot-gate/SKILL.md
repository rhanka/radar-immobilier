---
name: lot-gate
description: Run lot gate checks — typecheck, lint, and scoped tests for the current lot
paths: "plan/**"
allowed-tools: Read Bash Grep
---

# Lot Gate

Workflow skill to run the canonical lot gate sequence for the current lot in `plan/NN-BRANCH_<slug>.md`.

## Steps

1. **Read the branch plan**
   Identify:
   - Current lot number and name.
   - Components in scope (API, UI, packages, E2E).
   - Scoped test files listed in the gate checklist.
   - Branch environment slug (`ENV=test-<slug>`, `ENV=e2e-<slug>`).
   - Port allocation (`API_PORT`, `UI_PORT`, `MAILDEV_UI_PORT`).

2. **Typecheck in-scope components**
   ```bash
   make typecheck ENV=<branch-env>
   ```

3. **Lint in-scope components**
   ```bash
   make lint ENV=<branch-env>
   ```

4. **Scoped tests**
   - API: `make test-api SCOPE=tests/<file>.spec.ts ENV=test-<slug>`.
   - UI : `make test-ui SCOPE=tests/<file>.spec.ts ENV=test`.
   - E2E: `make test-e2e E2E_SPEC=tests/<file>.spec.ts API_PORT=<port> UI_PORT=<port> MAILDEV_UI_PORT=<port> ENV=e2e-<slug>`.
   Scoped first, then the sub-lot full run.

5. **Report**
   For each gate item:
   - PASS / FAIL.
   - On FAIL: first 20 lines of output.
   - On AI flaky: check against acceptance rule (non-systematic, at least one success on same commit). Document signature in the branch plan file.

6. **Update branch plan checkboxes**
   When the gate is fully green, mark the corresponding checkboxes `[x]` in the plan file.

## Rules

- NEVER mark a lot complete if any gate item is FAIL.
- NEVER amend tests with additive timeouts to mask failures.
- AI flaky tolerance is per-test, per-commit; documented explicitly.
