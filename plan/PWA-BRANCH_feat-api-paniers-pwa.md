# Feature: PW-A write authority qualification

## Objective
Qualify and correct the uncommitted PW-A authority layer on 39ed4f1b.

## Scope / Guardrails
- Preserve merges 512ca686 and 39ed4f1b; no push or history rewrite.
- Make-only, Docker-only, no Python or environment-file reads.
- ENV=test-api-paniers-pwa, API 18933, UI 15933, Maildev 11933.
- One stack/build at a time; stop below 8 GiB disk or available memory.
- At most 150 changed lines per new commit; subject only, no trailer.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/artifacts/write-*`
  - `api/src/app.ts`, `api/src/config.ts`
  - `api/tests/integration/pw-write-authority*`
  - `tools/make/base-api-pwa*`
  - `plan/PWA-BRANCH_feat-api-paniers-pwa.md`
  - `RAPPORT-SOL-PWA.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`
  - `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, other branch plans
  - PW-B/PW-D implementations, migrations, A6 read contracts
- **Conditional Paths**:
  - `api/tests/integration/pw-write-createapp.spec.ts`: PWA-EX1.
  - Approved PW-D implementation, migration, tests, spec, tooling and plan:
    PWA-EX3 permits their exact import from 0ab7d664 by merge only.

## Feedback Loop
- [x] PWA-EX3: owner requires merging approved PW-D 0ab7d664 before repairs.
  Impact is its 23-file delta; no manual PW-D rewrite. Rollback preserves the
  source ref and reverts the merge with its first parent as mainline.
- [x] Second-pass qualification: 127 scoped tests pass; strict typecheck requires
  an explicit backend-row guard before scheduling cancellation. Missing or
  invalid backend identity now fails closed with write_fence_unavailable.
- [x] Second passes: delivery gate requires 26 killed/restored mutants, exactly
  76 optional CI skips, a two-parent PW-D merge and subject-only atomic commits;
  produce an incremental 8d5aed2e bundle and seed only its base for import audit.
- [x] Second passes: mutation campaign exercises the cumulative deadline and
  precommit guard, both final resolver expiry cases, authenticated cookie proof,
  durable terminal projection and P binding; keep each restoration byte-identical.
- [x] Second passes: HTTP regressions cover durable I/P rate refusals, terminal
  rejection without an external reader, and authenticated cookie expiry during
  confirmation SQL waits, with no BASE effect or consumed challenge.
- [x] Second passes: extend scoped verification to imported PW-D PostgreSQL
  suites and createApp; wait for foreign stacks/builds without holding the lock,
  with no obsolete external release flag and no host runtime.
- [x] Second passes: real PostgreSQL preparation waits on eight separate 800ms
  statements after persistence; cancellation occurs at the cumulative deadline,
  with exact 503/contact_operator/not_executed and no intent/key/audit/outbox.
- [x] Second passes: suspend the fourth/final P resolver after receipt projection;
  expire P or delegation while suspended and require the exact 401 envelope,
  without a receipt while the independent BASE event remains readable.
- [x] Second passes: enforce a monotonic five-second transaction deadline,
  cancel the pinned PostgreSQL backend, await cancellation before release,
  and refuse overdue callbacks before COMMIT without relabeling commit errors.
- [x] Second passes: merge approved PW-D 0ab7d664 with both parents retained;
  pass authenticated P to its status budget and durable refusal projection,
  and carry the verified cookie expiry inside the confirmation proof.
- [x] Astra fixes: enforce current workspace rights before summary bootstrap;
  preserve technical owner management and normalize foreign management IDs.
- [x] Astra fixes: canonical prepare path, typed expiry, post-projection
  authority/P validation, bounded SQL, PostgreSQL races and mutation proofs.
- [x] Review delivery: commits above 467c145d and a fresh incremental bundle audit.
- [x] Review SQL: bound preparation and owner reads; distinguish pre-commit
  cancellation from uncertain commit acknowledgement.
- [x] Review expiry: preserve authenticated grant/P 401 refusals and reject
  invalid signatures or crossed bindings before classifying expiration.
- [x] Review H5: use the exact v7 prepare path and revalidate fences,
  revocation and authenticated P after receipt projection completes.
- [x] Review runner: recognize Vitest's serialized promise rejection assertion;
  keep functional-case, process exit and byte-identical restoration gates.
- [x] Review delivery: isolate audit Git environment from the rescue repository;
  retain manifests for every executed campaign input.
- [x] Review audit: set the fresh repository HEAD to the imported payload before
  checking commit/tree equality and full object integrity.
