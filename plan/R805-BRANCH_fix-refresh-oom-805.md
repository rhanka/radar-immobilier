# Feature: Refresh OOM on oversize PDFs — size guard, durable set-aside, attempt marker (#805)

## Objective
- [ ] Stop the prod `radar-refresh-pv` CronJob from being OOM-killed on every pass by one 180 MB PDF: never buffer a document past a byte cap, keep oversize and repeatedly-fatal documents out of later passes with a durable mark, and read the documentary date from page 1 only.

## Scope / Guardrails
- [ ] Owner GO scope only (#805): size guard, durable set-aside mark, durable attempt marker, `pdftotext -l 1` on a temp file for the date, PO visibility in logs and sweep report.
- [ ] Stay on `pdftotext`; no streaming pipeline; `RawDocument.body: Uint8Array` contract unchanged; no memory limit change; no manifest change unless env plumbing requires it.
- [ ] No cluster, bucket or workflow action; no merge. Node/TS only, 0 Python, no SealedSecret.
- [ ] Test environment: `test-r805`; no UI change, root UAT untouched.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/radar-sources/src/document-size-cap.ts`
  - `packages/radar-sources/src/index.ts`
  - `packages/radar-sources/src/sources/proces-verbaux-generic.ts`
  - `packages/radar-sources/src/sources/proces-verbaux-size-cap.test.ts`
  - `packages/radar-sources/src/sources/reglements-urbanisme-valleyfield.ts`, `packages/radar-sources/src/sources/pdf-first-page.test.ts`
  - `api/src/services/sources/recueil.ts`, `api/src/services/sources/recueil.test.ts`
  - `api/src/services/sources/known-urls.ts`, `api/src/services/sources/known-urls.test.ts`
  - `api/src/services/sources/live-scrape.ts`, `api/src/services/sources/live-scrape.test.ts`
  - `api/src/services/graph/refresh-run.ts`, `api/src/services/graph/refresh-run.test.ts`
  - `api/src/services/graph/refresh-sweep.ts`, `api/src/services/graph/refresh-sweep.test.ts`
  - `api/src/scripts/refresh-pv.ts`
  - `plan/R805-BRANCH_fix-refresh-oom-805.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `deploy/**` (no memory or env change; the cap default lives in code)
  - Other branch plans
- **Conditional Paths (allowed only with explicit exception)**:
  - `.github/workflows/**`

## Feedback Loop
- [ ] None yet.

## Orchestration Mode (AI-selected)
- [x] Single branch, single agent; replay harness kept outside the repo (scratchpad).

## UAT Management (in orchestration context)
- [x] No UI change; root UAT untouched.

## Plan / Todo (lot-based)
- [x] Lot 1 — Size guard in the PV adapter: `Content-Length` over the cap cancels the body unread; without it the body is read through its reader and aborted as soon as the cap is exceeded; typed `DocumentOversizeError` (bytes announced / read).
- [x] Lot 2 — `pdfFirstPageToTextViaPoppler`: `pdftotext -l 1` on a temp file under the OS tmpdir, always removed, same timeout.
- [ ] Lot 3 — Known-URL guard carries durable set-aside marks (`oversize`, `oom-suspected`) and open attempt markers; journal written before each document request.
- [ ] Lot 4 — RECUEIL: set-aside documents skipped with no request, oversize becomes a typed `setAside` outcome, attempts opened before the fetch and closed on every in-process settlement.
- [ ] Lot 5 — Live scrape wiring: journal on the guard, cap option, first-page date extractor, `setAside` in the city recap; guard written even when the city RECUEIL fails.
- [ ] Lot 6 — Refresh: `REFRESH_MAX_DOCUMENT_BYTES` (code default 52428800), set-aside documents in the per-city notes, sweep entries and sweep report.
- [ ] Lot 7 — Crash replay with the #805 analysis harness under the prod envelope (768Mi, heap 512, 150m CPU): 172 MB PDF reported `oversize` without OOM kill; small PDF still collected.
- [ ] Lot gate: `harness verify --category static`, `harness verify --category unit`, `make typecheck ENV=test-r805`, `make lint ENV=test-r805`, `make test ENV=test-r805` then `make clean ENV=test-r805`.
