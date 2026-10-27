import { createServer, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";
import { createTestS3BlobStore } from "../artifacts-blob-store.helpers.js";
import {
  ArtifactS3TimeoutError,
  createTimeoutBlobStore,
  createTimeoutS3Client,
  withArtifactAdvisoryLock,
} from "@radar/artifacts-host";
import { startHarness, type Harness } from "./artifacts-h2.helpers.js";

let h: Harness;
let server: Server;
let port = 0;
const sockets = new Set<Socket>();
let requests = 0;

beforeAll(async () => {
  h = await startHarness("s3timeout", ["alice"]);
  // Send headers with a large body, then stall: the exact gap where
  // requestTimeout no longer applies but body streaming hangs.
  server = createServer((_req, res) => {
    requests += 1;
    res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": "1048576" });
    res.write("stalled");
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await h?.close();
});

describe("artifact stalled S3 body", () => {
  it("fails within the deadline and frees the lock and connection", async () => {
    h.host.cleanup.stop();
    await h.host.cleanup.runOnce();
    const raw = new S3Client({
      endpoint: `http://127.0.0.1:${port}`, forcePathStyle: true, region: "us-east-1",
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
      requestHandler: { requestTimeout: 5000, connectionTimeout: 3000, throwOnRequestTimeout: true },
    });
    const client = createTimeoutS3Client(raw, 1000);
    const blobs = createTimeoutBlobStore(createTestS3BlobStore({ client, bucket: "stalled" }), 1000);
    try {
      const keys = Array.from({ length: 5 }, (_, i) => `ef${i.toString(16).padStart(2, "0")}`.padEnd(32, "0"));
      await Promise.all(keys.map(async (key) => {
        await expect(
          withArtifactAdvisoryLock(h.pool, key, () => blobs.getBlob(`artifacts/stalled/blobs/sha256/${"a".repeat(64)}`)),
        ).rejects.toBeInstanceOf(ArtifactS3TimeoutError);
      }));
      await vi.waitFor(() => expect(sockets.size).toBe(0));
      expect(h.pool.idleCount).toBe(h.pool.totalCount);
      for (const key of keys) {
        await expect(withArtifactAdvisoryLock(h.pool, key, async () => "recovered")).resolves.toBe("recovered");
      }
      expect(requests).toBe(5);
      await expect(withArtifactAdvisoryLock(h.pool, "ef".repeat(16), async () => "recovered")).resolves.toBe(
        "recovered",
      );
      const ensured = await h.control.handle("ensure", "alice", { bindingName: "after-stall", idempotencyKey: "after-stall" });
      expect(ensured.status).toBe(201);
      const artifactId = (ensured.body as { artifactId: string }).artifactId;
      const published = await h.control.handle("publish", "alice", { artifactId,
        files: [{ path: "index.html", mimeType: "text/html", text: "recovered" }], idempotencyKey: "after-stall" });
      expect(published.status).toBe(201);
    } finally {
      client.destroy();
    }
  }, 30000);
});
