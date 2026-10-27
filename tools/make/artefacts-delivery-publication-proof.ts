import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { startHarness } from "../../api/tests/integration/artifacts-h2.helpers.js";

// Real PostgreSQL/S3, concurrent business calls and the original publication contract.
const runs = [];
for (let iteration = 0; iteration < 12; iteration++) {
  const h = await startHarness(`deliverypub${iteration}`, ["alice", "bob"]);
  try {
    const ensured = await h.control.handle("ensure", "alice", { bindingName: "summer", idempotencyKey: "ensure" });
    assert.equal(ensured.status, 201);
    const artifactId = (ensured.body as { artifactId: string }).artifactId;
    const text = "Summer 🏠";
    const body = { artifactId, files: [{ path: "index.html", mimeType: "text/html", text }], idempotencyKey: "publish" };
    const results = await Promise.all(Array.from({ length: 5 }, () => h.control.handle("publish", "alice", body)));
    const statuses = results.map((result) => result.status);
    console.log(JSON.stringify({ iteration, statuses }));
    assert.deepEqual(statuses, Array(5).fill(201));
    assert.equal(new Set(results.map((result) => (result.body as { releaseId: string }).releaseId)).size, 1);
    const releases = await h.pool.query("SELECT manifest FROM artifacts.releases");
    assert.equal(releases.rows.length, 1);
    const manifest = JSON.parse(releases.rows[0].manifest);
    assert.equal(manifest.files[0].size, Buffer.byteLength(text));
    const bytes = await h.blobs.getBlob(`artifacts/${h.config.storageScope}/blobs/sha256/${manifest.files[0].digest.slice(7)}`);
    assert.equal(new TextDecoder().decode(bytes), text);
    runs.push({ iteration, calls: 5, releaseCount: 1, bytesVerified: true });
  } finally { await h.close(); }
}
writeFileSync("/evidence/publication-stress.json", JSON.stringify({ runs, calls: runs.length * 5 }, null, 2) + "\n");
