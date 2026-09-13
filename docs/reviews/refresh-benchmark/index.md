# Refresh benchmark v1 handoff

Status at 2026-09-13T17:56:41Z: stopped after the already-running requests finished.
The v1 campaign is immutable and not rankable because its extraction contract did
not explicitly define nested citation identity or the `evidence_refs` shape. T1
created a separate v2 contract in commit `99dbb89e`; none of the v1 results below
has been relabelled or accepted under that contract.

## Exact coverage

- Requested candidate cases: 40 (5 documents x 8 variants).
- Unsupported and never launched: 20 (Codex 5.3 medium/high and Gemini 3.8
  MEDIUM/HIGH, each on 5 documents).
- Qualified Luna/Sol cases: 20; unique launched: 7; not launched: 13.
- Attempt receipts: 8. One Waterloo/Luna medium attempt was externally
  interrupted and its explicitly authorized infrastructure retry is preserved.
- Complete provider responses: 6. Transport failures after HTTP 200: 1.
  External interruptions before any receipt from the provider: 1.
- Strict v1 extractions accepted: 0. Judge calls: 0.

An HTTP response status is not counted as a complete provider response unless the
mesh returned a response object with usage. In particular, Saint-Etienne/Sol
medium received HTTP 200 but ended `TypeError: terminated` with no response or
usage after 1,585,937 ms.

| Document/configuration | Provider completion | Input/output/reasoning tokens | Total ms | v1 result |
|---|---:|---:|---:|---|
| Waterloo Aug 18 / Luna medium attempt 1 | no | unknown | ~30,000 | external coordination interruption |
| Waterloo Aug 18 / Luna medium attempt 2 | yes | 15,982 / 8,325 / 331 | 151,354 | citation/page/status validation failure |
| Waterloo Aug 18 / Luna high | yes | 15,982 / 21,733 / 4,482 | 392,805 | incompatible relation source type |
| Waterloo Aug 18 / Sol high | yes | 15,982 / 20,035 / 3,624 | 362,309 | missing nested citation source files |
| Wickham Sep 15 agenda / Luna medium | yes | 5,072 / 5,294 / 516 | 96,987 | missing nested citation source files and incompatible source types |
| Saint-Barthelemy Sep 8 / Luna high | yes | 12,023 / 18,568 / 4,347 | 336,042 | malformed/missing evidence refs and incompatible source types |
| Saint-Etienne-de-Bolton Aug 4 / Sol medium | no | unknown | 1,585,937 | transport `terminated` after HTTP 200 |
| Waterloo Aug 31 negative / Sol high | yes | 5,445 / 1,348 / 507 | 34,554 | invalid original PDF identity |

Completed-response totals are 70,486 input, 75,303 output, 13,807 reasoning,
and 15,104 cached input tokens. Per-call receipts are the attributable evidence.
The account quota moved from 89% at 17:08:07Z to 95% at 17:56:41Z, but T1 and
other Codex work shared the same subscription; the six-point global delta is not
causally attributable to this benchmark or to any model.

`max_output_tokens: 16384` is present in captured real Codex payloads. It is not
an observed effective total-output ceiling: Saint-Barthelemy/Luna high returned
18,568 output tokens including 4,347 reasoning, Waterloo/Sol high returned 20,035
including 3,624 reasoning, and its attributed visible content was 16,411. Reports
must call this a requested wire field, not an enforced cap.

## Frozen matrix and enrollment handoff

| Requested variant | Native identity / transport | Wire effort | v1 state |
|---|---|---|---|
| Codex 5.3 normal/high | `gpt-5.3-codex` / Codex | `medium` / `high` | unsupported; absent live catalog, Spark forbidden |
| Gemini 3.8 normal/high | `gemini-3.8-flash` / Cloud Code AGY | `MEDIUM` / `HIGH` | blocked; no enrollment or native catalog proof |
| Luna normal/high | `gpt-5.6-luna` / Codex | `medium` / `high` | qualified |
| Sol normal/high | `gpt-5.6-sol` / Codex | `medium` / `high` | qualified |
| Judge Sol | `gpt-5.6-sol` / Codex | `xhigh` | qualified, not run |
| Judge Fable 5 | `claude-fable-5` / faithful native route | native `xhigh` | blocked; no faithful enrollment, aliases forbidden |

The only enrolled v1 account was `acct-c015cb459d`, Codex transport, under the
frozen owner scope. The runner rejects more than one eligible Codex account to
avoid hidden pool rotation. The routing principal is `principal:refresh-benchmark`.

Supported enrollment uses `createLlmMeshFacade` with an
`EncryptedFileKeyring(<new narrow writable directory>)`, then
`facade.enroll("cloud-code", { configRef, mode: "cli", redirectUri, ownerScope })`
and the human authorization URL followed by `waitForCallback(enrollmentId)`.
Codex uses the same facade with the device-code session and
`pollForCompletion(enrollmentId)`. A resumed v2 campaign must use a new narrow
keyring supplied by the conductor; it must not edit or copy the global keyring.

## Reproduction boundary

The frozen v1 inputs are `manifest.json` and `prompt-freeze.json`; the live entry
point is `tools/refresh-benchmark/Makefile` -> `run-case.mjs`. Tests run through
`make -C tools/refresh-benchmark test ENV=test-refresh-benchmark` and pass 4/4.
Commit `931ca967` binds the 480-second controller to the actual fetch after the
earlier mesh-level signal failed to bound one request. Candidate JSON and receipts
are under `candidates/`; quota snapshots are adjacent to this file.

Resume only as a separately frozen v2 campaign after review of T1 commit
`99dbb89e`, new per-document schema/prompt hashes, and enrollment qualification.
Do not quality-rerun or rejudge these v1 outputs under the new contract.