- [x] PWA-EX2: explicit review instruction permits isolated host unit tests while
  Docker is reserved; copied sources/dependencies stay under ignored tmp, with
  a separate npm cache. Rollback removes the unit runner and its temporary tree.
- [x] Review qualification: 31 native unit tests, 54 PW-A tests with no skips,
  4225 API passed/76 optional skipped, 165 ARTEFACTS and 406 MCP passed;
  20 functional mutants killed/restored, lint/typechecks/build passed.
- [x] Qualification fixes: complete the CSRF refusal envelope, use a canonical
  content host fixture, and type grant indexing and mutable AuthConfig fixtures.
- [x] API: 4203 passed, 76 skipped; PW-A: 32 passed, zero skipped; seven
  functional mutants killed and restored; ARTEFACTS host: 165 passed.
- [x] MCP: repair the isolated archive inputs, then 406 passed, zero skipped.
  Application bytes match the successful full campaign; tooling-only retry.
- [x] PWA-EX1: inherited createApp assertion must expect the new closed 503
  mount rather than an absent route. Test-only impact; rollback these two lines.
- [x] Execution and HTML summary remain PW-C; PW-A supplies guarded seams.
- [x] PW-D parallel corrections stay external: status budget, terminal refusal,
  session expiry at transactional confirmation. Preserve an explicit expiry seam.

## Orchestration Mode (AI-selected)
- [x] One local branch; serial Docker campaigns; no publication.

## UAT Management (in orchestration context)
- [x] No UI delivery or UAT requested; root checkout untouched.

## Plan / Todo (lot-based)
- [x] Lot 0: rules, inherited history and rescue bundle/uncommitted archive.
- [x] Lot 1: strict grants, schemas, bindings and idempotent preparation.
- [x] Lot 2: cookie-only, principal, CSRF and bounded application mounting.
- [x] Lot 3: unit/PG/createApp, discriminating mutations, API CI parity,
  ARTEFACTS/MCP, lint and typecheck.
- [x] Lot 4: atomic commits, bundle from de81ef0e, isolated import audit/report.
- [x] Delivery audit: seeded empty repository, payload absent before import,
  identical HEAD/tree, retained merges, full fsck; source manifests verified.

- [x] Delivery: `api/src/app.ts`.

- [x] Delivery: `api/src/artifacts/write-grant.test.ts`.

- [x] Delivery: `api/src/artifacts/write-grant.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-app-authority.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-app-guard.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-app-route.test.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-app-route.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-authority.test.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-binding.test.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-binding.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-challenge.test.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-challenge.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-csrf.test.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-csrf.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-errors.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-h5-route.test.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-h5-route.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-page-authority.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-principal.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-refusal.test.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-refusal.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-schemas.test.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-schemas.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-service.test.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-service.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-status.test.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-status.ts`.

- [x] Delivery: `api/src/artifacts/write-profile.test.ts`.

- [x] Delivery: `api/src/artifacts/write-profile.ts`.

- [x] Delivery: `api/src/config.ts`.

- [x] Delivery: `api/tests/integration/pw-write-authority-fixture.ts`.

- [x] Delivery: `api/tests/integration/pw-write-authority-grants.spec.ts`.

- [x] Delivery: `api/tests/integration/pw-write-authority-guards.spec.ts`.

- [x] Delivery: `api/tests/integration/pw-write-authority.spec.ts`.

- [x] Delivery: `api/tests/integration/pw-write-createapp.spec.ts`.

- [x] Delivery: `tools/make/base-api-pwa-container.sh`.

- [x] Delivery: `tools/make/base-api-pwa-deliver.sh`.

- [x] Delivery: `tools/make/base-api-pwa-git.sh`.

- [x] Delivery: `tools/make/base-api-pwa-mutations.mjs`.

- [x] Delivery: `tools/make/base-api-pwa-verify.sh`.

- [x] Delivery: `tools/make/base-api-pwa.mk`.

- [x] Delivery: `api/tests/integration/pw-write-authority-rights.spec.ts`.

- [x] Delivery: `api/tests/integration/pw-write-authority-status.spec.ts`.

- [x] Delivery: `api/tests/integration/pw-write-authority-timeouts.spec.ts`.

- [x] Delivery: `tools/make/base-api-pwa-deliver.sh`.

- [x] Delivery: `tools/make/base-api-pwa-mutations.mjs`.

- [x] Delivery: `tools/make/base-api-pwa-unit.sh`.

- [x] Delivery: `tools/make/base-api-pwa-verify.sh`.

- [x] Delivery: `tools/make/base-api-pwa.mk`.
