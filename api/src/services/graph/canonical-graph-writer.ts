/**
 * The guarded write path for `graph/<city>/latest.json`.
 *
 * That key is the canonical city snapshot: the projector
 * (`scripts/project-graph-from-s3.ts`) and the S3 replay read it as truth, and
 * an S3 PUT destroys the previous bytes for good. Several producers write it
 * (Graphify 3.4 phase A, `filet-auto-link-pv`, the v2.3 shell gate, the
 * citation-grounding publisher), so a guard held by one producer protects
 * nothing: the next producer overwrites the same key and the first producer's
 * archive then describes a version that no longer existed at write time.
 *
 * This module carries the guard on the write path instead:
 *   1. `archiveCityGraphPrefix` copies the whole `graph/<city>/` prefix to a
 *      timestamped archive, records a sha256 per object and a digest over the
 *      whole set, and refuses to reuse an archive id (defect 5). Each object is
 *      read ONCE, bytes and ETag together, so the recorded ETag always names
 *      the bytes actually copied;
 *   2. `writeCanonicalCityGraph` refuses to publish unless the canonical object
 *      still carries the ETag captured when the SOURCE of the new body was read
 *      (`CanonicalReadAnchor`) — not merely the ETag captured by the archive.
 *      The archive can be taken minutes after that read; anchoring the window
 *      to the archive would let a version published in between be archived,
 *      match, and still be overwritten by a body derived from stale input;
 *   3. the same call refuses when the archive does not cover the version the
 *      write is about to destroy, which is the module's promise stated as a
 *      precondition rather than as an intention;
 *   4. `S3ObjectStore.put()` refuses the canonical key outright, so a writer
 *      that skips this module fails loudly instead of silently.
 *
 * DECLARED LIMIT — the shell writers (`tools/graphify-v23/gate.sh`,
 * `tools/grounding/publish-citation-grounding.sh`) publish with `s5cmd` and do
 * NOT go through this module. They were only made fail-closed on their backup
 * probe; they still hold no expected-version and can still overwrite a version
 * this module archived. Treat concurrent shell publication as unprotected.
 */
import { createHash } from "node:crypto";
import {
  canonicalGraphKey,
  isCanonicalGraphKey,
  type ObjectInfo,
  type StoredObject,
} from "../../storage/object-store.js";

/** Minimal store surface the guarded writer needs (S3ObjectStore satisfies it). */
export interface CanonicalGraphStore {
  list(prefix: string): Promise<string[]>;
  get(key: string): Promise<Uint8Array>;
  head(key: string): Promise<ObjectInfo | null>;
  /**
   * Bytes + the ETag of those bytes, in one read. REQUIRED here: everything in
   * this module that records "version X held these bytes" reads through it.
   */
  getWithEtag(key: string): Promise<StoredObject | null>;
  put(key: string, body: Uint8Array | string, contentType?: string): Promise<unknown>;
  putCanonicalGraph(
    key: string,
    body: Uint8Array | string,
    contentType: string | undefined,
    options: { ifMatch: string | null },
  ): Promise<unknown>;
}

/** One archived object, with what is needed to prove it was copied intact. */
export interface CanonicalArchiveEntry {
  key: string;
  backup_key: string;
  byte_length: number;
  sha256: string;
  etag: string | null;
}

