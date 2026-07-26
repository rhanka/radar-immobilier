# Graphify 3.4 delta enrichment checkpoint

## Decision and compatibility mapping

The owner decision is frozen:

| Field | Required value | Meaning |
|---|---|---|
| `ontology_version` | `"2.3"` | Existing ontology contract; not renamed |
| `graphify_pass` | `"3.4"` | Explicit enrichment-pass identity |

Pass 3.4 is therefore a compatible enrichment pass over ontology 2.3. Its
snapshot is written as a complete city snapshot and its companion manifest
records `source: "graph_nodes"`, `snapshot_mode: "complete-city"`, node count,
edge count, and the same two version fields.

## Phase 0 — non-regression gate

`upsertGraphAtomic` now compares every existing node in the city against the
candidate snapshot. Every non-null key under `props.properties` is protected.
The comparison is per node and per city; a missing candidate node is treated as
an empty property map. A missing or null key returns `aborted: true` with the
node id and missing keys, before any database write. Existing values `false`,
`0`, empty strings, and empty arrays remain present.

The regression fixture reproduces the partner observation: one node moves from
39 business keys to 9. The gate reports the 30 missing keys, including
`reglement_url`, `reglement_numero`, `normes_pliees`, `usage_dominant`, and
`effet_densifiant`. The DB-bound test also verifies the persisted node still
has all 39 keys after the refused projection.

The existing evidence-completeness gate remains in place as a second, separate
check. This closes the prior gap: evidence completeness is no longer treated
as business-property completeness.

## Phase A — deterministic output

The producer reads the existing `graph_nodes` projection and reconstructs a
complete city snapshot; it never reads raw documents and never calls an LLM.
For `Signal` and `DesignationEvent` nodes it:

- adds `effet_densifiant: "inconnu"` only when absent; it does not calculate a
  density delta and does not overwrite a Geo-provided value;
- fills missing `etape` with the existing deterministic `deriveEtape`;
- persists `instrument` through the exact shared `instrumentFromSignal`
  function used by the live Vivier classification, rather than a copied
  lexicon;
- sorts nodes, edges, and business-property keys so the same input produces
  the same bytes.

The 48-node witness test gives these field counts:

| Field | Missing before | Present after | Added/canonicalized |
|---|---:|---:|---:|
| `effet_densifiant` | 48 | 48 | 48 |
| `etape` | 48 | 48 | 48 |
| `instrument` | 48 | 48 | 48 |

The replay test runs the enriched snapshot through the same producer again and
asserts byte-level object equality. On the second pass all three fields have
`before_missing: 0` and `added_or_canonicalized: 0`.

The operational script is dry-run by default and requires `--apply` before S3
or Postgres writes. It writes `graph/<city>/latest.json` and
`graph/<city>/graphify-3.4.manifest.json`, then calls the atomic projector.

## Phase B checkpoint — before broad LLM work

Phase B is deliberately not started. The repository evidence confirms the
remaining design gap:

1. There is no `graphify run` executable in this checkout.
2. `tools/graphify-v23` transforms an existing baseline into another baseline;
   it does not provide a cumulative raw-to-current-schema producer.
3. The `InputSet` replay contract identifies inputs and manifests, but it is not
   the missing raw-to-schema producer.
4. `scanHabitationSignals` exists in the PV parser and is covered by parser
   tests, but it is not wired into the graph projection path.
5. The required `category`, signal-level `usage_dominant`, and
   `etapes_historique` values need one cumulative input assembled from raw,
   parsed text, and run-manifest provenance before any LLM batch is authorized.

The `usage_dominant` name is intentionally not resolved through Geo: Geo's
field describes a zoning-area usage from the zoning regulation, while this
project's field describes a signal. They have different owners, sources, and
semantics. No Geo value is used by Phase A.

The next safe step is to specify and test that cumulative input and wire the
complete-PV scan on a bounded fixture set. No large-scale LLM processing has
been launched; cost, prompt version, model, and determinism gates remain
pending.

## Known limitations and debts

- The owner supplied the public API observation (`qc-zonage-sutton` at 39 keys
  versus the re-acquired `qc-zonage-saint-gervais` at 9). The local tests
  reproduce the exact 39-to-9 shape; production was not written or changed.
- `preflight.sh` is not used: it writes and deletes an S3 test object and must
  be repaired before it can be called a read-only preflight.
- Phase A cannot produce raw-derived `category`, signal-level
  `usage_dominant`, or `etapes_historique`; the existing graph projection does
  not contain their cumulative raw evidence.
- Phase A cannot fill Geo's real density effect because Geo explicitly owns a
  separate artifact and must not write `graph_nodes`.
- No production projection, S3 publish, Kubernetes action, or push was
  performed by this branch.
