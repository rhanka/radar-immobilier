# bascule-2tenants — e2e orchestrator (immo + geo), proven coherence

Quadrant 7 of the backup/restore matrix: the **e2e immo+geo "bascule iso-prod,
2-tenant coherence"** orchestrator. It **orchestrates** the two per-tenant
bascules around one coherence identity (`CYCLE_ID`) and **proves** cross-tenant
coherence by a **byte-identity join-verify** of the served `canonical_id` sets.

It does **not** re-implement the per-tenant bricks. Dump S1 / restore S2 /
migrate S2c / copy-docs S3 / recon S3b / flip S5 / refresh S6 / smoke S7 and the
G1–G4 guards live in each tenant's own bascule (immo:
`deploy/ci/bascule-preprod/bascule.mjs` + `.github/workflows/bascule-preprod.yml`;
geo: its own repo). This layer dispatches those workflows and reconciles state.

- Design contract: `docs/spec/reports/SPEC_ORCH_BASCULE_2TENANTS_COHERENCE.md`.
- Ratified perimeter: `docs/spec/reports/DOSSIER_DECISION_PRA_BASCULE_ISO_PROD_2026-09-24.md`
  (see §9 — the canonical_id normalization divergence risk this join-verify closes).
- 0 python. Node ESM + native binaries only (`git`, `unzip`).

## Locked contract (i-cond ⇄ geo-cond, 2026-09-25)

This supersedes SPEC §2/§3, which had modelled the geo dispatch as an in-cluster
Job in the `geo` namespace and the join-verify surface as an S3 manifest. The
**arrested** mechanism is GitHub-native and symmetric:

1. **Dispatch — both legs by `workflow_dispatch`.** The orchestrator dispatches:
   - immo → `rhanka/radar-immobilier` `.github/workflows/bascule-preprod.yml`
   - geo  → `rhanka/geo` `.github/workflows/bascule-preprod.yml`

   with inputs `{ CONFIRM: iso-prod-AAAA-MM-JJ, DRY_RUN: false, SKIP_ROLLOUT:
   false, CYCLE_ID }`. No h2a envelope, no Job launched by the orchestrator: each
   tenant's CI drives its own cluster. The orchestrator only **dispatches**
   (`actions:write`) then **follows** status **STATUS-ONLY per job** (`pg`, `s3`)
   via the GitHub API (`actions:read`).

2. **Join-verify — symmetric GitHub artefacts.** Each leg publishes, at the end of
   its bascule (after smoke S7, 0 cred, from the tenant's **public preprod API**,
   via `@sentropic/geo` `buildServedCanonicalIds`), a byte-sorted (`LC_ALL=C`)
   served-ids file + its sha256:
   - immo → artefact `immo-served-canonical-ids-<CYCLE_ID>`
   - geo  → artefact `geo-served-canonical-ids-<CYCLE_ID>`

   The orchestrator downloads both and compares **byte-à-byte**: `status = match |
   drift`. On drift → **redo-on-drift** (bounded by `BASCULE2_MAX_REDO`, SPEC §5.4).

3. **`cycle.json`** (locked schema — `cycle.mjs`): each leg writes its own
   `legs.<tenant>` sub-branch (published as `cycle-leg-<tenant>-<CYCLE_ID>`); the
   orchestrator merges them and computes `join_verify`:

   ```jsonc
   {
     "cycle_id": "iso-prod-2026-09-25-<nonce>",
     "confirm": "iso-prod-2026-09-25",
     "created_at": "…",
     "orchestrator_run_id": "…",
     "legs": {
       "immo": { "repo", "workflow", "run_id", "sha_main", "t1",
                 "verdict": { "pg", "s3" }, "served_ids_artifact", "served_ids_sha256" },
       "geo":  { … same shape … }
     },
     "join_verify": { "status": "pending|match|drift", "compared_at", "diff_summary" }
   }
   ```

## The two seams (pluggable, typed)

Both couplings that touched a cross-repo/cross-tenant contract are modelled as
**typed, pluggable interfaces** with a **wired** default and a documented
**inert** default (switch with `*_MODE=inert`):

| Seam | Interface | Wired impl | Inert default | File |
|---|---|---|---|---|
| Geo-leg dispatch | `LegDispatcher` | `GithubWorkflowDispatcher` | `InertDispatcher` | `dispatch.mjs` |
| Join-verify rendezvous | `ServedIdsRendezvous` | `GithubArtifactRendezvous` | `InertRendezvous` | `join-verify.mjs` |

