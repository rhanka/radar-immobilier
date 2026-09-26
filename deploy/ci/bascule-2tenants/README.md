# bascule-2tenants — e2e immo + geo restore FROM BACKUPS, proven coherence

Restores **both** tenants' preprod from their daily backups of the **same date
D** and proves the cross-tenant coherence by an **inclusion join-verify** of the
served canonical ids (immo ⊆ geo, zones first). Replaces the draft #764 (live-dump
orchestrator, byte-equality, `@sentropic/geo` bump in `api/`): each leg now
builds its served ids with the **published** `@sentropic/geo@0.6.2` outside the
workspace (same pin on both sides), so the orchestrator only compares files.

- Ratified perimeter: `docs/spec/reports/DOSSIER_DECISION_PRA_BASCULE_ISO_PROD_2026-09-24.md`
  (§5 coherence by order + join-verify, §9 canonical id divergence).
- 0 python. Node ESM + native `unzip`. 0 kubectl, 0 S3/DB credential: GitHub API only.

## Files

| File | Role |
| --- | --- |
| `.github/workflows/bascule-e2e.yml` | `workflow_dispatch` (CONFIRM, DRY_RUN, BACKUP_DATE, ALLOW_STALE_BACKUP), environment `radar-e2e`, main-only; actions pinned by commit SHA |
| `orchestrator.mjs` | CLI: `cycle-open`, `capabilities`, `list-backups`, `choose-date`, `dispatch-restore`, `follow`, `collect`, `join-verify`, `publish` |
| `cycle.mjs` | pure model: CYCLE_ID, dispatch-input discovery, run correlation, common date, inclusion join-verify, `cycle.json` |
| `github.mjs` | GitHub API seam (dispatch, run status, artefacts, workflow file), fetch + unzip injectable |
| `orchestrator.selftest.mjs` | offline selftest (pure model + the whole chain against a fake GitHub + workflow wiring), run by `ci.yml` |

## Sequence

