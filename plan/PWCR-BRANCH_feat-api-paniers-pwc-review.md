# Feature: PW-C Astra review corrections

## Objective
- [ ] Resolve every finding in both Astra PW-C reviews and deliver the corrected incremental bundle before resuming L5.

## Scope / Guardrails
- [x] Owner priority change interrupts L5. Keep its work isolated; no push.
- [x] Delivery prerequisite 37f21d3d; reuse PW-E c276209c receipt/budget fixes and qualified tests, without later PW-A/main/L5 imports.
- [x] Make only, ENV last; no environment-file reads, host Node or Python.
- [x] test-api-paniers-pwe / e2e-api-paniers-pwe; API 18935, UI 15935, Maildev 11935.
- [x] Shared Docker lock, one owned stack, down -v --remove-orphans, unlock.
- [x] Own commits <=150 lines, Conventional English subject <=72 characters, no body/trailer.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths: api/src/artifacts/**, api/tests/integration/pwcr-*.ts, tools/make/base-api-pwc-review*, plan/PWCR-BRANCH_feat-api-paniers-pwc-review.md, deploy/overlays/preprod/nginx/default.conf, ui/nginx/default.conf, deploy/k8s/nginx/default.conf.
- [x] Forbidden Paths: api/src/artifacts/write-intent-transaction.ts, api/drizzle/**, api/src/index.ts, Makefile, docker-compose*.yml, rules/**, agent bootstrap, other plans, .track/**.
- [x] Conditional Paths: none. PWCR-EX1: owner explicitly requires the deployed preprod nginx fix; impact exact PW routes only; rollback these location blocks.

## Feedback Loop
- [x] Read Astra A and B in full, including B's detailed root report; findings accepted and reproduced through discriminating tests.
- [x] L5 branch 9ff122f1 retained separately; its stacks are down and lock released.

## Orchestration Mode (AI-selected)
- [x] Mono-branch corrections, immediate PW-C bundle handoff, then merge into L5.

## UAT Management (in orchestration context)
- [x] Automated isolated qualification only; root dev/UAT remains untouched.

## Plan / Todo (lot-based)
- [ ] Lot 1: locked application status, receipt recovery and separate execution/revocation terminal HTML.
- [ ] Lot 2: active preprod nginx routes, HTTPS public origin, mandatory P instance/CSRF.
- [ ] Lot 3: served page/script/CSP, targeted pre-read and coherent post-receipt refresh.
- [ ] Lot 4: strict listener response projection and browser identity/intent validation.
- [ ] Lot 5: preserve uncertain prepare keys and manual Retry-After budgets.
- [ ] Lot 6: unit/PG/API/proxy tests, discriminating mutations, audited bundle and French report.
