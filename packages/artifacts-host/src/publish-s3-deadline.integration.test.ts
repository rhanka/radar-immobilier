import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { composeArtifactHost } from "./composition.js";
import { createArtifactControl, type ArtifactControl } from "./facade.js";
import { p0bFixture } from "./p0b.test-support.js";
import { startS3, type S3Stub } from "./s3-stub.test-support.js";

/** 30 distinct pages of ~8.5 KiB: ~250 KiB total, under the 256 KiB profile cap. */
function thirtyFiles(): { path: string; mimeType: string; text: string }[] {
  return Array.from({ length: 30 }, (_, index) => {
    const head = `<!doctype html><html><body><h1>slow file ${index}</h1><p>`;
    const tail = "</p></body></html>";
    return { path: `page-${index}.html`, mimeType: "text/html",
      text: `${head}${"x".repeat(8500 - head.length - tail.length)}${tail}` };
  });
}

describe.skipIf(!process.env.P0B_DATABASE_URL)("publish against a slow provider", () => {
  let h: Awaited<ReturnType<typeof p0bFixture>>;
  const extraHosts: Awaited<ReturnType<typeof composeArtifactHost>>[] = [];
  beforeAll(async () => { h = await p0bFixture(); });
  afterAll(async () => {
    for (const host of extraHosts.splice(0)) host.close();
    await h?.close();
  });
  beforeEach(async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await h.pool.query("DELETE FROM artifacts.host_actor_rate");
    await h.pool.query("UPDATE artifacts.host_quotas SET operation_limit=1000,byte_limit=10000000");
    await h.pool.query("UPDATE artifacts.host_actor_quotas SET operation_limit=1000,byte_limit=10000000");
  });
  afterEach(() => { vi.restoreAllMocks(); });

  async function s3BackedControl(s3: S3Stub, extra: Record<string, unknown>): Promise<ArtifactControl> {
    const host = await composeArtifactHost(h.pool, { enabled: true, storageScope: "p0b", orgId: "test",
      s3Bucket: "test-bucket", s3Endpoint: s3.url, s3Region: "bhs",
      s3AccessKey: "test", s3SecretKey: "test", ...extra },
    undefined, { confirmation: h.confirmation, contentBase: "pages.test",
      readActivation: () => ({ enabled: true, subjects: [],
        expiresAtMs: Number.POSITIVE_INFINITY, mode: "general" }),
      // Files parity LOT 2 — the provider requires the page wiring as soon
      // as the mint capability is selected (always under P0B).
      uploadPage: { cookieSecret: "test-upload-page-secret-32-bytes-padding",
        controlOrigin: "https://app.test", pageBaseUrl: "https://app.test/api/v1", s3Origins: [] } });
    extraHosts.push(host);
    return createArtifactControl(host, "p0b", "pages.test");
  }

  async function ensure(control: ArtifactControl): Promise<string> {
    const ensured = await control.handle("ensure", "alice",
      { bindingName: `slow-${randomUUID()}`, idempotencyKey: randomUUID() });
    expect(ensured.status).toBe(201);
    return (ensured.body as { artifactId: string }).artifactId;
  }

  async function committed(artifactId: string): Promise<{ releases: number; current: string | null }> {
    const releases = await h.pool.query("SELECT id FROM artifacts.releases WHERE artifact_id=$1", [artifactId]);
    const current = await h.pool.query("SELECT release_id FROM artifacts.artifact_current WHERE artifact_id=$1",
      [artifactId]);
    return { releases: releases.rows.length, current: current.rows[0]?.release_id ?? null };
  }

  it("publishes 30 files of ~250KiB at 1.3s per request inside a configured deadline", async () => {
    const s3 = await startS3({ latencyMs: 1300 });
    try {
      const control = await s3BackedControl(s3, { publishBlobDeadlineMs: 110_000 });
      const artifactId = await ensure(control);
      // 30 files x (PUT + GET) x 1.3s = 78s sequential: over the 20s default,
      // inside the configured bound.
      const published = await control.handle("publish", "alice",
        { artifactId, files: thirtyFiles(), idempotencyKey: randomUUID() });
      expect(published.status).toBe(201);
      const releaseId = (published.body as { releaseId: string }).releaseId;
      expect(await committed(artifactId)).toEqual({ releases: 1, current: releaseId });
      expect(s3.requests).toBe(60);
      expect(s3.timeline.every((record) => record.method === "PUT" || record.method === "GET")).toBe(true);
    } finally { await s3.close(); }
  }, 180_000);

  it("refuses a 30-file publish at 2.5s per request under the default deadline with a retriable 503", async () => {
    const s3 = await startS3({ latencyMs: 2500 });
    try {
      const control = await s3BackedControl(s3, {});
      const artifactId = await ensure(control);
      const before = await h.pool.query(
        "SELECT operation, reason, status FROM artifacts.host_failures WHERE operation='publish'");
      const published = await control.handle("publish", "alice",
        { artifactId, files: thirtyFiles(), idempotencyKey: randomUUID() });
      expect(published.status).toBe(503);
      expect(published.body).toMatchObject({ error: "capability_unavailable" });
      expect(published).toHaveProperty("retryable", true);
      expect(await committed(artifactId)).toEqual({ releases: 0, current: null });
      const after = await h.pool.query(
        "SELECT operation, reason, status FROM artifacts.host_failures WHERE operation='publish'");
      expect(after.rows.length - before.rows.length).toBe(1);
      expect(after.rows).toContainEqual(
        { operation: "publish", reason: "provider_unavailable", status: 503 });
    } finally { await s3.close(); }
  }, 120_000);

  it("leaves nothing committed when the provider fails mid-way", async () => {
    const s3 = await startS3({ latencyMs: 100, fail: (request) => request >= 31
      ? { status: 503, code: "ServiceUnavailable" } : undefined });
    try {
      const control = await s3BackedControl(s3, {});
      const artifactId = await ensure(control);
      const published = await control.handle("publish", "alice",
        { artifactId, files: thirtyFiles(), idempotencyKey: randomUUID() });
      // The first read-back fails on every SDK attempt: nothing is finalized.
      expect(published.status).toBe(503);
      expect(published.body).toMatchObject({ error: "capability_unavailable" });
      expect(await committed(artifactId)).toEqual({ releases: 0, current: null });
    } finally { await s3.close(); }
  }, 120_000);

  it("publishes 30 files at 2.5s per request inside a raised deadline", async () => {
    const s3 = await startS3({ latencyMs: 2500 });
    try {
      const control = await s3BackedControl(s3, { publishBlobDeadlineMs: 200_000 });
      const artifactId = await ensure(control);
      // 30 files x (PUT + GET) x 2.5s = 150s sequential: inside the raised bound.
      const published = await control.handle("publish", "alice",
        { artifactId, files: thirtyFiles(), idempotencyKey: randomUUID() });
      expect(published.status).toBe(201);
      const releaseId = (published.body as { releaseId: string }).releaseId;
      expect(await committed(artifactId)).toEqual({ releases: 1, current: releaseId });
      expect(s3.requests).toBe(60);
    } finally { await s3.close(); }
  }, 300_000);
});
