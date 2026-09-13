# Five-document v3 diagnostic

Status: real subscription-backed execution completed on 2026-09-13. This campaign
is diagnostic and **not rankable**. It does not recommend a model and did not run
judges, publish a Signal, write S3/Postgres, or touch Kubernetes.

## Frozen identities

- Manual oracle: 36 independently anchored units across five public PDFs. Its
  lineage is `95315d4daea878d8be6181aaa925dde4ae96c1115f607d6b45667e33a4670893`
  minus Warden plus the Waterloo page-3 oracle.
- Runtime: T1 `8f10ba1690a67e223851a467508f06e59d2ec668`, Graphify
  0.18.0, contract `immo-pv-extraction-v3`, llm-mesh 0.19.0.
- Candidate: effective `gpt-5.6-sol`, explicit wire effort `medium` for
  owner-requested normal, enrolled Codex subscription only.
- As-is context: Graphify installed 0.10.0, `claude-sonnet-4-6 --effort low`,
  prompt `aaa927…`, schema `8d7de6…`. It is historical context, not the same
  runtime or contract.

The preflight proved one eligible pseudonymous account, `plan_type=pro`, Luna
and Sol in the native catalogue, no native `gpt-5.3-codex`, and 17% used in the
seven-day window. The post-phase snapshot showed 20% used. This three-point
global delta is an observation on a shared subscription, not causal cost
attribution to this campaign.

## Execution states

Only `completed_valid` is quality-scorable. The other allowed states are
`completed_invalid`, `transport_failed`, `not_launched`, `unsupported`, and
`absent_from_campaign`.

| PDF | Attempts | Final state | Final request latency | Attributable completed-response usage |
|---|---:|---|---:|---|
| Lac-des-Seize-Îles | 1 | `completed_valid` | 189,197 ms | 6,260 in / 10,329 out / 1,930 reasoning |
| Saint-Étienne-de-Bolton | 1 | `completed_invalid` | 408,991 ms | 17,574 in / 22,579 out / 1,760 reasoning |
| Valcourt | 1 | `completed_valid` | 267,397 ms | 6,718 in / 14,750 out / 1,905 reasoning |
| Saint-Barthélemy | 2 | `completed_valid` | 383,487 ms on retry | 13,533 in / 21,217 out / 1,552 reasoning; 13,312 cached input |
| Waterloo | 2 | `transport_failed` | 178,605 ms on retry | N/A; no response or usage on either attempt |

Seven attempts were retained. Saint-Barthélemy attempt 1 and both Waterloo
attempts ended `TypeError: terminated` after HTTP 200 without a mesh response or
usage. The fixed maximum was two attempts; only transport failures were retried.
Saint-Étienne returned a complete response but v3 rejected an ungrounded
page-local excerpt, so it was not retried or quality-scored.

Completed responses total 44,085 input, 68,875 output, 7,147 reasoning and
13,312 cached-input tokens. The seven request latencies sum to 1,970,102 ms;
that sum is not wall time because calls overlapped.

## Real as-is comparison

The diagnostic matcher was frozen as exact normalized anchor containment on the
exact physical page with exact stage and PDF identity. It does not use fuzzy
matching or post-hoc aliases. `Signal` plus its linked `DesignationEvent` is one
candidate group. Missing agenda-number prefixes therefore remain false
negatives instead of being repaired after seeing output.

| PDF (oracle units) | Historical as-is audit | v3 exact diagnostic | Interpretation |
|---|---|---|---|
| Lac (4) | strict TP 1 / FP 1 / FN 3; raw anchors 2/4 | TP 2 / FP 0 / FN 2 | v3 matched L54 and L55; missed L36/L37 |
| Saint-Étienne (17) | semantic 16/17; strict N/A pending pre-frozen group/stage adjudication | quality N/A (`completed_invalid`) | as-is misses B154 and mis-stages the three BC units; v3 fails grounding |
| Valcourt (6) | strict TP 4 / FP 2 / FN 2 | TP 0 / FP 5 / FN 6 | known matcher false negatives: verbatim v3 excerpts omit frozen `7.x` prefixes; observed anchors V71–V75 are not rescored |
| Saint-Barthélemy (8) | semantic 8/8 but physical-page grounding 0/8 | TP 1 / FP 2 / FN 7 | exact matcher finds S739M; longer frozen anchors create known false negatives |
| Waterloo (1, partial) | target 1/1 semantically, strict 0/1; precision N/A | quality N/A (`transport_failed`) | two bounded attempts yielded no response |

No aggregate precision/recall is reported: two documents have no valid v3
quality result, Waterloo has only a partial oracle, and the exact matcher has
known false negatives on otherwise verbatim Valcourt/Saint-Barthélemy excerpts.
The historical v1 mesh pilot is not pooled with either track.

## Protocol deviations and limits

- `maxOutputTokens: 16384` was requested in all receipts but absent from every
  captured provider request body. Saint-Étienne returned 22,579 output tokens.
  The output cap was therefore not applied on the wire; this alone blocks a fair
  v2/v3 or model ranking until a fresh freeze attests the effective field.
- Response-text hashes and normalized output-file hashes are separate. Lac and
  Saint-Barthélemy differ because output JSON was normalized before persistence.
- The frozen grouping implementation and the profile relation shape can produce
  duplicate/missed fact diagnostics. It is preserved, disclosed, and not tuned
  against these outputs.
- The exact matcher intentionally creates Valcourt/Saint-Barthélemy false
  negatives. A generic, reviewed rule may be frozen only for a future campaign;
  it cannot retroactively rescore v3.

## Frozen blind bundle

The bundle contains only the three `completed_valid` outputs plus their original
page text, under stable aliases. Its SHA-256 is
`1f1cf98af08c5bd998dfbc1ee014fb963d26a704ae8f89dbe096e687894e3991`.
The mapping records response-text and output-file hashes separately. No judge
was launched. A future campaign must freeze a generic anchor rule, prove the
actual wire output cap, freeze output-file hashing before calls, and obtain an
independent freeze review before launch.
