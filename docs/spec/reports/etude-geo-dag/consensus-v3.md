# Consensus v3: moving radar PV scraping and signal detection to a managed DAG in geo

Inputs: `proposition-opus.md`, `proposition-muse.md`, `consensus-v2.md`, conductor decisions C1-C4, geo review of v2
on geo `22d74b52` (2026-10-31, no veto, 7 points G1-G7). Detailed asks: `requests-cluster-mesh.md`, `requests-engram.md`.
Legend: `[V]` checked in code on origin/main (section 0); `[A]` asserted, not re-checked = `unverified`.
L0 cross-repo ADR counterpart: **geo-cond**.

## Decisions applied

- **C1.** "Cluster mesh" = `@sentropic/cluster-mesh` 0.25.0: control plane composing `llm-mesh` and the LLM gateway.
  Not an orchestrator: no cron, no DAG, no durable queue [V3, V4].
- **C2.** Signal detection moves to geo. The ontology profile is shared by immo and geo, owned jointly by radar and geo,
  not by Engram. Radar keeps canonical merge, facets and scoring. D3 arguments in annex A.
- **C3.** Orchestrator = `@sentropic/s3-dag` (geo `packages/s3-dag`); 4 ratification proofs in L0; Argo = documented
  alternative.
- **G1.** Reuse geo's existing PV chain (`pv-capture-backlog`), do not build a new one; L3 extends it.
- **G2.** Capture follows `SPEC_CAPTURE_ON_CLUSTER`: raw bytes, manifest and logs written directly to S3; the manifest
  is the v2 proof.
- **G3.** Events follow `SPEC_QC_ZONING_EVENTS_V2` (v2.1): `reconcile` produces the PV events geo serves (ADR-0023);
  no parallel graph.
- **G4.** No dynamic fan-out in s3-dag (frozen scope); one DAG per city with a bounded document batch; fan-out is not an
  L3 precondition.
- **G5.** Contract follows the geo convention (`latest.json` + `snapshots/<sha256>.json`, snapshot-then-CAS), per-city
  detail referenced from the snapshot, with a size budget.
- **G6.** Moving to the gateway pool amends geo ADR-0034 inside the cross ADR; ADR-0024 unchanged.
- **G7.** Quota belongs to poc-k8s (tenant); figure to obtain before L3. Geo: at most 2 open PRs to main; each lot ends
  merged.

## 0. Facts checked (origin/main)

