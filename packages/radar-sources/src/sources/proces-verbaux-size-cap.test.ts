/**
 * Issue #805 — the PV adapter must refuse a document over the byte cap BEFORE
 * buffering it: on `Content-Length` without reading a byte, and without it as
 * soon as the counted stream crosses the cap.
 */
import { describe, expect, it, vi } from "vitest";

import { DocumentOversizeError } from "../document-size-cap.js";
import { sha256Hex } from "../RawDocument.js";
import {
  ProcesVerbauxGenericAdapter,
  PvSourceFetchError,
  SAINT_DAMASE_PV_CONFIG,
  type PvFetchLike,
} from "./proces-verbaux-generic.js";

const ref = {
  url: "https://example.org/zonage.pdf", sourceKind: "pv" as const,
  discoveredAt: "2026-10-03T00:00:00Z",
};

/** A pull-driven body: a chunk is produced only when the reader asks for it. */
function countedStream(chunks: Uint8Array[]) {
  let pulls = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[pulls];
      pulls += 1;
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  return { stream, pulls: () => pulls, cancelled: () => cancelled };
}

function response(body: ReadableStream<Uint8Array> | undefined, headers: Record<string, string>, bytes?: Uint8Array) {
  return {
    ok: true, status: 200,
    headers: new Headers({ "content-type": "application/pdf", ...headers }),
    ...(body ? { body } : {}),
    arrayBuffer: vi.fn(async () => (bytes ?? new Uint8Array()).buffer.slice(0) as ArrayBuffer),
  };
}

const chunk = (size: number, fill: number) => new Uint8Array(size).fill(fill);

function adapter(res: Awaited<ReturnType<PvFetchLike>>, maxDocumentBytes?: number) {
  return new ProcesVerbauxGenericAdapter(SAINT_DAMASE_PV_CONFIG, {
    fetchImpl: async () => res, onRequest: () => {},
    ...(maxDocumentBytes !== undefined ? { maxDocumentBytes } : {}),
  });
}

describe("PV document byte cap (#805)", () => {
  it("cancels the body unread when Content-Length announces more than the cap", async () => {
    const body = countedStream([chunk(400, 1)]);
    const res = response(body.stream, { "content-length": "180215792" });
    const error = await adapter(res, 1_000).fetch(ref).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DocumentOversizeError);
    expect(error).toMatchObject({ url: ref.url, capBytes: 1_000, bytesAnnounced: 180_215_792, bytesRead: 0 });
    expect(body.pulls()).toBe(0);
    expect(body.cancelled()).toBe(true);
    expect(res.arrayBuffer).not.toHaveBeenCalled();
  });

  it("aborts a body without Content-Length on the chunk that crosses the cap", async () => {
    const body = countedStream([chunk(400, 1), chunk(400, 2), chunk(400, 3), chunk(400, 4)]);
    const res = response(body.stream, {});
    const error = await adapter(res, 1_000).fetch(ref).catch((e: unknown) => e);
    expect(error).toMatchObject({ capBytes: 1_000, bytesAnnounced: null, bytesRead: 1_200 });
    // The fourth chunk is never requested: nothing is buffered past the cap.
    expect(body.pulls()).toBe(3);
    expect(body.cancelled()).toBe(true);
    expect(res.arrayBuffer).not.toHaveBeenCalled();
  });

  it("does not trust a Content-Length that understates the body", async () => {
    const body = countedStream([chunk(600, 1), chunk(600, 2), chunk(600, 3)]);
    const error = await adapter(response(body.stream, { "content-length": "500" }), 1_000)
      .fetch(ref).catch((e: unknown) => e);
    expect(error).toMatchObject({ bytesAnnounced: 500, bytesRead: 1_200 });
    expect(body.pulls()).toBe(2);
  });

  it("collects a document under the cap through its stream, byte for byte", async () => {
    const parts = [chunk(300, 7), chunk(300, 8), chunk(100, 9)];
    const expected = new Uint8Array([...parts[0]!, ...parts[1]!, ...parts[2]!]);
    const res = response(countedStream(parts).stream, { "content-length": "700" });
    const doc = await adapter(res, 1_000).fetch(ref);
    expect(doc.body).toEqual(expected);
    expect(doc.sha256).toBe(sha256Hex(expected));
    expect(res.arrayBuffer).not.toHaveBeenCalled();
  });

  it("checks a fetch double that exposes no stream after reading it", async () => {
    const big = response(undefined, {}, chunk(1_500, 1));
    await expect(adapter(big, 1_000).fetch(ref)).rejects.toMatchObject({
      name: "DocumentOversizeError", bytesAnnounced: null, bytesRead: 1_500 });
    const small = response(undefined, {}, chunk(500, 1));
    expect((await adapter(small, 1_000).fetch(ref)).body.byteLength).toBe(500);
  });

  it("applies no cap unless one is configured", async () => {
    const res = response(countedStream([chunk(4_000, 1), chunk(4_000, 2)]).stream, {});
    expect((await adapter(res).fetch(ref)).body.byteLength).toBe(8_000);
  });

  it("abandons and cancels a body that does not arrive within the time bound", async () => {
    let cancelled = false;
    let sent = false;
    const stalled = new ReadableStream<Uint8Array>({
      pull(controller) { if (!sent) { sent = true; controller.enqueue(chunk(100, 1)); } },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    const slow = new ProcesVerbauxGenericAdapter(SAINT_DAMASE_PV_CONFIG, {
      fetchImpl: async () => response(stalled, {}), onRequest: () => {}, documentTimeoutMs: 30,
    });
    const error = await slow.fetch(ref).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PvSourceFetchError);
    expect(error).toMatchObject({ kind: "timeout", phase: "document", url: ref.url, detail: "Document body timed out" });
    expect(cancelled).toBe(true);
  });

  it("turns a body cut off mid-transfer into a typed network failure", async () => {
    let pulls = 0;
    const cut = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) controller.enqueue(chunk(100, 1));
        else controller.error(new TypeError("terminated"));
      },
    }, { highWaterMark: 0 });
    await expect(adapter(response(cut, {}), 1_000).fetch(ref)).rejects.toMatchObject({
      name: "PvSourceFetchError", kind: "network", detail: "Document body interrupted" });
  });

  it("cancels the body of an HTTP error instead of leaving it to drain", async () => {
    const body = countedStream([chunk(400, 1)]);
    const res = { ...response(body.stream, {}), ok: false, status: 503 };
    await expect(adapter(res, 1_000).fetch(ref)).rejects.toMatchObject({ kind: "http", httpStatus: 503 });
    expect(body.cancelled()).toBe(true);
    expect(body.pulls()).toBe(0);
  });
});
