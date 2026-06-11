/**
 * PROJECTION REPO — the write boundary of the S3→Postgres projector
 * (SPEC_PERSISTENCE_S3_FIRST §4). `rebuildFromS3` REPLAYS the object store and
 * REPROJECTS into a `ProjectionRepo`. Postgres is the default target, but the
 * interface is abstract so the "Postgres is reconstructible" proof can run
 * entirely in memory (no DB, no docker) — see `InMemoryProjectionRepo`.
 *
 * Every method is an IDEMPOTENT upsert keyed by a natural key:
 *   - documents     → keyed by `s3Key` (the CAS object key = content address)
 *   - scrape_status → keyed by (citySlug, source)
 *   - cursor        → keyed by `stream` (projection_meta.lastAppliedKey, §4)
 *
 * Re-running the projector over the same store is therefore a no-op, and a
 * DROP + rebuild reproduces the identical projected state.
 */

import type { ScrapeStatusSourceT, ScrapeStatusT } from "@radar/domain";

/**
 * A projected document row, derived from a CAS `meta.json` (`RawDocumentRecord`)
 * and enriched, when available, by the run manifest. `s3Key` is the natural key:
 * it IS the content address, so two byte-identical collections map to one row.
 */
export interface ProjectedDocument {
  /** CAS object key (`raw/{source}/cas/{sha}.{ext}`) — the natural key. */
  readonly s3Key: string;
  /** SHA-256 of the raw bytes. */
  readonly sha256: string;
  /** Source id that produced the document (e.g. "proces-verbaux-carignan"). */
  readonly source: string;
  /** Exact URL the bytes were fetched from. */
  readonly sourceUrl: string;
  /** MIME type of the stored payload. */
  readonly contentType: string;
  /** ISO timestamp of the fetch. */
  readonly fetchedAt: string;
  /** Length of the raw payload in bytes. */
  readonly bytesLen: number;
  /**
   * Valid-time anchor (date of the act/session) from the run manifest, when the
   * source exposed one. Absent when no manifest references this doc — never
   * fabricated (anti-invention, SPEC_ONTOLOGY §0.2).
   */
  readonly publishedAt?: string;
}

/**
 * The write boundary for the projector. Implementations MUST upsert on the
 * natural key (no duplicate rows on re-run).
 */
export interface ProjectionRepo {
  /** Upsert one projected document, keyed by `s3Key`. */
  upsertDocument(doc: ProjectedDocument): Promise<void>;
  /** Upsert one scrape_status row, keyed by (citySlug, source). */
  upsertScrapeStatus(record: ScrapeStatusT): Promise<void>;
  /**
   * Advance the projection cursor for `stream` to `lastAppliedKey`
   * (projection_meta, §4). Optional — a repo that does not track cursors can
   * omit it; the projector simply skips cursor bookkeeping.
   */
  setCursor?(stream: string, lastAppliedKey: string): Promise<void>;
}

/**
 * In-memory `ProjectionRepo` for the reconstructibility proof: holds documents
 * keyed by `s3Key`, scrape_status keyed by `citySlug:source`, and cursors keyed
 * by stream — so an upsert truly replaces (no growth on re-run).
 */
export class InMemoryProjectionRepo implements ProjectionRepo {
  private readonly documents = new Map<string, ProjectedDocument>();
  private readonly scrapeStatuses = new Map<string, ScrapeStatusT>();
  private readonly cursors = new Map<string, string>();

  async upsertDocument(doc: ProjectedDocument): Promise<void> {
    this.documents.set(doc.s3Key, doc);
  }

  async upsertScrapeStatus(record: ScrapeStatusT): Promise<void> {
    this.scrapeStatuses.set(scrapeStatusKey(record.citySlug, record.source), record);
  }

  async setCursor(stream: string, lastAppliedKey: string): Promise<void> {
    this.cursors.set(stream, lastAppliedKey);
  }

  /** All projected documents, in insertion order. */
  allDocuments(): ProjectedDocument[] {
    return [...this.documents.values()];
  }

  /** All projected scrape_status rows. */
  allScrapeStatuses(): ScrapeStatusT[] {
    return [...this.scrapeStatuses.values()];
  }

  /** Current cursor for a stream (undefined if never set). */
  getCursor(stream: string): string | undefined {
    return this.cursors.get(stream);
  }
}

/** Natural key for a scrape_status row. */
function scrapeStatusKey(citySlug: string, source: ScrapeStatusSourceT): string {
  return `${citySlug}:${source}`;
}
