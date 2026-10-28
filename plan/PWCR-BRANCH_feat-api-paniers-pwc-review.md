# Feature: PW-C Astra review corrections

## Objective
- [x] Resolve every finding in both Astra PW-C reviews and deliver the corrected incremental bundle before resuming L5.

## Scope / Guardrails
- [x] Owner priority change interrupts L5. Keep its work isolated; no push.
- [x] Delivery prerequisite 37f21d3d; reuse PW-E c276209c receipt/budget fixes and qualified tests, without later PW-A/main/L5 imports.
- [x] Make only, ENV last; no environment-file reads, host Node or Python.
- [x] test-api-paniers-pwe / e2e-api-paniers-pwe; API 18935, UI 15935, Maildev 11935.
- [x] Shared Docker lock, one owned stack, down -v --remove-orphans, unlock.
- [x] On this shared host, also reserve the existing Sentropic E2_LOCK through a read-only descriptor; release it over any foreign live stack so its cleanup can proceed.
- [x] Own commits <=150 lines, Conventional English subject <=72 characters, no body/trailer.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths: api/src/artifacts/**, api/tests/integration/pwcr-*.ts, tools/make/base-api-pwc-review*, plan/PWCR-BRANCH_feat-api-paniers-pwc-review.md, deploy/overlays/preprod/nginx/default.conf, ui/nginx/default.conf, deploy/k8s/nginx/default.conf.
- [x] Forbidden Paths: api/src/artifacts/write-intent-transaction.ts, api/drizzle/**, api/src/index.ts, Makefile, docker-compose*.yml, rules/**, agent bootstrap, other plans, .track/**.
- [x] Conditional Paths: none. PWCR-EX1: owner explicitly requires the deployed preprod nginx fix; impact exact PW routes only; rollback these location blocks.
- [x] PWCR-EX2: update api/tests/integration/pwe-app-receipt.spec.ts's superseded post-commit revoke expectation; no business-rights checks removed; rollback the assertion only.
- [x] PWCR-EX3: update api/tests/integration/pw-write-authority-rights.spec.ts for the two public technical execution/revocation fields required by Astra B4; exact no-business-data equality and all revoke guards retained; rollback these expected fields only.

## Feedback Loop
- [x] Read Astra A and B in full, including B's detailed root report; findings accepted and reproduced through discriminating tests.
- [x] L5 branch 9ff122f1 retained separately; its stacks are down and lock released.

## Orchestration Mode (AI-selected)
- [x] Mono-branch corrections, immediate PW-C bundle handoff, then merge into L5.

## UAT Management (in orchestration context)
- [x] Automated isolated qualification only; root dev/UAT remains untouched.

## Plan / Todo (lot-based)
- [x] Lot 1: locked application status, receipt recovery and separate execution/revocation terminal HTML.
- [x] Lot 1 implementation: status computed under I lock; authorized committed receipt survives revocation; terminal HTML has no confirm button.
- [x] Lot 2: active preprod nginx routes, HTTPS public origin, mandatory P instance/CSRF.
- [x] Lot 2 implementation: preprod locations, canonical Host HTTPS and timing-safe private P proof checks.
- [x] Lot 3: served page/script/CSP, targeted pre-read and coherent post-receipt refresh.
- [x] Lot 3 implementation: authenticated content composition serves exact PW bytes/hash and reuses BASE state/search readers under the selected workspace.
- [x] Lot 4: strict listener response projection and browser identity/intent validation.
- [x] Lot 4 implementation: closed envelopes and canonical app document links; real listener/H5/BASE contract test added.
- [x] Lot 5: preserve uncertain prepare keys and manual Retry-After budgets.
- [x] Lot 5 implementation: retry refusal retains the original body/key; Retry-After persists the later manual deadline.
- [x] Lot 6: unit/PG/API/proxy tests, discriminating mutations, audited bundle and French report.

## Qualification closure
- [x] Required unit/PostgreSQL: 369 passed, zero failed/skipped; API CI: 4532 passed, zero failed, 76 unrelated conditional skips.
- [x] Typecheck, lint, build and CT-8 fresh/upgrade reruns pass; three real nginx routes pass without skips.
- [x] All 136 campaign entries killed and byte-restored: PWA 31, PWB 5, PWD 7, PWC 25, PWE 52, review 16.
- [x] Final mutation campaign 20261028T043555-mutations passes with down -v and both locks released.
- [x] Completed API commands precede the later foreign interruption; runtime/dependency/configuration tree equality is checked by pwcr-proof.
- [x] Qualified bundle is gated by current-HEAD proof and audited from the base-only prerequisite; root French report delivered separately.
