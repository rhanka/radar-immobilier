/**
 * REBUILD FROM S3 — proof that Postgres is a reconstructible PROJECTION of the
 * object store, not a source of truth (SPEC_PERSISTENCE_S3_FIRST §0, §4).
 *
 * `rebuildFromS3` REPLAYS the object store and REPROJECTS into a `ProjectionRepo`
 * (Postgres in prod, in-memory in tests). The replay is a pure read of S3:
 *
 *   1. DOCUMENTS — LIST `raw/` for every `*.meta.json` sidecar, parse each as a
 *      `RawDocumentRecord`, and (when a run manifest references the same CAS key)
 *      enrich it with the manifest's `publishedAt` valid-time anchor. One upsert
 *      per CAS object, keyed by `s3Key` (the content address ⇒ free dedup).
 *   2. SCRAPE_STATUS — LIST `state/` for every shard `state/{city}/{source}.json`,
 *      parse each as a `ScrapeStatus`, and upsert keyed by (citySlug, source).
 *   3. CURSOR — when the repo supports it, advance the `runs` stream cursor to the
 *      highest manifest key applied (projection_meta.lastAppliedKey, §4).
 *
 * IDEMPOTENT by construction: every write is an upsert on a natural key, so a
 * re-run is a no-op and a DROP + rebuild reproduces the identical state. The DB
 * may lag S3 but never leads it (S3 is written first, §4).
 *
 * SCOPE (L4, realisable TODAY): `documents` + `scrape_status`. `mentions` /
 * `signals` and `graph_nodes` / `graph_edges` depend on the `parsed/` and
 * `graph/{city}/latest.json` prefixes which the worker does NOT yet write
 * (SPEC §5, §8 step 3 is not done). They are deliberately OUT of scope here and
 * will be added to the same replay once those prefixes are populated — see the
 * module footer.
 */

import {
  RawDocumentRecordSchema,
  type RawDocumentRecord,
} from "@radar/sources";
import { ScrapeStatus, type ScrapeStatusT } from "@radar/domain";

import type { ObjectStore } from "../../storage/object-store.js";
import type { RunManifestEntry } from "./run-manifest.js";
import type { ProjectedDocument, ProjectionRepo } from "./projection-repo.js";

/** S3 key-space prefixes the replay walks (SPEC §1). */
const RAW_PREFIX = "raw/";
const RUNS_PREFIX = "runs/";
const STATE_PREFIX = "state/";
const META_SUFFIX = ".meta.json";

/** Stream name for the run-manifest cursor in `projection_meta` (§4). */
export const RUNS_STREAM = "runs";

export interface RebuildDeps {
  /** Projection write boundary (Postgres in prod, in-memory in tests). */
  readonly repo: ProjectionRepo;
}

export interface RebuildSummary {
  /** Number of document rows upserted (one per CAS `meta.json`). */
  readonly documents: number;
  /** Number of scrape_status rows upserted (one per `state/` shard). */
  readonly scrapeStatuses: number;
  /**
   * Highest run-manifest key applied this rebuild (the cursor value written to
   * `projection_meta` for the `runs` stream), or undefined when no manifest was
   * present.
   */
  readonly lastManifestKey?: string;
}

const decoder = new TextDecoder();

/** Decode + JSON.parse a stored object, or return null on any failure. */
function tryParseJson(bytes: Uint8Array): unknown | null {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch {
    return null;
  }
}

/**
 * Build the `publishedAt`-by-CAS-key index from every run manifest under
 * `runs/`. The manifest is the bitemporal transaction-time record; its
 * `publishedAt` is the valid-time anchor we project onto the document. Also
 * returns the lexicographically-highest manifest key seen, used as the cursor.
 */
async function indexManifests(
  store: ObjectStore,
): Promise<{ publishedByCasKey: Map<string, string>; lastManifestKey?: string }> {
  const publishedByCasKey = new Map<string, string>();
  const keys = (await store.list?.(RUNS_PREFIX)) ?? [];
  const manifestKeys = keys.filter((k) => k.endsWith("manifest.jsonl")).sort();

  for (const key of manifestKeys) {
    const bytes = await store.get(key);
    const text = decoder.decode(bytes);
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      let entry: RunManifestEntry;
      try {
        entry = JSON.parse(trimmed) as RunManifestEntry;
      } catch {
        continue; // skip a malformed line rather than aborting the rebuild
      }
      if (entry.casKey && entry.publishedAt) {
        // Last writer wins across runs: a later manifest's publishedAt for the
        // same CAS key supersedes an earlier one (sorted ascending above).
        publishedByCasKey.set(entry.casKey, entry.publishedAt);
      }
    }
  }

  const lastManifestKey =
    manifestKeys.length > 0 ? manifestKeys[manifestKeys.length - 1] : undefined;
  return lastManifestKey !== undefined
    ? { publishedByCasKey, lastManifestKey }
    : { publishedByCasKey };
}

