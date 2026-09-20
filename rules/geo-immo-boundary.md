---
description: "Authority boundary between the geo data reference and immo business semantics"
alwaysApply: true
paths: ["**/*"]
globs: ["**/*"]
tags: [boundary, contract]
---

# GEO / IMMO BOUNDARY

This file is the authoritative record of the boundary between this repository
(`immo` — radar-immobilier) and the sibling `geo` project. An agent memory, a
session transcript, or a chat decision does NOT establish this boundary: the
agent operating this repo changes model and session, and only `rules/` survives
that rotation. If a behavior is not written here, it is not the boundary.

## Authority split (MANDATORY)

- `geo` is **the** data reference. It owns acquisition, scraping, raw bytes,
  OCR and derived source text, storage, versioning, retention, evidence and
  provenance for geospatial and municipal documentary sources.
- `immo` owns business semantics: signal classification, detections and
  relations, temporal ontology, designation events, the vivier, scoring, and
  the on-screen projection.
- `immo` **consumes** what `geo` **produces**. It never becomes a second source
  of truth for the same facts.
- Labels, summaries and classifications produced by `immo` are semantic objects
  and stay immo-owned. Source bytes, OCR text, verbatim excerpts, geometry and
  geo facts stay geo-owned data, wherever they transit or are cached.

## Non-interference (MANDATORY)

- `immo` MAY inventory what exists on the producer side, and MAY report a
  measured need or a measured defect — the observation, its key, its date.
- `immo` MUST NOT prescribe the producer's method, tooling, schedule, or
  budget. A finding is a fact plus a need; it is never an instruction to the
  other project.
- The rule is symmetric: a producer does not prescribe immo's business
  semantics, thresholds, or ranking.
- Nothing in this repository writes into the other project's repository.
  Cross-project change requests travel as an issue or PR in the owning
  repository and are decided by that project's owner.

## What crosses the boundary is a contract (MANDATORY)

Anything crossing is a published artifact, never a direct read of the other
project's private storage. Every crossing artifact carries:

```text
{ schema, version, uri, sha256, join_key, vintage }
```

- `uri` — a stable, addressable location for the artifact.
- `sha256` — the hash of the exact bytes consumed.
- `join_key` — the declared, versioned key both sides join on. Renaming or
  re-deriving it is a breaking change, not a refactor.
- `vintage` — which edition of the underlying reality the artifact reflects, so
  a consumer can pin it and reason about staleness.

Forbidden across the boundary:

- direct access to the other project's private tables, buckets, or unqualified
  `latest`-style pointers;
- a field added on one side and read on the other without appearing in the
  published contract (a smuggled field);
- consuming an artifact without pinning its version and hash.

Any change to authority, source channel, join key, retention, provenance
origin, or contract version requires an explicit owner decision and a new
versioned contract. Approval is never inferred from a historical
implementation, and an exception is never silently broadened.

## Homonyms are not shared fields

A producer field and a consumer field bearing the same name are different
types, and MUST NOT be copied, renamed, or derived into one another (for
example `geo.Zone.usage_dominant` versus `immo.Signal.usage_dominant`). An immo
assertion carries its own origin, its own evidence reference
(`{schema, uri, version, sha256, locator}`), and a versioned qualification
function when one is applied. Validation and tests MUST include negative copy,
rename, and derive fixtures.

## A withdrawal travels with its key, not its volume (MANDATORY)

Measured 2026-07: a withdrawal announced as a count — "85 effects withdrawn on
city X" — named no row, so the consumer could not target a purge.

- Any announcement of a withdrawal, correction, or tombstone MUST carry the
  identifying key of the withdrawn items, not only their volume. The shape both
  projects validated is `{city_slug, zone_ref_canon_v1, reglement_number}`.
- A consumer MUST NOT act on a volume-only withdrawal notice: it requests the
  keys and holds the previous state until they arrive.
- The count stays useful as a reconciliation check (keys received equals volume
  announced); it is never the instruction itself.

## A deposit is immediate, a withdrawal is cache-delayed (MANDATORY)

Measured 2026-07: a deposit was visible at once while the matching withdrawal
stayed masked behind a cache, and both sides believed for hours that the
withdrawal had taken effect.

- The asymmetry is structural: added data appears on the next read, while
  removed data stays visible until every cache layer in front of it expires.
- Any withdrawal announcement MUST state the applicable cache delay on each
  side — producer publication and consumer read — and the earliest time the
  effect is observable.
- A withdrawal is confirmed only by an observation made after that delay, on
  the consumer's own read path. "Removed at the source" is not "removed as
  served".
- Before the stated delay has elapsed, absence in a cached response is not
  evidence of withdrawal, and presence is not evidence of failure.

## Precedence and change control

- `rules/` is authoritative for this boundary. Agent memories, session
  transcripts, and skill packs are not, and MUST NOT be cited as its source.
- Adding, moving, or modifying any `rules/**` path — including this file —
  requires a `BRxx-EXn` exception declared in the branch plan **before** the
  change, with reason, impact, and rollback
  (`rules/MASTER.md` → *Branch Scope Control*).
