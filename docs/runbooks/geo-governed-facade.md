# Runbook — governed geo facade (I-1A)

Lot I-1A of the converged geo-mesh plan (`converged-r3.md` §2): an in-process
service + a governed route on the immo API, distinct from the existing public
prefix. This runbook is the operator reference for the served-contract
pointer (P1), the frozen route (P3), and the pilot scope (P2).

## 1. Routes (P3 — frozen)

- `GET /api/v1/geo-governed/catalog` — catalogue derived from the live
  `/collections` listing: served zonage entries plus every other collection
  listed with an explicit status (`unknown`, `not covered`, `not served`).
- `GET /api/v1/geo-governed/collections/:id/items` — bounded proxy (limit
  default 200, max 1000; only `limit`/`bbox`/`offset` pass through, `f=json`
  forced) for SERVED collections only, with the exact provenance header
  `x-geo-provenance: live-ogc` (served from the live OGC API) or
  `x-geo-provenance: pg-fallback` (served from the local store when live fails).

The governed root `/api/v1/geo-governed` is FROZEN. Renaming it needs an owner
decision (P3). It is NOT in `PUBLIC_PREFIXES`, so when auth is enabled the
`protect` middleware session-gates it. The public prefix
`/api/geo/collections` is unchanged and ungated (C1); this lot does not touch
it, `content-serve.ts`, `reader-storage.ts`, or `reader-operations.ts`.

## 2. Served scope (P2 — recount of 2026-11-03)

Live recount command (read-only, run against the public prod OGC API):

```bash
bash tools/geo-governed-recount.sh
```

Recount of 2026-11-03 (~08:30 UTC): 3 900 collections, of which **42
`qc-zonage-*` eligible** (exact title
`Creative Commons Attribution 4.0 International` + `rights` present).
Distinct titles observed: the CC-BY-4.0 title above,
`Donnée publique municipale (zonage) — MRC de Portneuf` (2 collections, no
rights), `Plan de zonage municipal Ville de Rosemère` (1 collection, no
rights), and `Unknown license` (the rest). Registry titles are unique
(covered by `governed-licences.test.ts`).

- Technical pilot city: **Gatineau** — served collection
  `qc-zonage-gatineau-affectations-territoire` (177 live features, rights
  present, CC-BY-4.0). The only complete dated per-collection record in
  `governed-policy.ts`; the 41 other eligible collections stay listed as
  `not covered` until they get their own dated field review.
- Business-pilot gap: `qc-zonage-salaberry-de-valleyfield` carries
  `Unknown license` on the live API, so historic-pilot Valleyfield is NOT the
  technical pilot. It becomes servable only via GEO-LIC1 (licence stamping by
  the geo side) + I-1C (allowlist extension), never by lowering the rule.

## 3. Served-contract pointer (P1 — status: `missing source`)

The pointer `exports/immo/geo-served-contract/v1/latest.json` (constant
`SERVED_CONTRACT_POINTER_KEY` in `served-contract-pointer.ts`) lives in the
geo bucket `sentropic-geo` — or, once the geo copy exists, in the dedicated
export bucket (for example `sentropic-geo-export-immo`); the bucket name
itself is configuration (`GEO_SERVED_CONTRACT_S3_BUCKET`). The
facade reads it ONLY through configuration:

- `GEO_SERVED_CONTRACT_S3_ENDPOINT`
- `GEO_SERVED_CONTRACT_S3_REGION`
- `GEO_SERVED_CONTRACT_S3_BUCKET`
- `GEO_SERVED_CONTRACT_S3_ACCESS_KEY`
- `GEO_SERVED_CONTRACT_S3_SECRET_KEY`

All five are optional. When ANY is absent — the current state, the credential
does not exist yet — the facade reports `missing source` explicitly (catalogue
and items `contract` fields) and never fabricates a `snapshot_sha256`. No
fallback to another bucket or credential is attempted.

### Who grants the read (geo-review-r3 G2)

- The grant is an act of infrastructure by the **k8s lane (ex-poc-k8s)**,
  which provisions the OVH S3 users for geo via the OVH API: a dedicated
  user per (bucket × env) with role `objectstore_operator`, plus a per-user
  policy via `POST /cloud/project/{projectId}/user/{userId}/policy`
  (cross-denial verified — the same recipe as the `immo-graph-<env>-RW`
  users). Immo cannot self-grant this access.