1. **cycle-open** — G3: `CONFIRM = iso-prod-<today UTC>` (anti-replay) → `CYCLE_ID = <CONFIRM>-<base36 T0>` (RFC1123, also valid for the geo pattern).
2. **capabilities** — BEFORE any dispatch, reads each leg's `bascule-preprod.yml@main` and requires the inputs `CONFIRM`, `DRY_RUN`, `MODE` (**`type: choice`** whose options hold `list` and `restore`; a free-string MODE is refused), `BACKUP_ID`, `CYCLE_ID`. A leg without them ⇒ **fail-closed**, nothing dispatched, with the list of what is missing.
3. **list-backups** — `MODE=list` (read-only, `DRY_RUN=true`) on both legs, follow, then read `backup-list-<tenant>-<CYCLE_ID>` / `backup-list.json` (`radar-backup-list/v1`). Each tenant reads **its own** backup bucket (`radar-immobilier-backup/manifests/`, `geo-backup/manifests/`) with **its own reader identity, in its own cluster** — the orchestrator runner never holds an S3 credential.
4. **choose-date** — newest date with a `complete` backup on **both** tenants, or `BACKUP_DATE` (refused unless complete on both). **Freshness: D at most 48 h old** (age from the older of the two backup captures `startedAt`, else D 00:00 UTC), else **refused**; the explicit input `ALLOW_STALE_BACKUP=true` accepts it and is recorded (`cycle.json`: `allow_stale_backup`, `backup.freshness`, and per leg `restore_run.allow_stale_backup` + `backup_age_hours`; forwarded to a leg that declares the input). Records `geo_after_immo` (geo backup start ≥ immo dump start = the superset-by-order property of dossier §5; warning when false, the join-verify decides). **List limit:** the immo list travels in a termination message (≤ 4 KiB) and holds the newest ~15 dates (`truncated: true`); a `BACKUP_DATE` outside a truncated list's window is refused with that window named (never assumed complete) — with the 48 h rule only the newest dates matter.
5. **dispatch-restore** — (not DRY) `MODE=restore BACKUP_ID=D CYCLE_ID DRY_RUN=false` on both legs, in parallel (only the inputs each workflow declares are sent; `SKIP_ROLLOUT=false` for geo when declared). **Every dispatch (list and restore) sends `CONFIRM` = today UTC at that instant** (a cycle may cross midnight; the owner's `CONFIRM` is checked at cycle-open), recorded as `confirm_sent`.
6. **follow** — run status only (`GET /actions/runs/{id}`).
7. **collect** — `cycle-leg-<tenant>-<CYCLE_ID>` / `cycle-leg-<tenant>.json`: `verdict.pg` and `verdict.s3` = `success`, `backup.date` = D.
8. **join-verify** — `<tenant>-served-canonical-ids-<CYCLE_ID>` / `served-ids.txt` (+ `.sha256`, checked, and equal to `legs.<tenant>.served_ids_sha256`). Both files: `ogc:zones:<slug>:<code>`, one per line, strictly increasing byte order. For each immo id absent from geo: **`city-not-served-by-geo`** when geo serves no zone of that city (tolerated, reported with the city list) vs **`divergent-code`** when geo serves the city but not that code (**fails**). No redo loop: backups are immutable, a re-run gives the same answer.
9. **publish** (always) — `cycle.json` (artefact `cycle-<CYCLE_ID>`, format `radar-bascule-cycle/v1`) + step summary; exit 1 unless the verdict is `success` (`dry-run-ok` in DRY).

Run correlation: GitHub does not return the run id of a `workflow_dispatch`. The
orchestrator matches **only** the run name `bascule-preprod <MODE> <CYCLE_ID>`
(immo #777, geo #408); **never by time**: no match within the correlation timeout
⇒ fail-closed, two matches ⇒ refusal (no guess).

## What k8s / the owner provide

| Item | For |
| --- | --- |
| Environment **`radar-e2e`** (deployment branch = `main` only, created) with secret **`GEO_DISPATCH_TOKEN`** (set). **Real token: the `gh` OAuth token of rhanka** (`gh auth token`; scopes repo, workflow, …) — it reaches **every repository of rhanka**, and is invalidated by any `gh auth logout`/refresh. The need is only Actions R/W + Contents R on `rhanka/geo`: **owner debt = replace it with a fine-grained PAT limited to `rhanka/geo`** — record in [`CRED_CYCLE.md`](CRED_CYCLE.md). Only the job `e2e` declares this environment, and the token is passed only to the steps calling the geo repository (capabilities, list-backups, dispatch-restore, follow, collect, join-verify) — never to checkout / setup-node / upload-artifact (pinned by commit SHA) | cross-repo dispatch + run status + artefacts of the geo leg |
| nothing else for the immo leg: this workflow's `GITHUB_TOKEN` with `actions: write` | immo dispatch, run status, artefacts |
| immo leg prerequisites (#777): pre-created Secrets `radar-backup-reader-preprod` + `radar-backup-restore-docs` (rewritten by the immo bascule from the environment `radar-bascule`), RBAC (secrets get/update by name, configmaps `immo-served-refs-*`, pods get/list), SA `radar-bascule-refs-writer` | immo `MODE=list` / `MODE=restore`, O1 refs |
| geo leg: pre-created Secret `geo-backup-reader-preprod` in `geo-preprod` (OVH user 809855: `pg/*`, `manifests/*`, `docs-inventory/*`, `docs/*`), rewritten by the geo bascule from the environment `geo-bascule` (`GEO_BACKUP_READER_PREPROD_*`), never a SealedSecret | geo `MODE=list` / `MODE=restore` |

## What the geo leg provides — `rhanka/geo` `bascule-preprod.yml` (rhanka/geo#408, pending merge)

Until it is on geo `main`, `capabilities` fails closed with this list:

1. `workflow_dispatch` inputs **`MODE`** (`type: choice`, options include `list` and `restore`; default = today's behaviour) and **`BACKUP_ID`** (`latest` | `YYYY-MM-DD`); keep `CONFIRM`, `DRY_RUN`, `CYCLE_ID`.
2. **`MODE=restore`**: restore geo-preprod from `geo-backup` at date D — resolve `manifests/<D>.json` (`status: complete` required, 24 h guard for `latest` only), dump/objects checked by sha256 before use, restore the served objects state at D (server-side copy from the versioned backup), then the existing recon / rollout / smoke. Reads with the geo reader identity, in-cluster, runner kubectl-only.
3. **`MODE=list`** (+ `CYCLE_ID`): artefact **`backup-list-geo-<CYCLE_ID>`** containing **`backup-list.json`**:
   `{ "format": "radar-backup-list/v1", "tenant": "geo", "bucket": "geo-backup", "latest": D|null, "latestComplete": D|null, "truncated": bool, "backups": [ { "date": "YYYY-MM-DD", "status": "complete|partial|incomplete", "pgSha256": "<hex>", "startedAt": "<ISO, backup capture start>" } ] }`.
4. `legs.geo` (artefact `cycle-leg-geo-<CYCLE_ID>`) gains **`backup: { id, date }`** in `MODE=restore` (the orchestrator refuses a leg whose `backup.date` ≠ D).
5. `geo-served-canonical-ids-<CYCLE_ID>` unchanged (already delivered by rhanka/geo#399).
6. **Required**: `run-name: "bascule-preprod ${{ inputs.MODE || 'chain' }} ${{ inputs.CYCLE_ID }}"` — the only correlation (never by time); provided by geo#408.

## Still open before a real e2e run

- **O1** — decided (no HTTP endpoint): the immo leg extracts the zone references read-only from its restored preprod DB (Job `radar-bascule-served-refs`, ConfigMaps `immo-served-refs-*`, #777) before its `served-ids` job; the orchestrator's `join-verify` fails closed while that artefact is missing.
- geo restore-from-backup mode (above, rhanka/geo#408) merged + geo daily backup armed (dossier §0.2).
- `GEO_DISPATCH_TOKEN` in `radar-e2e`: set — the gh OAuth token of rhanka (every rhanka repository); owner debt = fine-grained PAT limited to `rhanka/geo` (`CRED_CYCLE.md`).
- immo leg PR merged + its k8s prerequisites.

## Run

```bash
node deploy/ci/bascule-2tenants/orchestrator.selftest.mjs     # offline, exit 0 when OK
```

`bascule-e2e.yml` with `DRY_RUN=true` exercises steps 1–4 for real (capabilities,
both `MODE=list` runs, common date) without restoring anything.