/** Source id of a CAS meta object → the `RawDocumentRecord` is authoritative. */
function toProjectedDocument(
  record: RawDocumentRecord,
  publishedAt: string | undefined,
): ProjectedDocument {
  return {
    s3Key: record.storageKey,
    sha256: record.sha256,
    source: record.source,
    sourceUrl: record.sourceUrl,
    contentType: record.contentType,
    fetchedAt: record.fetchedAt,
    bytesLen: record.bytesLen,
    ...(publishedAt !== undefined ? { publishedAt } : {}),
  };
}

/**
 * Replay `raw/.../*.meta.json` into document upserts, enriched by the manifest
 * `publishedAt` index. Returns the count of documents projected.
 */
async function projectDocuments(
  store: ObjectStore,
  repo: ProjectionRepo,
  publishedByCasKey: Map<string, string>,
): Promise<number> {
  const keys = (await store.list?.(RAW_PREFIX)) ?? [];
  const metaKeys = keys.filter((k) => k.endsWith(META_SUFFIX)).sort();

  let count = 0;
  for (const metaKey of metaKeys) {
    const bytes = await store.get(metaKey);
    const parsed = RawDocumentRecordSchema.safeParse(tryParseJson(bytes));
    if (!parsed.success) continue; // skip a malformed sidecar, do not abort

    const record = parsed.data;
    // Defensive: the sidecar key is `<casKey>.meta.json`; the record's own
    // storageKey is authoritative, but guard against a mismatch.
    const casKey = metaKey.endsWith(META_SUFFIX)
      ? metaKey.slice(0, -META_SUFFIX.length)
      : record.storageKey;
    const publishedAt =
      publishedByCasKey.get(record.storageKey) ??
      publishedByCasKey.get(casKey) ??
      record.publishedAt;

    await repo.upsertDocument(toProjectedDocument(record, publishedAt));
    count += 1;
  }
  return count;
}

/**
 * Replay `state/{city}/{source}.json` shards into scrape_status upserts.
 * Returns the count of scrape_status rows projected.
 */
async function projectScrapeStatuses(
  store: ObjectStore,
  repo: ProjectionRepo,
): Promise<number> {
  const keys = (await store.list?.(STATE_PREFIX)) ?? [];
  const shardKeys = keys.filter((k) => k.endsWith(".json")).sort();

  let count = 0;
  for (const key of shardKeys) {
    const bytes = await store.get(key);
    const parsed = ScrapeStatus.safeParse(tryParseJson(bytes));
    if (!parsed.success) continue; // skip a malformed shard, do not abort

    await repo.upsertScrapeStatus(parsed.data as ScrapeStatusT);
    count += 1;
  }
  return count;
}

/**
 * Rebuild the Postgres projections (documents + scrape_status) by replaying the
 * object store. Pure read of S3; idempotent upserts into `deps.repo`. See the
 * module header for the replay order and scope.
 *
 * @param store Object store to replay (real S3/MinIO, or an in-memory fake).
 * @param deps  `{ repo }` — the projection write boundary.
 */
export async function rebuildFromS3(
  store: ObjectStore,
  deps: RebuildDeps,
): Promise<RebuildSummary> {
  const { repo } = deps;

  // 1. Index run manifests (valid-time anchors + cursor).
  const { publishedByCasKey, lastManifestKey } = await indexManifests(store);

  // 2. Project documents from CAS meta sidecars, enriched by manifests.
  const documents = await projectDocuments(store, repo, publishedByCasKey);

  // 3. Project scrape_status from state/ shards.
  const scrapeStatuses = await projectScrapeStatuses(store, repo);

  // 4. Advance the cursor (projection_meta) when the repo + a manifest support it.
  if (lastManifestKey !== undefined && repo.setCursor) {
    await repo.setCursor(RUNS_STREAM, lastManifestKey);
  }

  return lastManifestKey !== undefined
    ? { documents, scrapeStatuses, lastManifestKey }
    : { documents, scrapeStatuses };
}

// ─────────────────────────────────────────────────────────────────────────────
// OUT OF SCOPE TODAY (documented, not implemented):
//   - mentions / signals: require `parsed/{city}/{kind}/{docSha}/{ver}/extract.json.gz`
//     which the worker does NOT yet write (SPEC §5 [worker parse], §8 step 3).
//   - graph_nodes / graph_edges: require `graph/{city}/latest.json` +
//     `graph/.../graph.json.gz` which the worker does NOT yet write (SPEC §5
//     [worker graphify]). The idempotent upsert already exists in
//     `services/graph/graph-store.ts#upsertGraph`; once `latest.json` is written,
//     this replay LISTs `graph/*/latest.json`, GETs the pointed graph.json.gz and
//     calls `upsertGraph` — the projection target is already in place.
// ─────────────────────────────────────────────────────────────────────────────