- The bucket policy on `sentropic-geo` is owner-held but is NOT needed for
  P1: the read is granted per-user, not per-bucket.
- Prefix-restricted RO on OVH is **untested**, so the recommended path is a
  **dedicated export bucket** (for example `sentropic-geo-export-immo`)
  with a user `immo-geo-export-<env>-RO` holding read on the whole bucket.
  Copying the pointer and the snapshots it points to into that bucket is a
  geo action (ADR-0035 or F3-PUB) — start date **unknown**.
- A prefix-scoped RO on `sentropic-geo` itself is accepted ONLY with a
  verified negative test: with the granted credential, `GetObject` on
  `raw/…` and on `capture/…` MUST return 403 (see below). Without that
  proof, the export-bucket path above applies.
- Rotation follows the governed k8s↔immo credential cycle
  (`deploy/ci/bascule-preprod/CRED_CYCLE.md`): **every 90 days** (and at
  once on suspected exposure), one identity at a time — mint the new
  `s3Credentials` for the OVH user (the old credential stays valid),
  store the new values in the GitHub Environment + the `.env` recovery
  copies, verify with the NEW credential
  (`GET /api/v1/geo-governed/catalog` shows `contract.status: ok` with the
  pointer's `snapshot_sha256`), and ONLY then delete the old credential
  (revocation). Record the rotation date (next due = +90 days). After
  rotation, `contract.status: ok`; otherwise the facade stays
  `missing source` and items keep serving live with the explicit marker
  (no silent change).

### Negative test (G2)

In code, `served-contract-pointer.test.ts` covers the second layer:

- "REFUSES a read outside `exports/immo/geo-served-contract/v1/` with ZERO
  upstream calls": requesting `raw/pv-index/cas/deadbeef.pdf` returns
  `refused / read-outside-exports-immo-refused` and the injected client is
  never invoked.
- "REFUSES `raw/` and `capture/` reads with ZERO upstream calls": both
  `raw/pv-index/cas/deadbeef.pdf` and `capture/pv/2024/doc.pdf` — including
  via `..` traversal through the served-contract tree — are refused before
  any client call.
- Traversal guard: keys containing `..`, `//` or control characters are
  refused even under the allowed prefix.

Against the REAL granted credential (first layer, by the k8s lane at grant
time and after every rotation), the negative proof is:

```bash
# With ONLY the immo-geo-export-<env>-RO (or prefix-scoped RO) values in the
# environment: reads inside the served-contract tree succeed…
aws --endpoint-url "$GEO_SERVED_CONTRACT_S3_ENDPOINT" s3api get-object \
  --bucket "$GEO_SERVED_CONTRACT_S3_BUCKET" \
  --key exports/immo/geo-served-contract/v1/latest.json /tmp/pointer.json
# …while raw/ and capture/ MUST be denied (HTTP 403).
aws --endpoint-url "$GEO_SERVED_CONTRACT_S3_ENDPOINT" s3api get-object \
  --bucket "$GEO_SERVED_CONTRACT_S3_BUCKET" \
  --key raw/pv-index/cas/deadbeef.pdf /tmp/must-fail-1.bin
aws --endpoint-url "$GEO_SERVED_CONTRACT_S3_ENDPOINT" s3api get-object \
  --bucket "$GEO_SERVED_CONTRACT_S3_BUCKET" \
  --key capture/pv/2024/doc.pdf /tmp/must-fail-2.bin
```

Both `must-fail` calls return 403. Any success outside the served-contract
tree invalidates the grant: fall back to the dedicated export bucket.

## 4. Field discipline (O3 default)

Items pass ONLY through the per-collection allowlist recorded in
`governed-policy.ts` (11 keys for the pilot, measured 2026-11-03). On top,
`adresse`, `code_postal*`, `extrait_brut` and `url_pdf` are banned even if a
record ever listed them (belt and braces over the record). Lots, zoning
events and deferred families are refused before any upstream call
(`geo-governed.test.ts` asserts the upstream counter stays at zero).

## 5. What I-1A explicitly does NOT do

- No PMTiles route, reference, or hash (N2 negative, tested).
- No reader operation; no edit to `content-serve.ts`, `reader-storage.ts`,
  or `reader-operations.ts` (D3 negative — verify with
  `git diff --name-only`).
- No MCP tool definition change (tools/list bit-identical; capture
  before/after joined to the lot).
- `GEO_ZONES_SOURCE=pg` still restores the pre-existing behaviour.
