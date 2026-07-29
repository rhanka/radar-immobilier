/**
 * In-memory stand-in for the S3 store, used by the canonical-writer and
 * Graphify 3.4 apply tests.
 *
 * It reproduces the two behaviours the guard depends on: `put()` refuses the
 * canonical key exactly like `S3ObjectStore.put()`, and `putCanonicalGraph()`
 * honours `If-Match` / `If-None-Match` by rejecting a stale expectation. Every
 * write mints a new ETag, so a concurrent publication is observable.
 */
import {
  isCanonicalGraphKey,
  type ObjectInfo,
  type StoredObject,
} from "../../storage/object-store.js";
import { CanonicalGraphWriteRefused } from "../../storage/s3-object-store.js";
import type { CanonicalGraphStore } from "./canonical-graph-writer.js";

const encoder = new TextEncoder();

export class PreconditionFailed extends Error {
  constructor(key: string) {
    super(`precondition failed for ${key}`);
    this.name = "PreconditionFailed";
  }
}

export class FakeGraphStore implements CanonicalGraphStore {
  readonly objects = new Map<string, { body: Uint8Array; etag: string }>();
  readonly puts: string[] = [];
  private sequence = 0;
  private readonly raceOnRead = new Map<string, Uint8Array | string>();

  /**
   * Arm a concurrent publisher: the next READ of `key` returns the bytes it
   * found, and a rival writer publishes `body` immediately afterwards.
   *
   * This is the interleaving of the review probe. It is armed on the read
   * itself — not on `get` or on `getWithEtag` specifically — so a reader that
   * takes bytes and version in one call and a reader that takes them in two
   * both meet the same rival, and only the first records a version that
   * actually describes the bytes it holds.
   */
  publishOnNextReadOf(key: string, body: Uint8Array | string): void {
    this.raceOnRead.set(key, body);
  }

  private runRaceFor(key: string): void {
    const pending = this.raceOnRead.get(key);
    if (pending === undefined) return;
    this.raceOnRead.delete(key);
    this.write(key, pending);
    this.puts.pop();
  }

  /** Pre-existing object: not counted as a write made by the code under test. */
  seed(key: string, body: string | Uint8Array): void {
    this.write(key, body);
    this.puts.pop();
  }

  etagOf(key: string): string | null {
    return this.objects.get(key)?.etag ?? null;
  }

  private write(key: string, body: Uint8Array | string): { key: string } {
    const bytes = typeof body === "string" ? encoder.encode(body) : body;
    this.sequence += 1;
    this.objects.set(key, { body: bytes, etag: `"etag-${this.sequence}"` });
    this.puts.push(key);
    return { key };
  }

  async list(prefix: string): Promise<string[]> {
    return [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
  }

  async get(key: string): Promise<Uint8Array> {
    const stored = this.objects.get(key);
    if (stored === undefined) throw new Error(`no such object: ${key}`);
    this.runRaceFor(key);
    return stored.body;
  }

  async getWithEtag(key: string): Promise<StoredObject | null> {
    const stored = this.objects.get(key);
    if (stored === undefined) return null;
    const served = { key, body: stored.body, etag: stored.etag };
    this.runRaceFor(key);
    return served;
  }

  async head(key: string): Promise<ObjectInfo | null> {
    const stored = this.objects.get(key);
    return stored === undefined
      ? null
      : { key, size: stored.body.byteLength, etag: stored.etag };
  }

  async put(key: string, body: Uint8Array | string, _contentType?: string): Promise<unknown> {
    if (isCanonicalGraphKey(key)) throw new CanonicalGraphWriteRefused(key);
    return this.write(key, body);
  }

  async putCanonicalGraph(
    key: string,
    body: Uint8Array | string,
    _contentType: string | undefined,
    options: { ifMatch: string | null },
  ): Promise<unknown> {
    const current = this.objects.get(key) ?? null;
    if (options.ifMatch === null && current !== null) throw new PreconditionFailed(key);
    if (options.ifMatch !== null && current?.etag !== options.ifMatch) {
      throw new PreconditionFailed(key);
    }
    return this.write(key, body);
  }
}