| # | Claim | Where |
|---|---|---|
| V1 | Radar refresh CronJob `0 5,11,17,23 * * *`, `Forbid`, `backoffLimit: 0`, `activeDeadlineSeconds: 19800`, `suspend: true` base, `flock` on RWO PVC keyring; only duration cited = 2 h 41 proxy | radar `d25eb5ac2` `deploy/k8s/34-refresh-cronjob.yaml` |
| V2 | Radar pins Engram 0.21.2, `llm-mesh` 0.19.2; Engram main = 0.23.0 | radar `api/package.json`; graphify `310a9270` |
| V3 | cluster-mesh main 0.25.0 exports `./llm-mesh`, `./gateway`, `./compose/gateway`, `./mcp/registry` | sentropic `fb454cb4c` |
| V4 | cluster-mesh M01 messaging is process-local; restart discards messages | `packages/cluster-mesh/design/M01-messaging.md` |
| V5 | h2a `gateway-host` runs on `cluster-mesh/llm-mesh` with Codex and Cloud Code runtime clients | h2a `9ea4db7c5` `gateway-host/host.ts` |
| V6 | s3-dag: DAG known at build, "No dynamic node"; `concurrencyKey` = mutual exclusion | geo `packages/s3-dag/src/dag.ts` |
| V7 | `MIGRATION_D1_SYNTHESIS.md`: s3-dag recommended, Argo fallback; §D: stay scoped, "étendre `pv-capture-backlog`, PAS réécrire", scope budget frozen, re-examine above 20 sustained concurrent Jobs; cost custom ~20-30 d (PV canary + core) + 10-15 d hardening (geo judgment) | geo `docs/spec/` l.75-86 |
| V8 | ADR-0023: geo owns PV acquisition, indexing, served PV events; 5 492 PV indexed (July); immo consumer | geo `docs/decisions.md` l.471 |
| V9 | Radar docs still claim PV acquisition and Signal delivery for immo | radar `docs/architecture.md` l.560, `SPEC_EVOL_REFRESH_018.md` l.7 |
| V10 | `geo-pv-refresh-cronjob.yaml` untracked locally, absent from main (confirmed by geo) | local `git status` |
| V11 | Radar signal kinds `ppcmoi`, `derogation`, `cptaq-dezonage`, `residential-rezoning`, `intention`, `precedent` | radar `signals.ts` |
| V12 | cluster-mesh has a token exchange client and an NHI lifecycle port | `cluster-mesh/src/{token-exchange,nhi}.ts` |
| V13 | llm-gateway: opt-in budget admission port; pool ports are interfaces + stubs, no DB, no KMS | `llm-gateway/src/ports/{budget,pool}.ts` |
| V14 | Engram 0.23.0 `OntologyCitation` has `excerpt`, `docSha`; `mergeExtractions` keeps the last node per id | graphify `src/types.ts`, `src/extract-git.ts` |
| V15 | Geo PV chain exists: `acquisition/src/lib/pv-capture-backlog.ts`, `pv-capture-backlog-run.ts`; synthesis §A: it "porte déjà manifeste immuable, état CAS, phases" | geo |
| V16 | `deploy/capture-job/cronjob-capture-refresh.yaml` and `deploy/k8s/pv-probable-backlog-cronjob.yaml` both define CronJob `geo-pv-backlog-pv-probable-20260728-b32de19169bc`, `*/2 * * * *` (same name, two files) | geo |
| V17 | Capture manifest fields `url`, `retrieved_at` ("le champ que la preuve v2 exige"), `http_status`, `sha256`; logged on-cluster capture "PRODUIT MÉCANIQUEMENT la preuve v2" | geo `SPEC_CAPTURE_ON_CLUSTER.md` l.17, l.178-183 |
| V18 | Events v2.1: geo never writes immo's graph; `event_id = sha256(muni \| source_ref \| detection_anchor)`; immo joins on `event_id`; later `bylaw_numero` = `version++` on the same id | geo `SPEC_QC_ZONING_EVENTS_V2.md` l.5-22 |
| V19 | Served contract: `latest.json` -> `snapshots/<sha256-hex>.json`, deterministic JSON, CAS `If-None-Match` then `If-Match` | geo `SPEC_GEO_SERVED_CONTRACT.md` l.12-44 |
| V20 | Backup copies `exports/immo/` as "rebuildable but small JSON" | geo `deploy/ci/backup/README.md` l.141 |
| V21 | ADR-0034 (accepted 2026-09-25, not effective before PV jobs resume): PV extraction LLM = immo refresh policy; ADR-0024: Mistral vision-chat banned, `/v1/ocr` only | geo `docs/decisions.md` l.825, l.483 |
| V22 | ns `geo` has ResourceQuota `tenant-quota`; geo `CLAUDE.md`: max 2 open PRs to main, CI guard `max-open-prs.yml` | geo `deploy/acquisition-job/README.md` l.92, `CLAUDE.md` l.52-55 |
| V23 | `packages/geo-sources-americas/scripts/build-municipal-directory.py` **is present** on geo main (commit `7695b50b`, 2026-06-15). This contradicts geo's "not found"; the 0 Python conflict stands (script, not a job) | geo |

Not verified: cluster now at 2 nodes (geo statement; radar cost report Jul-Aug shows 2 `b3-8` nodes on a sub-period;
current count `unverified`); quota figure (to obtain from poc-k8s, G7).

## 1. Points of agreement

1. Radar today: one sequential pod, ~528 cities, at most 1 document per city per pass, S3 cursor, keyring singleton,
   Pending watchdog from the 2026-10-09 incident [V1]; full-pass duration `unverified`.
2. Weak points: `no-baseline` cities never scraped; same sites scraped twice; two adapter sets and two PV ontologies; no
   systematic signal x lot x valuation join; geo DAG layer not proven yet.
3. ADR-0023 already gives PV to geo [V8]; radar docs must be amended by the cross ADR [V9].
4. Idempotent k8s Jobs (Node/TS), immutable S3 artifacts keyed by input hash, CAS promotion, freshness on the last
   promoted artifact. Engram = extraction library; cluster mesh carries no PV bytes.
5. Pay only for new documents. Shadow first, parity gate, old path never removed in the step that arms the new one,
   rollback rehearsed in preprod, Make only with `ENV` last, 0 Python, Loi 25 owner fields excluded.

## 2. Disagreements

**Settled.** D1 orchestrator -> C3. D2 role of cluster mesh -> C1 (Opus position; Muse read 0.1.0). D3 detection -> C2
(annex A). Muse's "duplicate backlog CronJobs" claim is confirmed [V16].

**Kept, with both positions.**
- **D4. Contract location.** *Opus:* new `pv-signals/v1` path with per-city revisions and receipts. *Muse:* additive minor
  of `geo-served-contract` v1.0.0. *Now:* separate contract name, same geo convention (G5); geo-cond confirms in L0.
- **D5. Cutover granularity.** *Opus:* city cohorts by allowlist, per-city rollback. *Muse:* one switch, radar CronJob
  suspended during an observation window (>= 4 cycles, 7 days suggested `[A]`). *Recommendation:* cohorts plus window.
