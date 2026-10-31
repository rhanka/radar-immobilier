import { createServer as createHttpServer } from "node:http";
import { createServer as createTcpServer, type AddressInfo, type Socket } from "node:net";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { composeArtifactHost, createArtifactControl, createArtifactsPool } from "@radar/artifacts-host";
import { loadConfig } from "../../src/config.js";
import { migrationsFolder } from "./artifacts-h2.helpers.js";
import { seedArtifactMemberships } from "./artifacts-membership.helpers.js";

/**
 * Real publication (PostgreSQL preparation intent, finalization) against an S3
 * stand-in where every operation stalls on two connections and succeeds on the
 * third, as fresh TLS handshakes to s3.bhs.io.cloud.ovh.net did in preprod.
 * Production budgets: 4 s attempts x 3, a 20 s publish blob deadline, a 30 s
 * preparation window. Each blob operation then takes ~8 s: one file (2
 * operations) must publish, two files (4 operations, ~33 s) must end with a
 * retriable 503 before the window, never with a refused finalization.
 */
async function startThirdAttemptS3() {
  const objects = new Map<string, Buffer>();
  const sockets = new Set<Socket>();
  let connections = 0;
  const app = createHttpServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      res.setHeader("connection", "close");
      const url = new URL(req.url ?? "/", "http://s3.local");
      const path = decodeURIComponent(url.pathname);
      if (req.method === "PUT") {
        objects.set(path, Buffer.concat(chunks));
        res.writeHead(200, { etag: "\"stub\"" }).end();
      } else if (req.method === "GET" && url.searchParams.get("list-type") === "2") {
        res.writeHead(200, { "content-type": "application/xml" })
          .end("<?xml version=\"1.0\" encoding=\"UTF-8\"?><ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>");
      } else if (req.method === "GET" && objects.has(path)) {
        const body = objects.get(path)!;
        res.writeHead(200, { "content-length": String(body.length) }).end(body);
      } else if (req.method === "DELETE") {
        objects.delete(path);
        res.writeHead(204).end();
      } else {
        res.writeHead(404, { "content-type": "application/xml" }).end("<Error><Code>NoSuchKey</Code></Error>");
      }
    });
  });
  const front = createTcpServer((socket) => {
    connections += 1;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    if (connections % 3 !== 0) return; // accepted, never answered
    app.emit("connection", socket);
  });
  await new Promise<void>((resolve) => front.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(front.address() as AddressInfo).port}`,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => front.close(() => resolve()));
    },
  };
}

const env = loadConfig();
const params = { host: env.POSTGRES_HOST, port: env.POSTGRES_PORT, user: env.POSTGRES_USER,
  password: env.POSTGRES_PASSWORD, database: env.POSTGRES_DB };
const database = "artifacts_publish_deadline";
const SCOPE = "deadline_scope";
let admin: pg.Pool;
let pool: ReturnType<typeof createArtifactsPool>;

beforeAll(async () => {
  admin = new pg.Pool(params);
  await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${database}`);
  pool = createArtifactsPool({ ...params, database });
  await migrate(drizzle(pool), { migrationsFolder });
  await pool.query("INSERT INTO account_users (sub, status) VALUES ('alice', 'approved')");
  await seedArtifactMemberships(pool);
  await pool.query("INSERT INTO artifacts.storage_scopes (id, org_id) VALUES ($1, 'deadline_org')", [SCOPE]);
  await pool.query(`INSERT INTO artifacts.host_quotas (storage_scope_id, operation_limit, byte_limit)
    VALUES ($1, 1000000, 1000000000)`, [SCOPE]);
});

afterAll(async () => {
  await pool?.end();
  await admin?.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  await admin?.end();
});

describe("publish against a provider whose every operation needs three attempts", () => {
  it.each([
    [1, 201],
    [2, 503],
  ])("%i file(s): publishes or fails retriably inside the preparation window", async (files, expected) => {
    const s3 = await startThirdAttemptS3();
    const host = await composeArtifactHost(pool, { enabled: true, storageScope: SCOPE, orgId: "deadline_org",
      s3Bucket: "deadline", s3Endpoint: s3.url, s3Region: "bhs", s3AccessKey: "test", s3SecretKey: "test" });
    const control = createArtifactControl(host, SCOPE, "pages.example.test");
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const ensured = await control.handle("ensure", "alice", { bindingName: `deadline-${files}`,
        idempotencyKey: `deadline-ensure-${files}` });
      expect(ensured.status).toBe(201);
      const artifactId = (ensured.body as { artifactId: string }).artifactId;
      const started = Date.now();
      const published = await control.handle("publish", "alice", { artifactId, idempotencyKey: `deadline-${files}`,
        files: Array.from({ length: files }, (_, index) => ({ path: index === 0 ? "index.html" : `page-${index}.html`,
          mimeType: "text/html", text: `<p>page ${index}</p>` })) });
      const elapsed = Date.now() - started;
      expect(published.status, JSON.stringify(published.body)).toBe(expected);
      expect(elapsed).toBeLessThan(30_000);
      if (expected === 503) {
        expect(published.body).toEqual({ error: "capability_unavailable" });
        expect((published as { retryable?: boolean }).retryable).toBe(true);
        expect((await pool.query("SELECT count(*)::int AS n FROM artifacts.releases WHERE artifact_id = $1",
          [artifactId])).rows[0].n).toBe(0);
      }
    } finally {
      errors.mockRestore();
      host.close();
      await s3.close();
    }
  }, 90_000);
});
