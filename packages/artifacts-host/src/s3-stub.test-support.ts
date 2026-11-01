import { createServer as createHttpServer } from "node:http";
import { createServer as createTcpServer, type AddressInfo, type Socket } from "node:net";
import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import { vi } from "vitest";
import { classifyArtifactFailure } from "@sentropic/artifacts/server/outcome-contract";
import { mapHostError } from "./host-outcome.js";

export const BUCKET = "test-bucket";

export function blob(text: string) {
  const bytes = new TextEncoder().encode(text);
  return { bytes, key: `artifacts/scope/blobs/sha256/${createHash("sha256").update(bytes).digest("hex")}` };
}

export interface S3StubOptions {
  /** Connections (1-based) accepted and never answered: how a stalled TLS handshake looks to the client. */
  readonly stalled?: (connection: number) => boolean;
  /** Requests (1-based) answered with a provider error instead of being served. */
  readonly fail?: (request: number) => { readonly status: number; readonly code: string; readonly delayMs?: number } | undefined;
  /** Close each connection after its answer, so every operation needs new connections. */
  readonly close?: boolean;
}

/**
 * Local S3 stand-in for the failure measured from the preprod MCP pod against
 * s3.bhs.io.cloud.ovh.net (TCP connects at once, then some connections get no
 * TLS answer for 5-30 s), serving path-style PutObject/GetObject from memory.
 */
export async function startS3(options: S3StubOptions = {}) {
  const objects = new Map<string, Buffer>();
  const sockets = new Set<Socket>();
  const requestTimes: number[] = [];
  let connections = 0;
  const app = createHttpServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      requestTimes.push(Date.now());
      if (options.close) res.setHeader("connection", "close");
      const path = decodeURIComponent(new URL(req.url ?? "/", "http://s3.local").pathname);
      const xmlError = (status: number, code: string): void => {
        res.writeHead(status, { "content-type": "application/xml" })
          .end(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${code}</Message></Error>`);
      };
      const failure = options.fail?.(requestTimes.length);
      if (failure) {
        setTimeout(() => xmlError(failure.status, failure.code), failure.delayMs ?? 0);
        return;
      }
      if (req.method === "PUT") {
        objects.set(path, Buffer.concat(chunks));
        res.writeHead(200, { etag: "\"probe\"" }).end();
        return;
      }
      if (req.method === "GET") {
        const body = objects.get(path);
        if (!body) {
          xmlError(404, "NoSuchKey");
          return;
        }
        res.writeHead(200, { "content-length": String(body.length) }).end(body);
        return;
      }
      xmlError(405, "MethodNotAllowed");
    });
  });
  const front = createTcpServer((socket) => {
    connections += 1;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    if (options.stalled?.(connections)) return; // accepted, never answered
    app.emit("connection", socket);
  });
  await new Promise<void>((resolve) => front.listen(0, "127.0.0.1", resolve));
  const { port } = front.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    object: (key: string) => objects.get(`/${BUCKET}/${key}`),
    get connections() { return connections; },
    get requests() { return requestTimes.length; },
    requestTimes,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => front.close(() => resolve()));
    },
  };
}

export type S3Stub = Awaited<ReturnType<typeof startS3>>;

export const stubPool = () => ({ query: vi.fn().mockResolvedValue({ rows: [] }) }) as unknown as pg.Pool;

export const stubConfig = (s3Endpoint: string, extra: Record<string, unknown> = {}) => ({
  enabled: true as const, storageScope: "scope", orgId: "org", s3Bucket: BUCKET,
  s3Endpoint, s3Region: "bhs", s3AccessKey: "test", s3SecretKey: "test", ...extra,
});

/** The projection a failed publish would get from the coordinator. */
export const failureOf = (cause: unknown) => classifyArtifactFailure(cause, {
  invocationId: randomUUID(), operation: "publish", phase: "dispatch", commitState: "not_committed",
}, mapHostError);

/** Each operation stalls on two connections and succeeds on its third (with `close`). */
export const thirdAttemptOnly = (connection: number) => connection % 3 !== 0;