- **D6. Durable queue.** *Opus:* s3-dag S3 state suffices. *Muse:* cluster mesh queue. *Recommendation:* P3 (F-CM7).
- **D7. Freshness.** *Opus:* current cadence. *Muse:* 4 passes/day may be a monolith artefact. *Recommendation:* no
  regression versus today.
- **D8. Effort units.** Opus agent-days, Muse person-weeks; geo's own D1 estimate added (section 6).

## 3. Recommended architecture

- **Chain:** geo's existing PV chain (`pv-capture-backlog` + its CronJobs, 5 492 PV indexed [V8, V15]) driven by s3-dag:
  **one DAG run per city**, bounded document batch per run [G4, V6]; `concurrencyKey = source host` for politeness.
- **Nodes:** `detect` (PV index diff + coverage) -> `capture` (G2: bytes, manifest `url/retrieved_at/http_status/sha256`
  and logs straight to S3 = v2 proof [V17]) -> `text` (pdftotext; OCR `/v1/ocr` only, ADR-0024) -> `extract` (Engram,
  shared profile, gateway) -> `verify` (removal-only) -> `reconcile` (G3: produces the served PV events of events v2.1,
  `event_id` rule [V18]; no parallel graph) -> `signals` (radar `signals.ts` rules ported unchanged [V11]) -> `join`
  (lot, zone, role without owner fields) -> `promote` (snapshot-then-CAS).
- **Shared profile:** versioned artifact with digest, co-owned by radar and geo, change process in the cross ADR;
  pinned in every run identity. Engram provides bundle and validation mechanics only.
- **Cluster mesh:** gateway batch profile (pooled seats, budget, shared 429 cooldown, usage receipts), workload identity
  per lane service account, MCP supervision over the s3-dag read-model.
- **Contract (G5):** `s3://sentropic-geo/exports/immo/pv-signals/v1/latest.json` -> `snapshots/<sha256>.json` (city index:
  slug, revision sha256, object URI, counts) -> per-city immutable objects `cities/<slug>/<sha256>.json` (documents with
  doc_sha, source_url, extraction CAS key, model_receipts, coverage_state; events by `event_id`; signals with kind,
  etape, etape_date, zone_ref, no_lot, reglement_number, evidenceRefs; joins). Order: write per-city objects, then the
  snapshot, verify hashes, then CAS the pointer. Extraction bodies and PDFs stay out of `exports/immo/` (CAS keys only).
- **Size budget (proposal, geo-cond confirms in L0):** snapshot <= 1 MiB (1 106 rows x ~0.3 KiB ~ 330 KiB `[J]`);
  per-city object <= 256 KiB; whole `exports/immo/pv-signals/` <= 100 MiB including retained revisions, older revisions
  pruned beyond that, since backup copies the prefix as small JSON [V20].
- **Radar:** `radar-pv-consume` (no scraping, no LLM) reads the delta, joins on `event_id` [V18], maps it to its `::` node
  ids in the guarded canonical merge (`upsertGraphAtomic`), keeps facets and scoring; no local signal derivation; a geo
  signal that does not land in the canonical graph stays `needs_review`. `geo_resolutions` fed from `join`.
- **Alternative:** if the canary fails the 4 proofs, Argo Workflows.

## 4. Functions requested (index; contracts in the request files)

| ID | Function | Prio | | ID | Function | Prio |
|---|---|---|---|---|---|---|
| F-CM1 | gateway pool state, k8s batch profile | P1 | | F-EN1 | incremental extraction cache + coverage port | P1 |
| F-CM2 | budget admission + shared 429 cooldown | P1 | | F-EN2 | profile bundle with digest + compatibility check | P1 |
| F-CM3 | workload identity for lane service accounts | P1 | | F-EN3 | headless bounded batch mode with receipts | P1 |
| F-CM4 | durable usage-receipt ledger + export | P2 | | F-EN4 | citation-preserving `mergeExtractions` | P1 |
| F-CM5 | MCP supervision namespace over s3-dag | P2 | | F-EN5 | removal-only verification in library | P2 |
| F-CM6 | run-provenance attestation | P3 | | F-EN6 | render `properties`/`extraction_hints` | P2 |
| F-CM7 | restart-durable messaging | P3 | | F-EN7 | closed-partition validation per city | P2 |
| F-CM8 | cross-server discovery and revocation | P3 | | F-EN8 | typed links to geo referential ids | P2 |
| | | | | F-EN9 | profile-driven event/signal validation | P2 |

Geo-internal, not asks: mounting `/v1/refresh` in geo-api; PV -> events reading S3. Dynamic fan-out dropped (G4).

## 5. Migration by lots, no radar downtime

Geo lots respect the 2-open-PR limit and each lot ends merged [V22].

