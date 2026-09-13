import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readObjectRecord, sameDestinationRecord } from "./copy-canonical-docs-parity.mjs";

class GetObjectCommand { constructor(input) { this.input = input; } }
class GetObjectTaggingCommand { constructor(input) { this.input = input; } }
const body = Buffer.from("canonical body");
const sha256 = createHash("sha256").update(body).digest("hex");
const item = { key: "docs/example.pdf", size: body.length, sha256,
  contentType: "application/pdf", contentEncoding: "gzip", cacheControl: "public, max-age=60",
  contentDisposition: "inline", metadata: { origin: "canonical", revision: "1" },
  tags: [{ Key: "corpus", Value: "docs" }], etag: '"source-etag"', versionId: "source-version" };
const digestBody = async (response) => {
  const hash = createHash("sha256"); let bytes = 0;
  for await (const chunk of response.Body) { bytes += chunk.length; hash.update(chunk); }
  return { bytes, sha256: hash.digest("hex") };
};
const read = async ({ metadata = item.metadata, tags = item.tags } = {}) => readObjectRecord({
  client: { send: async (command) => command instanceof GetObjectCommand ? {
    Body: [body], ContentLength: body.length, ContentType: item.contentType,
    ContentEncoding: item.contentEncoding, CacheControl: item.cacheControl,
    ContentDisposition: item.contentDisposition, Metadata: metadata,
    ETag: '"destination-etag"', VersionId: "destination-version",
  } : { TagSet: tags } },
  bucket: "destination", key: item.key, GetObjectCommand, GetObjectTaggingCommand, digestBody,
});

assert.equal(sameDestinationRecord(item, await read()), true,
  "destination ETag and VersionId must not be compared with the source manifest");
assert.equal(sameDestinationRecord(item, await read({ metadata: { ...item.metadata, revision: "2" } })), false,
  "metadata drift must prevent destination parity");
assert.equal(sameDestinationRecord(item, await read({ tags: [{ Key: "corpus", Value: "other" }] })), false,
  "tag drift must prevent destination parity");
console.log("canonical destination parity hermetic test: PASS");
