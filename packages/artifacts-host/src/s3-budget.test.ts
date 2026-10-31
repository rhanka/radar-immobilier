import { createServer as createHttpServer } from "node:http";
import { createServer as createTcpServer, type AddressInfo, type Socket } from "node:net";
import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyArtifactFailure } from "@sentropic/artifacts/server/outcome-contract";
import { composeArtifactHost } from "./composition.js";
import { mapHostError } from "./host-outcome.js";

vi.mock("./storage.js", () => ({
  initializeArtifactScope: vi.fn().mockResolvedValue(undefined),
}));

const BUCKET = "test-bucket";
const BYTES = new TextEncoder().encode("<!doctype html><title>probe</title>");
const KEY = `artifacts/scope/blobs/sha256/${createHash("sha256").update(BYTES).digest("hex")}`;
const FAST_BUDGET = { attemptTimeoutMs: 300, maxAttempts: 3, operationTimeoutMs: 1500 };

/**
 * Local S3 stand-in for the failure measured from the preprod MCP pod against
 * s3.bhs.io.cloud.ovh.net: TCP connects at once, then some connections get no
 * TLS answer for 5-30 s. To the client such a connection is accepted and silent.
 * Connections whose 1-based ordinal is in `stalled` behave like that; the
 * others serve path-style PutObject/GetObject from memory.
 */
async function startS3(options: { stalled: (ordinal: number) => boolean; close?: boolean; deny?: boolean }) {
  const objects = new Map<string, Buffer>();
  const sockets = new Set<Socket>();
  let connections = 0;
  let requests = 0;
  const app = createHttpServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      requests += 1;
      if (options.close) res.setHeader("connection", "close");
      const path = decodeURIComponent(new URL(req.url ?? "/", "http://s3.local").pathname);
      const xmlError = (status: number, code: string) => res
        .writeHead(status, { "content-type": "application/xml" })
        .end(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${code}</Message></Error>`);
      if (options.deny) return xmlError(403, "AccessDenied");
      if (req.method === "PUT") {
        objects.set(path, Buffer.concat(chunks));
        return res.writeHead(200, { etag: "\"probe\"" }).end();
      }
      if (req.method === "GET") {
        const body = objects.get(path);
        if (!body) return xmlError(404, "NoSuchKey");
        return res.writeHead(200, { "content-length": String(body.length) }).end(body);
      }
      return xmlError(405, "MethodNotAllowed");
    });
  });
  const front = createTcpServer((socket) => {
    connections += 1;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    if (options.stalled(connections)) return; // accepted, never answered
    app.emit("connection", socket);
  });
  await new Promise<void>((resolve) => front.listen(0, "127.0.0.1", resolve));
  const { port } = front.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    object: (key: string) => objects.get(`/${BUCKET}/${key}`),
    get connections() { return connections; },
    get requests() { return requests; },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => front.close(() => resolve()));
    },
  };
}

const pool = () => ({ query: vi.fn().mockResolvedValue({ rows: [] }) }) as unknown as pg.Pool;
const config = (s3Endpoint: string, extra: Record<string, unknown> = {}) => ({
  enabled: true as const, storageScope: "scope", orgId: "org", s3Bucket: BUCKET,
  s3Endpoint, s3Region: "bhs", s3AccessKey: "test", s3SecretKey: "test", ...extra,
});
const failureOf = (cause: unknown) => classifyArtifactFailure(cause, {
  invocationId: randomUUID(), operation: "publish", phase: "dispatch", commitState: "not_committed",
}, mapHostError);

async function withHost<T>(s3: Awaited<ReturnType<typeof startS3>>, extra: Record<string, unknown>,
  run: (host: Awaited<ReturnType<typeof composeArtifactHost>>) => Promise<T>): Promise<T> {
  const host = await composeArtifactHost(pool(), config(s3.url, extra));
  try { return await run(host); } finally { host.close(); await s3.close(); }
}

describe("artifact S3 budget against a stalling provider", () => {
  // The preparation sweeper ticks against the stub pool; its error line is noise here.
  beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => undefined); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("stores the blob when the first connection stalls, with the production budget", async () => {
    const s3 = await startS3({ stalled: (ordinal) => ordinal === 1 });
    await withHost(s3, {}, async (host) => {
      await host.blobs.putBlob(KEY, BYTES);
      expect(Buffer.from(s3.object(KEY) ?? [])).toEqual(Buffer.from(BYTES));
      expect(s3.connections).toBe(2);
    });
  }, 30_000);

  it("retries a stalled read-back on new connections inside the configured budget", async () => {
    const s3 = await startS3({ stalled: (ordinal) => ordinal === 2 || ordinal === 3, close: true });
    await withHost(s3, { s3Budget: FAST_BUDGET }, async (host) => {
      await host.blobs.putBlob(KEY, BYTES);
      await expect(host.blobs.getBlob(KEY)).resolves.toEqual(BYTES);
      expect(s3.connections).toBe(4);
    });
  }, 30_000);

  it("stays a retriable 503 once every bounded attempt has stalled", async () => {
    const s3 = await startS3({ stalled: () => true });
    await withHost(s3, { s3Budget: FAST_BUDGET }, async (host) => {
      const cause: unknown = await host.blobs.putBlob(KEY, BYTES).then(() => "stored", (error: unknown) => error);
      expect(cause).not.toBe("stored");
      expect(s3.connections).toBe(3);
      expect(failureOf(cause)).toMatchObject({ category: "provider_unavailable", httpStatus: 503,
        publicCode: "capability_unavailable", retriable: true });
    });
  }, 30_000);

  it("does not retry or mask a permanent refusal", async () => {
    const s3 = await startS3({ stalled: () => false, deny: true });
    await withHost(s3, { s3Budget: FAST_BUDGET }, async (host) => {
      const cause: unknown = await host.blobs.putBlob(KEY, BYTES).then(() => "stored", (error: unknown) => error);
      expect(cause).toMatchObject({ name: "AccessDenied", $metadata: { httpStatusCode: 403 } });
      expect(s3.requests).toBe(1);
      expect(failureOf(cause)).toMatchObject({ httpStatus: 500, retriable: false });
    });
  }, 30_000);
});
