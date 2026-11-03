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
geo bucket `sentropic-geo`. The
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

- The grant is an act of infrastructure by the **geo tenant operator, owner
  of the bucket `sentropic-geo`**, via a prefix-scoped S3/IAM read policy on
  `exports/immo/geo-served-contract/v1/` (+ snapshots it points to), with an
  explicit rotation cycle, `.env` storage, and documented procedure verifiable
  without a per-unit owner act. Immo cannot self-grant this access.
- The named holder of the OVH rights for `sentropic-geo` is **unknown** on
  both sides: naming that actor is a precondition line to fill before I-1A can
  leave `missing source`.
- The grant MUST be verified prefix-scoped: a read of the granted credential
  outside `exports/immo/` must be refused (OVH prefix-scoped reads are
  unverified — if OVH cannot scope the read, the fallback is a geo-side copy
  of the pointer + snapshots into a dedicated export bucket, outside I-1 code).
- Rotation: rotate the read credential on the operator's cycle; immo only
  consumes the new values via `.env` (never committed). After rotation,
  `GET /api/v1/geo-governed/catalog` must show `contract.status: ok` with the
  pointer's `snapshot_sha256`; otherwise it stays `missing source` and items
  keep serving live with the explicit marker (no silent change).

### Negative test (G2)

`served-contract-pointer.test.ts` — "REFUSES a read outside `exports/immo/`
with ZERO upstream calls (G2 negative)": requesting
`raw/pv-index/cas/deadbeef.pdf` returns `refused /
read-outside-exports-immo-refused` and the injected client is never invoked.
The in-code prefix guard is the second layer; the first is the prefix-scoped
credential above.

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
