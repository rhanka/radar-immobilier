# Extraction baseline audit before live benchmark

Status: frozen analysis on 2026-09-13. No provider, Kubernetes, S3, or live
extraction call was made for this audit. Missing cells stay missing; no score or
model recommendation is asserted yet.

## Names that must not be conflated

| Name used below | Runtime and contract | Comparable status |
|---|---|---|
| Workstation CAS baseline | Immutable run `run-dryrun2-final-20260911T215911Z`; custom four-step CAS pipeline; `claude-sonnet-4-6 --effort low` | Historical context, scored separately |
| September 11 CLI campaign (`bench/v2` folder) | Global Graphify 0.17.1, repository Graphify 0.10.0; 40 calls | Strict output unusable; mechanical `node_type` bridge is diagnostic only |
| Mesh pilot v1 | Graphify 0.18.0; frozen five-PDF campaign on branch `feat/refresh-benchmark` | Immutable and not rankable: no output passed the then-underspecified strict citation contract |
| T1 contract `refresh-pv-018.2` | Receipt `contract-v2-receipt.json`, commit `99dbb89e` | Provider calls: 0; superseded |
| T1 contract `immo-pv-extraction-v3` | Receipt `immo-pv-extraction-v3-receipt.json`, Graphify 0.18.0 | Provider calls: 0; current semantic target, not a successful extraction |

The CAS pipeline is local corpus -> semantic JSON -> deterministic v2.3
conversion/merge -> candidate graph. The preserved run contains 139 documents,
40 cities and 330 calls, but published zero candidates. Its canonical old graph
contains none of the five recent source hashes below, so it is not a manual gold.

## Frozen five-document oracle

Selection rule: maximize independently written manual truth while retaining only
public PDFs compatible with v3. The September 11 gold was frozen before its runs
(SHA-256 `95315d4daea878d8be6181aaa925dde4ae96c1115f607d6b45667e33a4670893`).
Its four PDFs are retained; its Warden TXT without a public URL is replaced by
the strict Waterloo page-regression oracle. This yields 36 independently anchored
units. Existing v1 output availability did not drive selection.