| Lot | Content | Coexistence | Switch | Rollback |
|---|---|---|---|---|
| L0 | Cross ADR with geo-cond: amend radar docs [V9], detection to geo, shared profile governance, `event_id` -> `::` mapping, ADR-0034 amendment (gateway pool), ADR-0024 unchanged, contract + size budget, parity thresholds, observation window. s3-dag canary = existing `pv-capture-backlog` chain under s3-dag on the preprod bucket, 4 proofs per `s3dag-canary-runbook.md`. Hygiene: duplicate CronJob [V16], untracked CronJob [V10], image digests | nothing moves | owner record (section 7) | n/a |
| L1 | Radar to Engram 0.23 (+F-EN4); shared profile v2.2 published with digest; geo graphify 0.17.1 PV profile aligned | refresh unchanged | merge | repin 0.21.2 |
| L2 | F-CM1..CM3 in preprod with one Job; flag `REFRESH_LLM_TRANSPORT=gateway` | dual LLM path | flag | flag `keyring` |
| L3 | Quota figure from poc-k8s first [G7]. Extend the canary chain to radar's 528 cities (`detect -> capture -> text`), one DAG per city; parity = geo existing corpus vs radar sweep reports (sha sets) | radar unchanged | none | stop DAG |
| L4 | `extract -> ... -> promote` preprod shadow on a sample + v101b benchmark; `radar-pv-consume` dry-run: canonical and signal diff per city/kind, facets attached before = after | double LLM on sample | none | stop |
| L5 | Preprod cohorts via allowlist; radar refresh skips them; rollback rehearsed once | disjoint city sets | widen | remove city + canonical pre-image |
| L6 | Prod cohorts | idem | widen per step | idem |
| L7 | `join` (role after Loi 25 decision); `geo_resolutions` from contract; `run-geo-mapper` shadow then off | double compute | flag | re-enable Job |
| L8 | After the window: retire `radar-refresh-pv`, watchdog, keyring PVC, RECUEIL, radar signal derivation; PV adapters to geo `qc-sources` | none | merge | pinned previous tag |

Hard order: no L1+ geo work before canary proofs; no L3 without the quota figure; no L5 before L4 parity; no L8 while a
city is outside the allowlist. Make targets to create, `ENV` last: radar `make pv-consume-render|apply|diff ENV=preprod`;
geo `make pv-dag-render|apply|status ENV=preprod`.

## 6. Risks, costs, effort

| Lot | Opus (agent-days) | Muse (person-weeks) | Run cost | Main risk |
|---|---|---|---|---|
| L0 | S + canary (geo: custom ~20-30 d incl. canary [V7]) | days | canary only | proofs fail -> Argo |
| L1 | S-M | n/a | one benchmark | extraction regression 0.21 -> 0.23 |
| L2 | M (sentropic) | n/a | 0 extra | seat terms (Q1); pool has no DB yet [V13] |
| L3 | M | 2-4 | geo CPU, 0 LLM | 2-node cluster `unverified`, quota unknown; robots, IP blocks |
| L4 | L | 4-8 | double LLM on sample (Q2) | signal drift after port; `event_id` mapping orphans facets |
| L5-L6 | M | days | radar cost decreases | incomplete snapshot read as complete |
| L7 | M | medium | low | resolution rate 70-85 % `unverified`; Loi 25 |
| L8 | S | in L4 | -1 pod, -1 PVC, -1 watchdog | premature deletion |

Cross-cutting: geo's 2-PR limit serialises geo lots; s3-dag scope frozen, any loop/signal need reopens a dossier [V7];
Engram roadmap drifting to agent memory; shared-profile governance can stall changes; Python script in geo [V23].

## 7. Owner decision required (single)

**Ratify the L0 cross ADR** (prepared with geo-cond), as an owner-direct record. Two questions are attached to it:
1. May the gateway pool personal Codex and Cloud Code seats for unattended batch extraction (terms of use; cross-user
   grants are gated in the gateway pool [V13])? If not, which provider accounts back F-CM1?
2. What LLM budget, and on which sample, is accepted for the L4 shadow double run?

Note: geo's canary runbook already carries its own owner gates (VAP + run GO, then ratification GO). They are existing
geo gates, not new decisions created by this study.

## Annex A. D3 arguments (settled by C2)

*Opus (geo stops at verified extractions):* ADR-0013 keeps ontology, scoring and app at immo; keeping signal derivation
next to the canonical graph protects facets keyed on radar `::` ids; smaller first step.
*Muse (geo single producer up to signals):* ends duplicated adapters, registries and PV chains; one `coherence_id` for
signal, lot, zoning and valuation makes the valuation join native; radar becomes a pure consumer.
*Resolution:* detection in geo per Muse, through geo's served events (G3); canonical merge, facets, scoring and joint
profile ownership stay with radar per Opus's safeguards; facet survival is an L4 gate.
