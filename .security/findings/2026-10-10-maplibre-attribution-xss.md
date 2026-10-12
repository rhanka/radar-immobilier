# MapLibre attribution sanitizer bypass

- Status: resolved in the local SECRES patch on 2026-10-12; local compatibility gates passed
- Severity: critical (GitHub, CVSS 10.0)
- Advisory: GHSA-jrc7-96c5-q579 / CVE-2026-85061 — affected `<=6.4.0`, patched `6.4.1`
- Register rows: `EXC-2026-10-10-maplibre-gl`, `EXC-2026-10-10-geo-map-engine`, `EXC-2026-10-10-geo-ui-svelte`
- Owner refused critical/high acceptance; every acceptance signature remains null.

## Historical baseline

PR #854 at `42ec4a05e92204899abd490f41dfd2537734fe77` resolved
MapLibre 5.24.0, engine 0.6.1 and UI 0.1.1 requiring MapLibre `^5.24.0`.
The attribution sanitizer mutated a live attribute map, allowing adjacent
dangerous attributes to survive. Escaped provider text did not remove the
vulnerable renderer from the shipped tree.

## Remediation

- Consume owner-approved engine/UI 0.6.3, both with MapLibre `^6.4.1` ranges.
- Pin direct/transitive MapLibre to one exact 6.4.1 copy. The exact global
  override prevents an independent engine renderer/worker version. Preserve
  all #854 overrides and core APIs: UI/engine 0.6.1, API 0.1.2.
- Use named imports and await `ensureMaplibreWorker` before application mount,
  with its supported injected `?worker&url` loader so Vite bundles shared imports.
- Both nginx configurations serve JS/MJS as JavaScript, missing assets as 404,
  and `Content-Security-Policy: worker-src 'self'`.
- Preserve escaped provider attribution; the real AttributionControl browser
  fixture tests adjacent hostile event attributes and a JavaScript URL, legal
  credit, executable DOM absence and an inert execution sentinel.

## Publication and artifact evidence

Evidence is retained under sibling ignored `tmp/security-residual-evidence/`:

- `geo063-supply-chain/REPORT.md`: fresh SRI/npm signatures and full Sigstore
  verification of provenance/publish attestations for both geo packages and
  MapLibre 6.4.1; incorrect signer identities are rejected.
- Verified geo tag `v0.6.3`, commit
  `f5a17444d83c842ce139e49fee3f6c91a7ce31ae`, publish run `38289647028`.
- `geo063-final-security-review/REPORT.md`: 23 emitted source-map contents
  match verified publication bytes, including runtime, worker and shared code.
  The inactive raw worker from geo's default loader is also 6.4.1; startup
  supplies the fully bundled URL before any map uses it.
- `geo063-integration/resolution-changes.json`: one renderer, exact geo
  releases, historical overrides preserved.
- `geo063-integration/audit-after.json`: zero critical/high/moderate;
  three unchanged low graphify/Ollama findings remain visible and unsuppressed.

## Compatibility verification

All six browser scenarios passed on built assets served by nginx: native
MapLibre, Cadastre, City, provider, GeoMap and the actual geo engine through
immo's adapter. Each renders and selects real fixture geometry after mounting
and remounting. Active worker responses are 200/JavaScript with no runtime or
request failures; configured public raster requests complete. Native camera
state changes are asserted; other scenarios exercise the pointer gestures.

Fresh Make gates passed: strict clean installation, workspace typecheck/lint,
1,664 UI tests (ten todo), API/UI production build, browser-runtime smoke,
security-header parity, served worker-byte comparisons, missing JS/MJS 404 and
cluster nginx syntax. Two independent Sol technical reviews report GO. These
are local technical checks, not an author-complementary harness consensus or
shipping authorization; the original #854 head remains unchanged.

A causal browser probe found MapLibre's unlayered relative positioning
overriding Tailwind 4's absolute utility on the two local map hosts (height 0).
Scoped absolute/inset CSS fixes the integration defect; regression checks
require nonzero host height and real lot selection. Owner UAT, new CI, merge
and deployment are not inferred from local checks.