| Document | Exact source identity | Manual units | Representative required evidence |
|---|---|---:|---|
| Lac-des-Seize-Îles, September 2026 agenda | `6bfd190a0aff3ea2679edf5bdf7e727161d24052ce08c0c385427b0ec3c07a96`; [PDF](https://www.lac-des-seize-iles.com/fichiersUpload/fichiers/20260911113130-projet-odj-septembre-2026.pdf) | 4 | Page 1; agenda items remain planned, never acquired decisions |
| Saint-Étienne-de-Bolton, 2026-08-04 | `27799681a178dd23d99596d78811ff5c678be649901748e0eca3d9b0eb26c45d`; [PDF](https://sedb.qc.ca/wp-content/uploads/2026/08/PV_4-AOUT-2026-1.pdf) | 17 | Page 13: “le conseil municipal refuse ... réduire à 2,4 mètres la marge latérale de 3 mètres”; preserve refusal, address and dimensions |
| Valcourt, 2026-06-01 agenda | `31df8f116d84d1f50ef34a2aa8f746c6025c56089383b27345b901c8e45c026d`; [PDF](https://www.valcourt.ca/app/uploads/2026/09/1er-juin-2026.pdf) | 6 | Page 1: “1070, RUE BISSONNETTE ... CONSTRUCTION DE DEUX BÂTIMENTS ... JUMELÉS”; planned PIIA, not adoption |
| Saint-Barthélemy, 2026-09-08 | `ac5306d7efd793dc3b456afaf203b1d1a8e495456099ac560457f56591953845`; [PDF](https://www.saint-barthelemy.ca/storage/app/media/municipalite/conseil-municipal/ordre-du-jour-et-proces-verbaux/Proc%C3%A8s-verbaux/2026/Proc%C3%A8s-verbal%20-%20S%C3%A9ance%20ordinaire%20-%208%20septembre%202026.pdf) | 8 | Page 4 motion and page 5 first project for bylaw 739-26; keep the two stages distinct and zones R-7/R-8 |
| Waterloo, 2026-08-18 | `c18dcea9adf05d028f5ee1c71b2244fb3dc5e83acdab86996c81401d4038cebd`; [PDF](https://ville.waterloo.qc.ca/wp-content/uploads/2026/09/Proces-verbal-de-la-seance-du-18-aout-2026.pdf) | 1 | Physical page 3: “adopte le Règlement 26-956-2 ... projets intégrés”; reject historical page 1 and invented force/unit counts |

The full 35-unit September 11 PDF annotations, including every page, excerpt,
stage and source URL, are in the immutable `bench/v2/gold.json`; Waterloo's one
unit is frozen in `api/tests/fixtures/refresh-018/oracle.json` on
`feat/refresh-benchmark` and summarized in `oracle-candidate.md` here.

## What can be compared

| Track | Lac | Saint-Étienne | Valcourt | Saint-Barthélemy | Waterloo | Interpretation |
|---|---:|---:|---:|---:|---:|---|
| Manual oracle | 4 | 17 | 6 | 8 | 1 | Primary truth, fixed before scoring |
| Workstation Sonnet 4.6 low | present | present | present | present | present | Historical prompt/process only |
| September 11 CLI campaign | present | present | present | present | absent | Separate 0.17.1/0.10 diagnostic; strict conversion delivered zero typed findings |
| Mesh pilot v1 | absent | attempted, transport failure | absent | Luna high response | several responses | Immutable, not rankable under v3 |
| T1 v2 / v3 | no semantic run | no semantic run | no semantic run | no semantic run | local empty mock only | Contract evidence, never extraction quality |

Known historical defects become checks, not answer hints: agenda-as-adoption,
wrong physical pages, refusal inversion, matricules mislabeled as cadastral lots,
and unsupported force/unit claims. Historical results are scored against the same
oracle but never pooled with fresh matched runs.

## Frozen fields and scoring rules

Each finding must preserve exact `docSha`, `sourceUrl`, `rawRef`, modality,
physical PDF page and a non-empty excerpt present on that page. Semantic fields
cover typed Signal/DesignationEvent, stage, outcome, date, bylaw, zone, lot,
address and stated dimensions. A Signal plus its DesignationEvent is one oracle
unit, not two. Agenda items are not realized decisions; refusals remain refusals;
matricules are not silently promoted to lots. Unsupported or wrong-source facts
are false positives. Machine schema/page/excerpt checks precede blind judging.

Judges score 0-4 for grounding, stage/regulatory interpretation, coverage,
absence of unsupported claims, and source traceability, with page/excerpt proof.
Candidate identity and effort are blinded; disagreement remains visible.

## Execution gate and enrollment state

Before a candidate call, regenerate and freeze the exact current-HEAD v3 source,
prompt, schema, five PDF/page-text inputs and oracle hashes. The existing v3
receipt identifies commit `f195efeb`; later grounding/retry changes mean it must
not stand in for a fresh current-HEAD freeze. Use identical prompt/schema/input,
retry and output budgets for all eligible candidates; deduplicate attempts by a
stable case key and retain failed attempts.

The qualified owner-scoped Codex subscription account is pseudonym
`acct-c015cb459d`; Luna and Sol resolve natively. Codex 5.3 is absent/deprecated
and remains unsupported with no substitution. Cloud Code/AGY is not enrolled,
so Gemini 3.8 remains blocked until that identity is proved. Native Fable 5 has
since been attested in independent reports as effective `claude-fable-5` through
the Claude profile with gateway off; before judging, run a non-candidate preflight
that records requested/effective Fable identity and xhigh effort.

Planned fresh matrix remains Codex 5.3, Gemini 3.8, Luna and Sol at explicit
normal/medium and high. Judges remain Sol xhigh and Fable 5 xhigh. All calls must
flow through enrolled subscription identities in llm-mesh/H2A, never raw paid
API keys. Capture attributable per-call usage plus quota snapshots immediately
before and after candidate and judge phases when exposed; shared-account quota
deltas are observations, not causal cost attribution.
