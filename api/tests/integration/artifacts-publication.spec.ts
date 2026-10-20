import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { composeArtifactHost, createArtifactControl } from "@radar/artifacts-host";
import { parseContentHost } from "@sentropic/artifacts/content/routing";
import { startHarness, type Harness } from "./artifacts-h2.helpers.js";

let h: Harness;
beforeAll(async () => { h = await startHarness("publication"); });
afterAll(async () => { await h?.close(); });
const ensure = (key = "ensure") => ({ bindingName: "summer", idempotencyKey: key });
const file = { path: "index.html", mimeType: "text/html", text: "Été 🏠" };
async function artifactId() {
  const response = await h.control.handle("ensure", "alice", ensure());
  expect(response.status).toBe(201);
  return (response.body as { artifactId: string }).artifactId;
}
describe("artifact Postgres and S3 publication", () => {
  it("converges on one SQL binding under ten concurrent ensures and after restart", async () => {
    const responses = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      h.control.handle("ensure", "alice", ensure(`concurrent-${i}`))));
    expect(responses.map((r) => r.status)).toEqual(Array(10).fill(201));
    const ids = responses.map((r) => (r.body as { artifactId: string }).artifactId);
    expect(new Set(ids).size).toBe(1);
    const replays = await Promise.all(Array.from({ length: 10 }, () =>
      h.control.handle("ensure", "alice", ensure("same-key"))));
    expect(replays.map((r) => (r.body as { artifactId: string }).artifactId)).toEqual(Array(10).fill(ids[0]));
    expect((await h.pool.query("SELECT count(*) FROM artifacts.artifacts")).rows[0].count).toBe("1");
    const restarted = (await composeArtifactHost(h.pool, h.config))!;
    const again = await createArtifactControl(restarted, h.config.storageScope, "pages.example.test")
      .handle("ensure", "alice", ensure("restart"));
    expect((again.body as { artifactId: string }).artifactId).toBe(ids[0]);
    restarted.close();
  });
  it("publishes exactly one release for five simultaneous retries and rejects parameter drift", async () => {
    const id = await artifactId();
    const body = { artifactId: id, files: [file], idempotencyKey: "publish", paramsHash: "forged",
      source: { kind: "base-commit", commit: "forged" } };
    const results = await Promise.all(Array.from({ length: 5 }, () => h.control.handle("publish", "alice", body)));
    expect(results.map((r) => r.status)).toEqual(Array(5).fill(201));
    expect(new Set(results.map((r) => (r.body as { releaseId: string }).releaseId)).size).toBe(1);
    expect((await h.pool.query("SELECT count(*) FROM artifacts.releases")).rows[0].count).toBe("1");
    const release = (await h.pool.query("SELECT manifest FROM artifacts.releases")).rows[0];
    expect(JSON.parse(release.manifest).files[0].size).toBe(Buffer.byteLength(file.text));
    const digest = JSON.parse(release.manifest).files[0].digest as string;
    const bytes = await h.blobs.getBlob(`artifacts/${h.config.storageScope}/blobs/sha256/${digest.slice(7)}`);
    expect(new TextDecoder().decode(bytes)).toBe(file.text);
    expect((await h.pool.query("SELECT kind FROM artifacts.artifact_sources")).rows[0].kind).toBe("inline-original");
    const receipt = results[0]!.body as { stableUrl: string; pinnedUrl: string; digest: string };
    expect(parseContentHost(new URL(receipt.stableUrl).host, "pages.example.test")).toEqual({ kind: "stable", artifactId: id });
    expect(parseContentHost(new URL(receipt.pinnedUrl).host, "pages.example.test")?.kind).toBe("pinned");
    expect(receipt.digest).toMatch(/^[a-f0-9]{64}$/);
    expect((await h.control.handle("publish", "alice", { ...body, files: [{ ...file, text: "changed" }] })).status).toBe(409);
    expect((await h.control.handle("publish", "alice", { ...body,
      profile: JSON.parse('{"__proto__":{"title":"changed"}}') })).status).toBe(409);
    const key1 = await h.control.handle("ensure", "alice", { bindingName: "shared-key", idempotencyKey: "same" });
    const key2 = await h.control.handle("ensure", "bob", { bindingName: "shared-key", idempotencyKey: "same" });
    expect((key1.body as { artifactId: string }).artifactId).not.toBe((key2.body as { artifactId: string }).artifactId);
    const bobPublication = await h.control.handle("publish", "bob", { ...body,
      artifactId: (key2.body as { artifactId: string }).artifactId });
    expect(bobPublication.status).toBe(201);
    expect((bobPublication.body as { releaseId: string }).releaseId)
      .not.toBe((results[0]!.body as { releaseId: string }).releaseId);
  });
  it("leaves neither release nor current pointer when S3 fails", async () => {
    const ensured = await h.control.handle("ensure", "alice", { bindingName: "failure", idempotencyKey: "failure" });
    const id = (ensured.body as { artifactId: string }).artifactId;
    const broken = (await composeArtifactHost(h.pool, h.config, { ...h.blobs,
      async putBlob() { throw new Error("injected S3 failure"); } }))!;
    const response = await createArtifactControl(broken, h.config.storageScope, "pages.example.test")
      .handle("publish", "alice", { artifactId: id, files: [file], idempotencyKey: "failure" });
    expect(response.status).toBe(500);
    for (const table of ["releases", "artifact_current"]) {
      expect((await h.pool.query(`SELECT count(*) FROM artifacts.${table} WHERE artifact_id = $1`, [id])).rows[0].count).toBe("0");
    }
    broken.close();
  });
});
