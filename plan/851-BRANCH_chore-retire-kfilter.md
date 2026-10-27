# Feature: Retire Python from preprod manifest filtering

## Objective
- [ ] Replace the Python manifest filter with byte-preserving jq filtering (#851, #810).

## Scope / Guardrails
- [x] Worktree: `tmp/kfilter-851`; branch: `chore/851-retire-kfilter`.
- [x] Never read `.env`; use the isolated `tmp/kfilter-851.mk` entrypoint.
- [x] No push, cluster mutations, Docker stack, or application changes.
- [x] Make commands end with `ENV=test-kfilter-851`; no ports are used.
- [x] Commits: at most 150 changed lines; English subjects, no body/trailer.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths: `deploy/ci/kfilter*`, `deploy/ci/fixtures/kfilter/**`.
- [x] Allowed Paths: `deploy/ci/reconcile-preprod*.sh`, `deploy/ci/check-no-python.sh`.
- [x] Allowed Paths: `deploy/ci/README.md`, this plan, `RAPPORT-SOL-KFILTER.md`.
- [x] Forbidden Paths: `Makefile`, `docker-compose*.yml`, `rules/**`, agent entrypoints, other plans.
- [x] Conditional Paths: `.github/workflows/ci.yml`, released by BR851-EX1.

## Feedback Loop
- [x] BR851-EX1: owner requests a deploy Python CI guard; modify only CI quality steps. Impact: reject `.py` paths under `deploy/`; rollback: revert the added steps.
- [x] Shared Git metadata is read-only; owner authorizes a repo-local rescue repository and audited bundle.

## Orchestration Mode (AI-selected)
- [x] Single branch, sequential implementation; independent review per harness availability.

## UAT Management (in orchestration context)
- [x] No UI impact; no UAT stack required; root checkout stays untouched.

## Plan / Todo (lot-based)
- [x] Lot 0: read required rules, inspect old filter, reconcile, tests and CI.
- [x] Lot 1: replace and delete Python; preserve text, object selection and fields.
- [x] Lot 2: frozen fixtures, 4 newline variants and independent full-render oracle.
- [ ] Lot 3: deny Python in deploy, update reconcile tests, README and CI.
- [ ] Lot 4: scoped shell tests, preprod render, diff audit and review evidence.
- [ ] Lot 5: atomic rescue commits, French report and verified portable bundle.
