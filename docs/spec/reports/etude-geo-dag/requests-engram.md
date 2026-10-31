# Requests to Engram (graphify: `@sentropic/engram`)

From: radar-immobilier conductor, on behalf of radar and geo. Date: 2026-10-31.
Context (not repeated here): `consensus-v2.md`. In short: PV extraction and signal detection move from radar to a geo
DAG of k8s Jobs; Engram is called as a library inside the `extract` and `verify` Jobs. The ontology profile stays
co-owned by radar and geo; Engram is asked for mechanisms, never to host or govern that profile.

Baseline read on graphify main `310a9270` (Engram 0.23.0); radar runs 0.21.2. "Exists" = seen in code; "Expected
contract" is a proposal for the maintainers to accept, amend or refuse.

Priority: **P1** blocks the geo DAG; **P2** needed before radar retires its refresh; **P3** none at this stage.

Already delivered, not requested: `OntologyCitation.excerpt` and `docSha` (`src/types.ts`).

---

## F-EN1 — Incremental, idempotent extraction and a coverage registry port (P1)

**Why.** Radar's cost rule is "pay only for new documents, never mass re-extraction". A DAG node may run more than once
(at-least-once Jobs), so the same document must not trigger a second model call.
**Expected contract.**
- Extraction identity `{docSha, profileDigest, promptVersion, engramVersion, modelPolicy}` -> deterministic
  `extractionKey`; a cache port `get(key) | put(key, extraction, receipt)` with an injected storage adapter (S3 in geo).
- Replay from cache returns the identical extraction without any model call.
- Coverage registry port per `(city, docSha, profileDigest)`: `covered | pending | abandoned`, failure counter,
  `abandoned` after a caller-configured threshold; storage injected.
**Acceptance.** Running the same document twice with the same identity makes one model call; changing `profileDigest`
invalidates the cache entry.

## F-EN2 — Profile bundle with digest and a consumer compatibility check (P1)

**Why.** The shared profile (radar `radar/ontology/ontology-profile.yaml`, v2.2, 9 node types) must be pinned in every
geo run identity and in the contract (`profile_digest`), and both owners need to know if a profile change breaks a
consumer.
**Exists.** `./registry/manifest`, `./registry/definitions` exports.
**Expected contract.**
- `bundleProfile(profile, registries) -> {bundle, digest}`; digest stable across key ordering and whitespace.
- `checkProfileCompatibility(old, new) -> {compatible, breaking[]}` (removed type, renamed relation, narrowed field).
- No profile content shipped or owned by Engram.
**Acceptance.** Same YAML reformatted -> same digest; removing a node type -> `breaking` non-empty.

## F-EN3 — Headless, bounded batch mode with structured receipts (P1)

**Why.** A DAG node needs a deterministic process, not an assistant session.
**Expected contract.**
- A library entry point (and optional CLI) taking text pages + profile bundle + LLM client, with bounds: timeout,
  maximum document size, maximum attempts.
- Output: extraction + receipt `{extractionKey, status: ok|refused|timeout|too-large, attempts, model, latencyMs,
  tokensIn, tokensOut}`; a refusal is a result, not an exception; exit code distinguishes retryable from final.
**Acceptance.** An oversized document returns `too-large` without a model call; a timeout returns `timeout` with partial
counters.

## F-EN4 — Citation-preserving `mergeExtractions` (P1)

**Why.** `mergeExtractions` (`src/extract-git.ts`) keeps the last node per id; citations carried by earlier copies are
lost. Geo merges per-chunk and per-document extractions before reconciling a city.
**Expected contract.** On duplicate node id: union of citations (deduplicated by `docSha + page + quoteSpan|excerpt`),
deterministic property conflict rule (documented), and a conflict list returned instead of silent overwrite. Same for
edges keyed as today.
**Acceptance.** Merging two copies of a node with different citations yields both citations; merge is order-independent
for citations.

## F-EN5 — Removal-only verification as a library function (P2)

**Why.** Radar runs a second model pass that may only remove unsupported items (`refresh-verification.ts`,
`v101b-removal-only-v3`). Geo needs the same guarantee without copying radar code.
**Expected contract.** `verifyRemovalOnly(extraction, pages, client) -> {extraction', removed[]}` where `extraction'` is
a subset of the input (enforced by the function, not by the prompt); each removal carries a reason.
**Acceptance.** A verifier response that adds or edits an item is rejected; output ids are a subset of input ids.

## F-EN6 — Render profile `properties` and `extraction_hints` in chunk prompts (P2)

**Why.** `buildProfileChunkPrompt` (`src/profile-prompts.ts`) does not render these profile fields; radar compensates
with its own prompt envelope, which geo would otherwise have to copy.
**Expected contract.** Typed properties (name, type, required, allowed values) and per-type hints rendered in a stable
section; `promptVersion` (F-EN1) changes when the rendering changes.
**Acceptance.** A profile with a required `etape_date` property produces a prompt naming it; snapshot test locks format.

## F-EN7 — Closed-partition validation per city (P2)

**Why.** Every document of a city run must end in exactly one state: extracted, refused with a reason, or `unknown`;
a run must never look complete by omission. This also enforces radar's anti-invention rule (`evidenceRefs` required).
**Expected contract.** `closePartition(expectedDocShas, results) -> {complete, missing[], states}`; an extracted item
without at least one citation is invalid.
**Acceptance.** One missing document -> `complete: false` with that sha in `missing`.

## F-EN8 — Typed links to geo referential ids (P2)

**Why.** Signal -> zone, lot and bylaw edges must point to identifiers served by geo, not free strings, so the
valuation join (lot, role-foncier) is a key join.
**Expected contract.** A resolver port injected by the caller (`resolve(kind, rawValue, city) -> {id} | unresolved`);
edges store the resolved id plus an `unresolved_reason` when it fails; no network call inside Engram.
**Acceptance.** An unresolvable lot number yields an edge-less node with `unresolved_reason`, never a fabricated id.

## F-EN9 — Profile-driven validation of event and signal annotations (P2)

**Why.** Geo now derives signals (kinds `ppcmoi`, `derogation`, `cptaq-dezonage`, `residential-rezoning`, `intention`,
`precedent`) from `DesignationEvent` items. Their schema belongs to the shared profile; Engram must validate them from
the profile without hardcoding radar types.
**Expected contract.** `validateProfileExtraction` (`src/profile-validate.ts`) covers profile-declared enums and
required fields for every node type, returning typed violations; no domain type defined inside Engram.
**Acceptance.** A signal with an undeclared kind or without `evidenceRefs` (if the profile marks it required) fails
validation.

---

**Out of scope (do not build for us):** network capture, scheduling, queues, annotation persistence (radar facets),
hosting or governing the ontology profile.
**Reply expected:** accept / amend / refuse per ID and target version; radar plans to move from 0.21.2 to 0.23.x in L1.
