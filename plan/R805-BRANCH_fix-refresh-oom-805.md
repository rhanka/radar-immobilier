# Feature: Refresh OOM on oversize PDFs — size guard, durable deferral, attempt marker (#805)

## Objective
- [x] Stop the prod `radar-refresh-pv` CronJob from being OOM-killed on every pass by one 180 MB PDF: never buffer a document past a byte cap, keep oversize and repeatedly-interrupted documents out of later passes with a durable per-URL deferral, and read the documentary date from page 1 only.

## Scope / Guardrails
- [x] Owner GO scope only (#805): size guard, durable deferral, durable attempt marker, `pdftotext -l 1` on a temp file for the date, PO visibility in logs and sweep report.
- [x] Stay on `pdftotext`; no streaming pipeline; `RawDocument.body: Uint8Array` contract unchanged; no memory limit change; no manifest change unless env plumbing requires it.
- [x] Never record a deferred document as collected (known-URL guard) nor as covered (coverage ledger).
- [x] No cluster, bucket or workflow action; no merge. Node/TS only, 0 Python, no SealedSecret.
- [x] Test environment: `test-r805`; no UI change, root UAT untouched.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/radar-sources/src/document-size-cap.ts`
  - `packages/radar-sources/src/index.ts`
  - `packages/radar-sources/src/sources/proces-verbaux-generic.ts`
  - `packages/radar-sources/src/sources/proces-verbaux-size-cap.test.ts`
  - `packages/radar-sources/src/sources/reglements-urbanisme-valleyfield.ts`, `packages/radar-sources/src/sources/pdf-first-page.test.ts`
  - `api/src/services/sources/recueil.ts`, `api/src/services/sources/recueil.test.ts`
  - `api/src/services/sources/acquisition-state.ts`, `api/src/services/sources/acquisition-state.test.ts`
  - `api/src/services/sources/known-urls.ts`, `api/src/services/sources/known-urls.test.ts` (left unchanged in the end)
  - `api/src/services/sources/live-scrape.ts`, `api/src/services/sources/live-scrape.test.ts`
  - `api/src/services/graph/refresh-run.ts`, `api/src/services/graph/refresh-run.test.ts`
  - `api/src/services/graph/refresh-sweep.ts`, `api/src/services/graph/refresh-sweep.test.ts`
  - `api/src/scripts/refresh-pv.ts`
  - `plan/R805-BRANCH_fix-refresh-oom-805.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `deploy/**` (no memory or env change; the defaults live in code)
  - Other branch plans
- **Conditional Paths (allowed only with explicit exception)**:
  - `.github/workflows/**`

## Feedback Loop
- [x] attention — independent review: a faulted state read followed by a write could erase marks; an attempt could be closed without being opened. Fixed, with tests.
- [x] clarification — conductor addendum (double review of the analysis): deferrals and attempts move OUT of `collected-urls.jsonl` into a per-URL `acquisition-state.jsonl`; neutral label `interrupted-repeatedly`; a deferred URL never reaches the fetch again; body time bound; HTTP error bodies cancelled; replay evidence (a)-(d). Applied.

## Orchestration Mode (AI-selected)
- [x] Single branch, single agent; replay harness kept outside the repo (scratchpad).

## UAT Management (in orchestration context)
- [x] No UI change; root UAT untouched.

## Plan / Todo (lot-based)
- [x] Lot 1 — Size guard in the PV adapter: `Content-Length` over the cap cancels the body unread; otherwise the body is read through its reader, bytes counted, aborted and cancelled on the crossing chunk; typed `DocumentOversizeError` (bytes announced / read); body read time-bounded (typed timeout); cut-off body typed `network`; HTTP error bodies cancelled.
- [x] Lot 2 — `pdfFirstPageToTextViaPoppler`: `pdftotext -l 1` on a temp file under the OS tmpdir, always removed, same timeout, typed errors.
- [x] Lot 3 — Per-URL acquisition state `runs/{source}/acquisition-state.jsonl`: `deferred-oversize`, `interrupted-repeatedly`, `attempt-open`; attempt written before each document request; a faulted read fetches nothing for the city.
- [x] Lot 4 — RECUEIL: deferred documents skipped with no request and no share of the limit; oversize becomes a typed `setAside` outcome; attempts opened before the fetch and closed on every in-process settlement (only when opened).
- [x] Lot 5 — Live scrape wiring: journal on the acquisition state, cap and time-bound options, first-page date extractor, `setAside` in the city recap; known-URL guard unchanged (collected URLs only).
- [x] Lot 6 — Refresh: `REFRESH_MAX_DOCUMENT_BYTES` (code default 52428800) and `REFRESH_DOCUMENT_TIMEOUT_MS` (code default 120000); deferred documents in a per-document log line, the per-city sweep entries and the sweep report.
- [x] Lot 7 — Crash replay with the #805 analysis harness under the prod envelope (768Mi, heap 512, 150m CPU): exact PDF `deferred-oversize`, no kill (peak 127.9 MiB); next pass no GET; BEFORE / TARGET / AFTER sequence collects both small documents; Content-Length absent / lying, mid-body abort, PUT error, date timeout all typed with no kill; 52.15 MB document collected and extracted (peak 434.4 MiB); two real fetch-phase OOM kills (cap off, 640Mi) → `interrupted-repeatedly`, no GET afterwards; deferred list present in the persisted sweep report.
- [x] Lot gate: `harness verify --category static`, `harness verify --category unit`, `make typecheck ENV=test-r805`, `make lint ENV=test-r805`, `make test ENV=test-r805` then `make clean ENV=test-r805`.
- [ ] Post-merge (conductor) — release to prod, then read the first passes: `refresh-pv: document set aside` lines and `setAside` in `refresh/018/sweep/latest.json`.
