---
status: selection-failed
review-author:
  host: codex
  model: unknown
  effort: unknown
target-ref: 4012f5683b5f35dd2135919f9e15aa277a3a27b5
legs: []
observed-failure: Exact declared author model and effort are absent from the launch brief; the harness complementary selector cannot run without them.
---

# Annotations host verification and review

## Code verification

The target is the committed immo host implementation and complete legacy consumer
removal. Code and all retained artifacts are in `feat/annotations-host`; no real
data, deployment, root UAT checkout or remote team messages were changed.

| Verification | Observed result |
|---|---|
| Exact source/archive checksums and producer vector bytes | Pass |
| Rebuild M1 from retained source and build lock without producer checkout | Byte-identical npm archive |
| Scoped host, route, entire corpus and source preparation | 58 passed |
| PostgreSQL assignment/migration/retirement and retired routes | 36 passed, including the final partial-restore guard |
| Full API, default CI command, isolated test stack | 2,302 passed; 6 skips |
| Full UI | 1,624 passed; 10 existing todos |
| Domain / scoring / MCP / sources | 289 / 57 / 64 / 1,293 passed |
| Workspace typecheck | Pass; seven Svelte warnings |
| Changed-file and full workspace lint | Pass |
| API/UI build and locked backend image build | Pass; M1 builders and both operator entrypoints load in image |
| Production UI server-runtime bundle smoke | Pass |
| Harness branch and full path inventory scope checks | C1/C2 pass |
| Whitespace/diff integrity | Pass |

The default `make test ... ENV=test-annotations-host` passes across all workspaces:
**5,629 tests**, without a timeout/worker override. Captured log:
`tmp/reprise-review-fixes-full-test.log`. The final additional catalog-resurrection
guard then passes the 36-test migration/host/retired-route campaign. The four
offline operation tests also pass; a refused restore cannot execute its always()
unquiesce. The archive rebuild is byte-identical using the pinned Node image.

Earlier failures were not waived: cleanup interrupted two starting containers
(`network ... not found`); fresh PostGIS initialization briefly failed readiness,
then reached healthy; a scoped migration subprocess failed without useful output,
so the regression now preserves stdout/stderr (subsequent scoped and full default
runs pass); history assertions initially mixed memberships for one principal and
now bind the fresh membership UUID. Strict optional, rootDir, union-narrowing and
Node-global lint errors were corrected. No AI-flaky exception is inferred.
The prior 80105624 timeout campaign lacks precise signatures; its qualification
is superseded by the default full run, not relabeled as accepted flaky evidence.

Harness C1/C2 pass; C2 receives the actual branch plan and every changed path from
`ea90951c`. Its advisory/placeholder-clock output is not runtime evidence.

## Received implementation reviews

Owner-supplied reports at private `plan-immo-injection/impl/revue-opus-5-5.md`
and `revue-fable-5-1.md` target `80105624`: both NO-GO for merge, technical GO
for the host. Declared labels: Claude Opus 5.5 max and Claude Fable 5.1 max.
Their effective routing and a fresh verdict on this target are not attested here.

| Finding | Treatment and remaining acceptance |
|---|---|
| Opus B1 / Fable B1: manual 0009 blocks CD | Image-packaged catalog attestation, same bounded lock, atomic native/extension/attestation receipts; native Drizzle/manual/absent/drift/rollback/retry/restore cases pass. Live operator evidence remains required before triggering merge/promotion. |
| Opus B2 / Fable M1: automatic retirement/backups | Schema-only ordinary migrate; explicit closed-window/catalog/receipt retirement. Pre-copy release fence, suspended restore/rollback and guarded always() reopening. No live fence/backup state was changed. |
| Opus M1: recovery regressions lost | Native Drizzle predecessor fixtures; missing last receipt, 0009 drift, DDL rollback, concurrency, pre/post/contradictory restores. 0013 guard now runs the production runner. |
| Opus M2: immo work omitted | Synthetic Google reader/inventory, common candidate/manifest preparation and map dispositions shipped. Actual collector/sidecars/export/domain matching/backing/events/operations remain immo work, independent of UI. |
| Fable M2: consensus incomplete | Incoming reviews recorded; new selection still lacks declared author model/effort. No fresh consensus claimed. |
| Fable M3: installation not identical | Mandatory complete lock, archive/source integrity checks, backend-only npm ci, locked bundler/pinned image, clean image build and exact archive reconstruction pass. |
| Contract/identity/evidence minors | Every producer vector replayed; host capacity; transport 503 outside the closed canonical wire; UUID-native proof required; null digest unresolved; historical candidates never exact/reviewable. |
| Assignment/schema/retirement minors | Append-only assignment/link history, immutable snapshots, shared capability CHECK equality, required 0014 catalog/receipt, bounded locks, no stale aggregate receipt reused after resurrection. |
| Documentation/provenance/check minors | Freeze manifest/receipt/erratum acknowledged; Steve dossier/render supersession indexed; summary/table-count text corrected; default full command passes. Root UAT, remote CI and live inventories remain distinct gates. |

Unused UI whitespace and relocating all existing synthetic fixtures from `src`
are non-blocking cosmetic suggestions, deferred by the host maintainer under
strict minimal scope. The new workbook fixture is JSON under `api/tests/fixtures`.

## Delivery and security boundary

Immo and Sentropic repositories are public. Retained producer software/freeze
documents are already committed on its public branch. Private immo specs/review
bodies, real workbook contents and private dossiers are not added here.
The backend image install reported one HIGH advisory; no exception is granted.
Package-tree checks do not qualify image OS layers or vendored/packaged-code
security. Dependency/image qualification remains a maintainer release gate.
Operational module/data acceptance remains in the eradication handoff.

## Review status

Two independent blind design reviews covered contract correctness and
eradication/security; their accepted findings are recorded in the host spec.
They are not a completed complementary code consensus review.

The installed `harness-review/SKILL.md` requires exact author host/model/effort
and says: **"Unknown author means no acceptable review"**. Its selector must
retain two distinct complementary host/model candidates before dispatch through
h2a. Exact author model/effort were not supplied, so selection stops here;
no review leg was dispatched and no consensus verdict is claimed.

The declared launch metadata was requested during this resumption; no answer is
present. Selection remains failed rather than inferring the current CLI identity
or treating incoming reports as fresh consensus on these bytes.
Operational adoption separately requires the qualified cluster-mesh M2/M3 module,
typed import/readback receipts, real assignments and Farid D5/D6, as detailed in
[the eradication handoff](ANNOTATIONS_ERADICATION.md).

## Remote publication status

The initial push was rejected by automatic approval review because publication
authorization was missing. The owner then explicitly approved publication on
2026-10-12. [Draft PR #859](https://github.com/rhanka/radar-immobilier/pull/859)
is open; no merge is authorized. The earlier refusal remains part of the history.

CI run `38305299067` on `9e21f57f0bd5bcf142c87c9e633696ac19b0614a`
passed repository policy and the annotation operation/software gates, then failed
offline K8s validation: its regression expected 18 API image entrypoints while
the image ships 20, including controlled adoption and guarded retirement. The
same failure was reproduced locally; the inventory assertion is updated while
the entrypoint checker and all negative mutation cases remain unchanged.
All 39 hermetic cases, `make k8s-validate ENV=test-annotations-host`, harness
C1/C2 and `git diff --check` pass after this correction. Remote CI for the new
head remains pending at publication; no fresh code consensus is implied.
