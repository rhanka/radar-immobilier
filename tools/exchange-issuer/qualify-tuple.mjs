import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const manifest = JSON.parse(await readFile("packages/immo-mcp/package.json", "utf8"));
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
for (const [name, version] of [["mcp-auth", "0.2.2"], ["oauth-verify", "0.1.0"]]) {
  const id = `@sentropic/${name}`;
  const entry = lock.packages[`packages/immo-mcp/node_modules/${id}`] ?? lock.packages[`node_modules/${id}`];
  assert.equal(entry?.version, version, `${id}: qualified integration commit required`);
  assert.equal(manifest.dependencies[id], `^${version}`, `${id}: manifest tuple mismatch`);
  assert(typeof entry.resolved === "string" && typeof entry.integrity === "string", `${id}: archive URL and integrity required in lockfile`);
  const metadataResponse = await fetch(`https://registry.npmjs.org/${id}/${version}`, { redirect: "error" });
  assert(metadataResponse.ok, `${id}: publication not available`);
  const metadata = await metadataResponse.json();
  assert.equal(metadata.dist.integrity, entry.integrity, `${id}: lock integrity mismatch`);
  assert.equal(metadata.dist.tarball, entry.resolved, `${id}: archive URL mismatch`);
  const archiveResponse = await fetch(entry.resolved, { redirect: "error" });
  assert(archiveResponse.ok, `${id}: archive not available`);
  const bytes = Buffer.from(await archiveResponse.arrayBuffer());
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  assert.equal(integrity, entry.integrity, `${id}: archive bytes mismatch`);
  assert(metadata.dist.signatures?.length, `${id}: registry signatures missing`);
  assert(metadata.dist.attestations?.url, `${id}: provenance attestation missing`);
  console.log(JSON.stringify({ id, version, bytes: bytes.length, integrity,
    archive: entry.resolved, attestations: metadata.dist.attestations.url,
    sha256: createHash("sha256").update(bytes).digest("hex") }));
}
