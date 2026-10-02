# Documentary dates: collection and native graph extraction

- [x] Owner decision: deterministic metadata extraction first; recover a still-missing date in the existing signal extraction call, without a new LLM workflow.
- [x] Collection time is `fetchedAt`; graph node creation and business-event dates are different clocks.
- [x] Filters consume documentary dates projected on canonical document refs; S3 presentation does not change result membership.

## Effective engine contract

- [x] Radar currently pins `@sentropic/graphify` **0.18.0** in `api/package.json` and the lockfile; the installed Docker package confirms this version.
- [x] The upstream repository is now `rhanka/engram`; published `@sentropic/engram` **0.19.0** was inspected read-only from its npm tarball. No package migration is implied or authorized.
- [x] Both inspected public `Extraction` contracts contain nodes, edges, evidence and graph-related collections, not a top-level documentary metadata envelope.
- [x] The native `mergeExtractions` function reconstructs known graph fields; an arbitrary top-level `document_date` is not a supported native extraction contract.
- [x] The Radar ontology already defines `Source` as the actual document, with `date`, `docSha`, `rawRef`, `sourceUrl` and `fetchedAt`; it is not registry-backed.
- [x] Local probe `tmp/issue-788-proof/native-source-contract.mjs` proves one Source with a grounded dated citation traverses native base/profile validation and merge: one mock call, zero Signal/DesignationEvent nodes, no validation issues.

## Native integration

- [x] The experimental model top-level `document_date` extension is removed; no compatibility path remains.
- [x] Graphify 0.18.0 loads the Radar profile with `Source.properties.date` (`format: date`) and declares `Source` as `outputs.ontology.source_node_types`; `GraphNode.citations` carries the proof natively.
- [x] In the already-planned first signal chunk of an undated document, the existing call is asked for a real `Source` with its stable documentary identity and an evidenced `properties.date`; no extra call, job or workflow.
- [x] The first-page header is provided alongside the chunk; the Source citation must be on that physical page and anchored in the header, the value must be calendar-valid and literally present in the excerpt, and the excerpt must state its documentary meaning (session, publication, document).
- [x] A Source.date that is unbound to the document or unproven is dropped (the date stays unknown); the signal extraction itself is neither refused nor retried because of it. Existing provenance rules (page in chunk, excerpt on page) are unchanged.
- [x] The Source identity reuses an existing baseline Source bound to the same `docSha` (`bindDocumentSourceIds`), otherwise `source-<docSha>`; it never depends on a date.
- [x] Native Extraction parse, ontology validation, merge, durable chunk replay, publication and PostgreSQL projection are unchanged; a replayed chunk carries its own header and recovers the same date.
- [x] Zero signals may leave a real Source node; this is document metadata, never an invented signal.
- [x] A recovered date is persisted to the raw sidecar only when upstream metadata is still missing (`persistDocumentDate`), then projected on the canonical refs of the same refresh; known upstream dates always win.
- [x] Baseline refs and previously undated baseline Sources are hydrated from the sidecar in this same refresh (`hydrateGraphDocumentDates`); a Source date that is already set is never overwritten.
- [x] A sidecar that is not a valid `RawDocumentRecord` is left untouched; enrichment never rewrites metadata it cannot fully validate.

## Single source of truth for consumers (#786)

- [x] The documentary date lives in the raw sidecar `<rawRef>.meta.json`: `documentDate` (status, value, precision, kind, method, evidence) and its mirror `publishedAt` (present only when known; the schema refuses any disagreement).
- [x] `loadDocumentMetadata` resolves it once (`resolveDocumentDate`) for the aggregate route (`/api/graph-signals/by-city` doc refs).
- [x] The existing refresh projects the same value onto canonical graph refs (`refs[].documentDate`, `refs[].publishedAt`, `refs[].fetchedAt`) consumed by detail routes from PostgreSQL.
- [x] The collection clock stays `fetchedAt` (first collection, never rewritten); signal business dates (`etape_date`, decisions) are a different clock.

## Shared period rule (aggregate = detail)

- [x] One domain rule, `matchesDocumentDateWindow` (`packages/radar-domain/src/signals/document-date-filter.ts`), is used by the aggregate route and the detail panel.
- [x] Scrape basis: only `refs[].fetchedAt`, as a Quebec civil day.
- [x] Document basis: each ref's documentary day (`documentDate` known/day, else `publishedAt`). A ref without one, or a result without refs, falls back to the signal stage date read in the document (`SIGNAL_DATE_KEYS`: `etapeDate`, `etape_date`, `meetingDate`, `meeting_date`, `documentDate`, `date`; nested `properties` first). A dated ref is never replaced by the stage date, and node creation (`createdAt`) is never a period clock.

## Coverage and stock

- [x] Deterministic header checks use bounded first-page text, not arbitrary dates in agenda items or cited legal history.
- [x] Date metadata preserves status, precision, nature, extraction method and evidence; month-only dates never gain an invented day.
- [x] Metadata enrichment preserves raw bytes/SHA and the first collection timestamp.
- [x] Stock preview is read-only and distinguishes preserved dates, identity-matched manifest recovery, unknowns and conflicts.
- [x] Already-covered documents get an explicit, executable stock recovery without model calls: `api/src/scripts/recover-document-dates.ts` (planner `planGraphDocumentDateRecovery`) projects the raw sidecar `fetchedAt` and the known documentary date (with its provenance) onto the refs of each published city graph (`graph/<city>/latest.json` → archive → guarded write → `upsertGraphAtomic`).
- [x] The recovery never overwrites a value present on a ref (an explicit `unknown` status may be completed), reports disagreements (`fetchedAt`, documentary date, `docSha` identity) as conflicts, and is idempotent. Preview (dry-run) is the default, `--apply` writes, `--heal` recovers from the served PG graph when `latest.json` and PG node sets differ (otherwise such a city is halted).
- [x] Preprod execution: `make document-date-recovery-preprod RECOVERY_MODE=preview ENV=preprod`, then `RECOVERY_MODE=apply RECOVERY_CONFIRM=1`. The Job (`deploy/k8s/document-date-recovery/job.yaml`) runs the image served by preprod and prints one JSON line per city plus a final report.
- [x] Scanned or unsupported PDFs remain unknown; no new OCR or date-only model job is added.
- [ ] Listing/filename detection (glued or two-digit-year filenames) is unchanged; the header covers the controlled Val-des-Monts cases.