`makeDispatcher(env)` / `makeRendezvous(env)` select the impl (`github` default).

## Files

- `cycle-orchestrator.mjs` — CLI: `cycle-open`, `dispatch`, `follow`,
  `join-verify`, `run`, `status`.
- `cycle.mjs` — pure: `CYCLE_ID` (RFC1123, SPEC §1.1) + the locked `cycle.json`
  schema + leg merge + join_verify transitions.
- `served-canonical-ids.mjs` — join-verify byte-identity core: `buildServedIds`
  (consumes `@sentropic/geo` `buildServedCanonicalIds`), `sha256Hex`,
  `byteCompare` (match|drift), `subsetCheck` (SPEC §3.1 `immo_refs ⊆ served`).
- `geo-loader.mjs` — resolves `@sentropic/geo@>=0.6.2` via the **api anchor**
  (immo pins it in `api/package.json`; ESM-only `exports`, so we locate the
  package dir and import its ESM entry directly).
- `dispatch.mjs` / `join-verify.mjs` — the two seams.
- `publish-immo-served-ids.mjs` — the immo-leg entrypoint (run in the immo
  bascule workflow) that builds `immo-served-canonical-ids-<CYCLE_ID>`.
- `cycle-orchestrator.selftest.mjs` — 0-network self-test (pure model + the geo
  import proof + the §9 byte-identity proof + inert-seam checks).

## Anti-divergence (dossier §9)

immo historically computes `code_norm` / `no_lot_norm` with **local** normalizers
that **diverge on zones** (e.g. `C408` vs the served `C-408`). The join-verify
sidesteps that entirely: it re-canonicalizes immo's refs **from the RAW value**
through the **same** `@sentropic/geo` canonicalizers geo serves with
(`buildServedCanonicalIds` applies `canonicalizeZoneCodeForJoin` /
`canonicalizeNoLotForJoin` internally), so the two sides are **byte-identical by
construction, not by measurement** — with no prod migration. The follow-up
migration of immo's write-path normalizers is a separate lot (dossier §9(b),
owner call).

## Run

```bash
node deploy/ci/bascule-2tenants/cycle-orchestrator.selftest.mjs   # 0 network, exit 0 if OK
CONFIRM=iso-prod-2026-09-25 node deploy/ci/bascule-2tenants/cycle-orchestrator.mjs cycle-open
```

`dispatch` / `follow` / `join-verify` / `run` hit the GitHub API and **TRIGGER
the production bascules** — do not run them from a scaffold.

## Dependencies to provision (owner / infra — not needed for the scaffold)

- **`GEO_DISPATCH_TOKEN`** — cross-repo `workflow_dispatch` of `rhanka/geo` needs
  `actions:write` on `rhanka/geo` (fine-grained PAT or GitHub App). The default
  `GITHUB_TOKEN` does not carry it; the orchestrator reads this named secret and
  **fails closed with an actionable message** if it is absent. The immo leg is
  same-repo (`GITHUB_TOKEN`).
- **`vars.BASCULE_IMMO_SERVED_REFS_URL`** — the immo public preprod endpoint that
  enumerates served entities as RAW `{citySlug, code_zone}` / `{citySlug, no_lot}`
  (see PENDING O1). Until arrested, `publish-immo-served-ids.mjs` fails closed.

## PENDING — to arrest with geo-cond before the real e2e run

- **O1 (source-gap).** The exact immo **and** geo public-preprod endpoint that
  enumerates served entities as RAW refs, and the zone key token
  (`code_norm` vs `code_zone`). Both sides must feed the **same** raw values to
  `buildServedCanonicalIds`.
- **O2.** Byte-order sort alignment: geo must serialize `LC_ALL=C` (byte order)
  before upload, matching `serializeServedCanonicalIds`.
- **O5.** `geo.json` / leg status granularity (`captured` then `verified`, or one
  terminal) — to shape the follow barrier.
- **Rendezvous file name.** The exact file name **inside** each served-ids
  artefact (`unzipSingleFile` currently requires exactly one file).
- **Run correlation.** GitHub does not return the run id created by a
  `workflow_dispatch`; `findRun` correlates by `event + ref + created>=`. Tighten
  once geo echoes `CYCLE_ID` in the run-name.