/** The archive marker written at `<backup_prefix>_backup-complete.json`. */
export interface CanonicalArchiveReceipt {
  backup_id: string;
  city: string;
  source_prefix: string;
  backup_prefix: string;
  archived_at: string;
  object_count: number;
  entries: CanonicalArchiveEntry[];
  canonical_key: string;
  /** ETag of `graph/<city>/latest.json` when the archive was taken; null = absent. */
  canonical_etag: string | null;
  /** sha256 over the sorted `<sha256>  <key>` lines — proves the inventory is complete. */
  digest: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const CANONICAL_BACKUP_ROOT = "graphify-34-backups";

export function backupPrefixFor(backupId: string, citySlug: string): string {
  return `${CANONICAL_BACKUP_ROOT}/${backupId}/graph/${citySlug}/`;
}

export function backupMarkerKey(backupId: string, citySlug: string): string {
  return `${backupPrefixFor(backupId, citySlug)}_backup-complete.json`;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Digest over the archive inventory. Recomputing it from the receipt's entries
 * and comparing proves nobody trimmed or edited the entry list; re-reading the
 * archived objects and comparing each `sha256` proves the copies are intact.
 */
export function archiveDigest(entries: readonly CanonicalArchiveEntry[]): string {
  const lines = entries
    .map((entry) => `${entry.sha256}  ${entry.key}`)
    .sort()
    .join("\n");
  return createHash("sha256").update(lines).digest("hex");
}

/**
 * The version of `graph/<city>/latest.json` observed WHEN THE SOURCE of a new
 * body was read. It is what makes the protected window start at the read.
 *
 * A body is always derived from something read at a point in time: the
 * canonical object itself (`filet-auto-link-pv`) or the Postgres projection
 * (Graphify 3.4 phase A). Everything that happens afterwards — per-node S3
 * probes, the archive loop over 724 cities — takes minutes. Anchoring the guard
 * to the archive would only prove "nothing moved since the archive", which says
 * nothing about the interval where the derivation actually became stale.
 */
export interface CanonicalReadAnchor {
  city: string;
  key: string;
  /** ETag of the canonical object at read time; `null` = it did not exist. */
  etag: string | null;
  captured_at: string;
}

/** Thrown when the canonical object moved out from under a prepared write. */
export class ConcurrentCanonicalWrite extends Error {
  /** `read-anchor`: it moved since the source read. `archive`: the archive is stale. */
  readonly reason: "read-anchor" | "archive-out-of-date";

  constructor(params: {
    key: string;
    reason: "read-anchor" | "archive-out-of-date";
    expected: string | null;
    found: string | null;
  }) {
    const { key, reason, expected, found } = params;
    const detail = reason === "read-anchor"
      ? `canonical key ${key} changed since it was read (read ${expected ?? "absent"}, ` +
        `found ${found ?? "absent"}): another writer published between the read this body ` +
        "was derived from and this write, so the body is stale."
      : `the archive for ${key} does not cover the version this write would destroy ` +
        `(archived ${expected ?? "absent"}, found ${found ?? "absent"}): publishing would ` +
        "erase bytes no archive holds.";
    super(`${detail} Refusing to overwrite — re-run against the current version.`);
    this.name = "ConcurrentCanonicalWrite";
    this.reason = reason;
  }
}

/** Thrown when an archive id is reused, which would overwrite an archive. */
export class ArchiveIdAlreadyUsed extends Error {
  constructor(prefix: string) {
    super(
      `archive prefix ${prefix} already holds objects: reusing an archive id would ` +
        "overwrite an existing archive. Use a fresh --backup-id, or --resume to " +
        "continue the run that created it.",
    );
    this.name = "ArchiveIdAlreadyUsed";
  }
}

/** Thrown when a resumed run's archive cannot be proven complete. */
export class ArchiveVerificationFailed extends Error {
  readonly problems: string[];
  constructor(prefix: string, problems: string[]) {
    super(`archive ${prefix} failed verification: ${problems.join("; ")}`);
    this.name = "ArchiveVerificationFailed";
    this.problems = problems;
  }
}

/**
 * Capture the version of `graph/<city>/latest.json` as it stands right now, to
 * be carried to the eventual write. Use this when the new body is derived from
 * a source OTHER than the canonical object (phase A derives it from Postgres):
 * capture the anchor BEFORE reading that source, so any publication concurrent
 * with the read is detected rather than silently overwritten.
 */
export async function captureCanonicalReadAnchor(
  store: CanonicalGraphStore,
  citySlug: string,
  now: () => Date = () => new Date(),
): Promise<CanonicalReadAnchor> {
  const key = canonicalGraphKey(citySlug);
  const info = await store.head(key);
  return { city: citySlug, key, etag: info?.etag ?? null, captured_at: now().toISOString() };
}

/**
 * Read the canonical city snapshot and its version together, for a writer whose
 * new body is derived FROM that snapshot (`filet-auto-link-pv`). The returned
 * anchor describes the exact bytes handed back — never a version obtained from
 * a second round trip. `null` when the city has no canonical object yet.
 */
export async function readCanonicalCityGraph(
  store: CanonicalGraphStore,
  citySlug: string,
  now: () => Date = () => new Date(),
): Promise<{ body: Uint8Array; anchor: CanonicalReadAnchor } | null> {
  const key = canonicalGraphKey(citySlug);
  const stored = await store.getWithEtag(key);
  if (stored === null) return null;
  return {
    body: stored.body,
    anchor: { city: citySlug, key, etag: stored.etag, captured_at: now().toISOString() },
  };
}

/**
 * Copy every object under `graph/<city>/` to the archive, recording a sha256
 * and the source ETag for each. Fails closed: any read or copy error
 * propagates before a single canonical byte is touched, and a non-empty
 * destination prefix aborts rather than overwriting a previous archive.
 *
 * Each object is read ONCE — bytes and ETag in the same response. The former
 * `get()` + `head()` pair let a writer publishing in between be recorded as
 * "archived": the inventory held version N-1's bytes under version N's ETag,
 * the write-time check then compared the live ETag to that ETag, found them
 * equal, and published — destroying version N with no copy of it anywhere.
 */
export async function archiveCityGraphPrefix(
  store: CanonicalGraphStore,
  citySlug: string,
  backupId: string,
  now: () => Date = () => new Date(),
): Promise<CanonicalArchiveReceipt> {
  const sourcePrefix = `graph/${citySlug}/`;
  const destinationPrefix = backupPrefixFor(backupId, citySlug);

  const alreadyThere = await store.list(destinationPrefix);
  if (alreadyThere.length > 0) throw new ArchiveIdAlreadyUsed(destinationPrefix);

  const sourceKeys = (await store.list(sourcePrefix))
    .filter((key) => key.startsWith(sourcePrefix))
    .sort();

  const entries: CanonicalArchiveEntry[] = [];
  for (const sourceKey of sourceKeys) {
    const stored = await store.getWithEtag(sourceKey);
    if (stored === null) {
      throw new Error(
        `cannot archive ${sourceKey}: it was listed under ${sourcePrefix} but disappeared ` +
          "before it could be read. Refusing to publish an incomplete archive.",
      );
    }
    const backupKey = `${destinationPrefix}${sourceKey.slice(sourcePrefix.length)}`;
    await store.put(backupKey, stored.body, "application/json");
    entries.push({
      key: sourceKey,
      backup_key: backupKey,
      byte_length: stored.body.byteLength,
      sha256: sha256(stored.body),
      etag: stored.etag,
    });
  }

  const canonicalKey = canonicalGraphKey(citySlug);
  const receipt: CanonicalArchiveReceipt = {
    backup_id: backupId,
    city: citySlug,
    source_prefix: sourcePrefix,
    backup_prefix: destinationPrefix,
    archived_at: now().toISOString(),
    object_count: entries.length,
    entries,
    canonical_key: canonicalKey,
    canonical_etag: entries.find((entry) => entry.key === canonicalKey)?.etag ?? null,
    digest: archiveDigest(entries),
  };
  await store.put(
    backupMarkerKey(backupId, citySlug),
    encoder.encode(JSON.stringify(receipt, null, 2)),
    "application/json",
  );
  return receipt;
}

/**
 * Prove an existing archive is complete and intact: every inventoried object is
 * still present under the archive prefix, its bytes still hash to the recorded
 * sha256, and the recomputed digest matches. Used before a `--resume`, which
 * would otherwise trust an archive it never checked.
 */
export async function verifyCityGraphArchive(
  store: CanonicalGraphStore,
  receipt: CanonicalArchiveReceipt,
): Promise<void> {
  const problems: string[] = [];
  if (archiveDigest(receipt.entries) !== receipt.digest) problems.push("inventory digest mismatch");
  if (receipt.entries.length !== receipt.object_count) problems.push("object_count mismatch");

  const present = new Set(await store.list(receipt.backup_prefix));
  for (const entry of receipt.entries) {
    if (!present.has(entry.backup_key)) {
      problems.push(`missing archived object ${entry.backup_key}`);
      continue;
    }
    const bytes = await store.get(entry.backup_key);
    if (sha256(bytes) !== entry.sha256) problems.push(`corrupt archived object ${entry.backup_key}`);
  }
  if (problems.length > 0) throw new ArchiveVerificationFailed(receipt.backup_prefix, problems);
}

/** Read an archive marker back, or null when the archive does not exist. */
export async function readCityGraphArchive(
  store: CanonicalGraphStore,
  citySlug: string,
  backupId: string,
): Promise<CanonicalArchiveReceipt | null> {
  const key = backupMarkerKey(backupId, citySlug);
  const info = await store.head(key);
  if (info === null) return null;
  return JSON.parse(decoder.decode(await store.get(key))) as CanonicalArchiveReceipt;
}

/**
 * Whether `graph/<city>/latest.json` already holds exactly these bytes.
 *
 * This is how a resumed run tells "I already published this city" from "another
 * writer published something else": the content hash is the marker, so the
 * window between the canonical PUT and any bookkeeping write carries no risk.
 * It never rewrites and never trusts a marker it did not verify.
 */
export async function canonicalMatchesBody(
  store: CanonicalGraphStore,
  citySlug: string,
  body: Uint8Array,
): Promise<boolean> {
  const stored = await store.getWithEtag(canonicalGraphKey(citySlug));
  if (stored === null) return false;
  return sha256(stored.body) === sha256(body);
}

/**
 * Publish a new canonical city snapshot.
 *
 * Two preconditions, both refusals rather than warnings:
 *
 *   1. the canonical object still carries `readAnchor.etag` — the version it
 *      had when the SOURCE of `body` was read. This is the window that matters:
 *      a body derived from a snapshot read minutes ago is stale the moment
 *      anyone else publishes, whether or not the archive (taken later) happened
 *      to capture that publication;
 *   2. `archive` covers that same version. An archive of an older version
 *      cannot restore what this write destroys, and the module's promise is
 *      precisely that no version is destroyed without an archive OF THAT
 *      VERSION. On a `--resume`, this is what refuses to publish over bytes the
 *      interrupted run never archived.
 *
 * NOT atomic — S3 offers no multi-key transaction. The HEAD re-check narrows
 * the race, and the conditional PUT closes it wherever the backend honours
 * `If-Match`; neither is claimed to eliminate it.
 */
export async function writeCanonicalCityGraph(
  store: CanonicalGraphStore,
  params: {
    citySlug: string;
    body: Uint8Array;
    archive: CanonicalArchiveReceipt;
    /** Version observed when the source of `body` was read. Mandatory on purpose. */
    readAnchor: CanonicalReadAnchor;
  },
): Promise<void> {
  const { citySlug, body, archive, readAnchor } = params;
  const key = canonicalGraphKey(citySlug);
  if (!isCanonicalGraphKey(key)) throw new Error(`not a canonical graph key: ${key}`);
  if (archive.city !== citySlug) {
    throw new Error(`archive is for ${archive.city}, refusing to write ${citySlug}`);
  }
  if (readAnchor.city !== citySlug) {
    throw new Error(`read anchor is for ${readAnchor.city}, refusing to write ${citySlug}`);
  }

  const current = await store.head(key);
  const found = current?.etag ?? null;
  if (found !== readAnchor.etag) {
    throw new ConcurrentCanonicalWrite({
      key,
      reason: "read-anchor",
      expected: readAnchor.etag,
      found,
    });
  }
  if (archive.canonical_etag !== readAnchor.etag) {
    throw new ConcurrentCanonicalWrite({
      key,
      reason: "archive-out-of-date",
      expected: archive.canonical_etag,
      found,
    });
  }

  await store.putCanonicalGraph(key, body, "application/json", {
    ifMatch: readAnchor.etag,
  });
}
