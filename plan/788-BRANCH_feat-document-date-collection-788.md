# Feature: Document dates from collection and the existing signal extraction

## Objective
- [ ] Preserve evidenced document dates upstream and conditionally recover missing dates during existing signal extraction; keep collection timestamps independent.

## Scope / Guardrails
- [ ] Two data changes in one branch; no filter or URL changes.
- [ ] No new LLM workflow, job, date-only call, workaround, deployment, production write or backfill execution.
- [ ] Preserve original payload bytes, SHA, known dates and first collection timestamps.
- [ ] Use Make-only, Docker-first execution with ENV last.
- [ ] Keep root UAT stable; work only in `tmp/feat-document-date-collection-788`.
- [ ] Automated tests use `test-document-date-data-788`; API 8897, UI 5397, mail UI 1197, PG 5637, S3 9197, Obscura 9397, SMTP 1097.
- [ ] Write code, comments and specifications in English.

## Branch Scope Boundaries (MANDATORY)
- [ ] **Allowed Paths (implementation scope)**: `packages/radar-sources/src/DocumentDate.ts`, `packages/radar-sources/src/RawDocument.ts`, `packages/radar-sources/src/index.ts`, `packages/radar-sources/src/sources/proces-verbaux-parser.ts`, directly associated tests.
- [ ] **Allowed Paths (implementation scope)**: `api/src/services/sources/recueil.ts`, `api/src/services/sources/document-resolver.ts`, `api/src/services/sources/document-date-metadata.ts`, directly associated tests.
- [ ] **Allowed Paths (implementation scope)**: `api/src/services/graph/refresh-corpus.ts`, `api/src/services/graph/refresh-profile.ts`, `api/src/services/graph/refresh-run.ts`, `api/src/services/graph/refresh-v23.ts`, directly associated tests.
- [ ] **Allowed Paths (implementation scope)**: this branch plan and `docs/spec/SPEC_EVOL_DOCUMENT_DATES.md`.
- [ ] **Forbidden Paths**: `Makefile`, `docker-compose*.yml`, `rules/**`, `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, other branch plans, `.track/**`, `.agents/**`, UI/router/filter, graph-store, scoring, migrations, external repositories.
- [ ] **Conditional Paths**: document contracts in `packages/radar-domain/**` or ontology/prompt declarations in `radar/ontology/**`; obtain scope exception before editing.
- [ ] **Exception process**: declare BR788-EXn with rationale, impact and rollback before conditional changes.

## Feedback Loop
- [x] `clarification`: canonical dates belong to persisted graph refs; list/detail membership shares PostgreSQL refs while S3 only enriches presentation.
- [x] `clarification`: hydrate related baseline refs in the existing refresh; no new index/job/workflow or production execution.
- [x] `BR788-EX1`: allow `api/src/services/sources/live-scrape.ts` and its existing tests for injecting the existing PdfToText into collection; missing dates require header text when exploit=false. Impact is deterministic PDF parsing of undated newly collected documents. Rollback removes this injection and its tests; raw payloads and timestamps remain unchanged.
- [ ] `attention`: conductor coordination gate required before application edits.
- [ ] `attention`: request an owner decision if the existing workflow cannot recover dates cleanly; continue independent work without a workaround.
- [ ] `attention`: complementary review requires exact author identity and two eligible reviewer hosts/models; report selection failure without inventing consensus.

## Orchestration Mode (AI-selected)
- [x] **Multi-branch**: independent data branch coordinated with filter #786 and URL #787; no cherry-picks.

## UAT Management (in orchestration context)
- [ ] No user UAT on this branch; conductor owns integration and fixed-port root UAT.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline and scope**
  - [x] Verify isolated worktree, branch and source baseline.
  - [x] Read MASTER, workflow, subagent, source and testing rules; load harness skills.
  - [x] Read existing root-cause, stock and owner decision evidence without new production access.
  - [x] Open harness branch/debug/plan recorders and obtain conductor scope coordination (C1/C2 passed).
  - [x] Confirm isolated ports before starting services.
- [ ] **Lot 1 — Deterministic date detection and metadata**
  - [x] Add validated documentary date status, precision, nature, provenance and evidence contract.
  - [ ] Extract session dates from listing/filename and relevant document header without LLM.
  - [x] Persist/enrich missing dates while preserving known dates, first fetchedAt and payload identity.
  - [ ] Test July/September headers, ambiguous dates, invalid dates, month precision and immutable known metadata.
  - [ ] Lot gate: scoped sources and recueil/resolver tests, API typecheck and scoped lint.
- [ ] **Lot 2 — Existing signal-workflow extension**
  - [ ] Resolve known metadata and carry document date/fetchedAt into corpus.
  - [ ] Request missing document metadata in the existing first signal chunk; expose the header independently of entity citations.
  - [ ] Validate grounded date evidence and calendar semantics without mixing signal/business dates.
  - [ ] Persist date metadata even with zero signals; propagate it to graph references and document API.
  - [ ] Test existing call count, zero signals, known-date preservation, invalid/ungrounded LLM output and resumed chunks.
  - [ ] Lot gate: scoped corpus/profile/run/v23 tests, API typecheck and scoped lint.
- [ ] **Lot 3 — Stock preview and consolidation**
  - [ ] Provide an idempotent fixture/local-stock preview separating manifest recovery, remaining unknowns and conflicts without writes.
  - [ ] Consolidate documentary versus collection-date contract and measured coverage limitations.
  - [ ] Review every hunk for minimal scope; run branch verification and available complementary review.
- [ ] **Lot 4 — Reviewable delivery**
  - [ ] Push atomic commits and open draft PR with checks and limitations.
  - [ ] Verify CI using full head SHA; report pending/failing checks accurately.
  - [ ] Hand off full SHA, diff stats, proof artifacts, PR and open questions to conductor.
  - [ ] Leave merge, deployment and production data mutation to separately authorized integration work.
