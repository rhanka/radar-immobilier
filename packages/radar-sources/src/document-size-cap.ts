/**
 * BYTE CAP ON A DOCUMENT BODY, ENFORCED BEFORE IT IS BUFFERED (issue #805).
 *
 * Every consumer of a `RawDocument` holds the whole body in one `Uint8Array`,
 * so the only place a too-large document can be refused cheaply is while its
 * body is still on the wire. On 2026-09-29 one 180,215,792-byte zoning bylaw
 * (903 pages) started killing the prod refresh pod (768 Mi) on every pass:
 * undici's `res.arrayBuffer()` alone holds three copies of the body at its
 * peak, and the S3 PUT over TLS adds a fourth.
 *
 *   - `Content-Length` above the cap ⇒ the body is cancelled UNREAD.
 *   - No (or a lying) `Content-Length` ⇒ the body is read through its stream
 *     reader, bytes are counted, and the read is aborted on the chunk that
 *     crosses the cap — never more than one chunk past it is held.
 *   - An optional time bound abandons a body that keeps trickling in.
 *
 * The refusal is a typed {@link DocumentOversizeError} carrying the bytes
 * announced and the bytes actually read, which RECUEIL turns into an `oversize`
 * outcome instead of a crash.
 */

/** The subset of a fetch `Response` the cap needs. */
export interface CappedBodySource {
  readonly headers: { get(name: string): string | null };
  /**
   * The body stream. `globalThis.fetch` always exposes it, so production never
   * buffers past the cap. A fetch double that only implements `arrayBuffer()`
   * is still accepted: its body is materialised first and then checked.
   */
  readonly body?: ReadableStream<Uint8Array> | null;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** A document body refused because it exceeds the byte cap. */
export class DocumentOversizeError extends Error {
  constructor(
    readonly url: string,
    /** The cap in force, in bytes. */
    readonly capBytes: number,
    /** `Content-Length` as announced by the server; `null` when absent or unparsable. */
    readonly bytesAnnounced: number | null,
    /** Body bytes actually read before the refusal (0 when refused on the header). */
    readonly bytesRead: number,
  ) {
    super(`Document exceeds the ${capBytes}-byte cap (announced ${bytesAnnounced ?? "unknown"}, read ${bytesRead})`);
    this.name = "DocumentOversizeError";
  }
}

/** `Content-Length` as a non-negative integer, or `null` when absent or malformed. */
export function announcedContentLength(headers: { get(name: string): string | null }): number | null {
  const raw = headers.get("content-length")?.trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

/** A document body that did not finish arriving within its time bound. */
export class DocumentBodyTimeoutError extends Error {
  constructor(readonly url: string, readonly timeoutMs: number, readonly bytesRead: number) {
    super(`Document body not received within ${timeoutMs} ms (read ${bytesRead})`);
    this.name = "DocumentBodyTimeoutError";
  }
}

/**
 * Read `res`'s body, refusing it as soon as it is known to exceed `capBytes`
 * and abandoning it once `timeoutMs` has elapsed. Either refusal cancels the
 * body explicitly, so the connection is released instead of draining. An
 * `Infinity` cap or timeout applies none.
 */
export async function readBodyWithinCap(
  res: CappedBodySource,
  url: string,
  capBytes: number,
  timeoutMs = Number.POSITIVE_INFINITY,
): Promise<Uint8Array> {
  const announced = announcedContentLength(res.headers);
  if (announced !== null && announced > capBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw new DocumentOversizeError(url, capBytes, announced, 0);
  }
  let total = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    if (Number.isFinite(timeoutMs)) {
      timer = setTimeout(() => reject(new DocumentBodyTimeoutError(url, timeoutMs, total)), timeoutMs);
    }
  });
  const bounded = <T>(step: Promise<T>): Promise<T> => Promise.race([step, expired]);
  try {
    if (!res.body) {
      const body = new Uint8Array(await bounded(res.arrayBuffer()));
      if (body.byteLength > capBytes) {
        throw new DocumentOversizeError(url, capBytes, announced, body.byteLength);
      }
      return body;
    }
    return await readCounted(res.body.getReader(), url, capBytes, announced, bounded, (n) => { total = n; });
  } finally {
    clearTimeout(timer);
  }
}

async function readCounted(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  url: string,
  capBytes: number,
  announced: number | null,
  bounded: <T>(step: Promise<T>) => Promise<T>,
  progress: (bytes: number) => void,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await bounded(reader.read());
      if (done) break;
      total += value.byteLength;
      progress(total);
      if (total > capBytes) throw new DocumentOversizeError(url, capBytes, announced, total);
      chunks.push(value);
    }
  } catch (error) {
    // Refused, timed out or interrupted: release the body, never drain it.
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  if (chunks.length === 1) return chunks[0]!;
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
