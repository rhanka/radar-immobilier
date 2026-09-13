import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { closeSync, fsyncSync, openSync, readdirSync, readFileSync, renameSync,
  writeFileSync, writeSync } from "node:fs";

const require = createRequire("/workspace/package.json");
const { GetObjectCommand, GetObjectTaggingCommand, ListObjectsV2Command, S3Client } =
  require("@aws-sdk/client-s3");

const required = (name) => process.env[name] || (() => {
  throw new Error(`${name} is required`);
})();
const endpoint = required("SOURCE_ENDPOINT");
const region = required("SOURCE_REGION");
const bucket = required("SOURCE_BUCKET");
const outputDir = required("OUTPUT_DIR");
const accessKeyId = required("MIGRATION_SOURCE_ACCESS_KEY_ID");
const secretAccessKey = required("MIGRATION_SOURCE_SECRET_ACCESS_KEY");
const concurrency = Number(process.env.CONCURRENCY ?? "128");
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 128) {
  throw new Error("CONCURRENCY must be between 1 and 128");
}

const client = new S3Client({ endpoint, region, forcePathStyle: false,
  credentials: { accessKeyId, secretAccessKey }, maxAttempts: 3 });
const coordinate = { endpoint, region, bucket, pathStyle: false };
const startedAt = new Date().toISOString();
const started = Date.now();
const listed = [];
let continuationToken;
do {
  const page = await client.send(new ListObjectsV2Command({
    Bucket: bucket, MaxKeys: 1000, ContinuationToken: continuationToken }));
  for (const item of page.Contents ?? []) {
    if (typeof item.Key !== "string" || typeof item.Size !== "number") {
      throw new Error("source listing contains an invalid object");
    }
    listed.push({ key: item.Key, size: item.Size, etag: item.ETag ?? "" });
  }
  continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  if (page.IsTruncated && !continuationToken) throw new Error("truncated listing lacks a token");
} while (continuationToken);
listed.sort((a, b) => Buffer.from(a.key).compare(Buffer.from(b.key)));
const listedBytes = listed.reduce((sum, item) => sum + item.size, 0);

const evidence = new Array(listed.length);
let completed = 0;
let completedBytes = 0;
let committed = 0;
const shardSize = 500;
const shardFiles = readdirSync(outputDir).filter((name) => /^shard-[0-9]{6}\.jsonl$/.test(name)).sort();
shardFiles.forEach((name, sequence) => {
  if (name !== `shard-${String(sequence + 1).padStart(6, "0")}.jsonl`) {
    throw new Error("canonical inventory shards are non-contiguous");
  }
  const items = readFileSync(`${outputDir}/${name}`, "utf8").trim().split("\n").map(JSON.parse);
  if (items.length !== shardSize && committed + items.length !== listed.length) {
    throw new Error("only the terminal canonical inventory shard may be short");
  }
  for (const item of items) {
    const expected = listed[committed];
    if (!expected || item.key !== expected.key || item.size !== expected.size ||
      !/^[0-9a-f]{64}$/.test(item.sha256)) throw new Error("checkpoint shard differs from listing");
    evidence[committed++] = item;
    completed += 1;
    completedBytes += item.size;
  }
});
let cursor = committed;
function recordProgress(force = false) {
  if (!force && completed % 500 !== 0) return;
  const elapsedSeconds = Math.max(1, (Date.now() - started) / 1000);
  const progress = { listedObjects: listed.length,
    listedBytes,
    hashedObjects: completed, hashedBytes: completedBytes, elapsedSeconds,
    objectsPerSecond: completed / elapsedSeconds,
    mebibytesPerSecond: completedBytes / 1048576 / elapsedSeconds };
  writeFileSync(`${outputDir}/progress.json.tmp`, `${JSON.stringify(progress)}\n`, { mode: 0o600 });
  renameSync(`${outputDir}/progress.json.tmp`, `${outputDir}/progress.json`);
}
function commitReadyShards() {
  while (committed < evidence.length) {
    const end = Math.min(committed + shardSize, evidence.length);
    if (evidence.slice(committed, end).some((item) => !item)) return;
    const sequence = Math.floor(committed / shardSize) + 1;
    const target = `${outputDir}/shard-${String(sequence).padStart(6, "0")}.jsonl`;
    const temporary = `${target}.tmp`;
    const fd = openSync(temporary, "wx", 0o600);
    for (const item of evidence.slice(committed, end)) writeSync(fd, `${JSON.stringify(item)}\n`);
    fsyncSync(fd); closeSync(fd); renameSync(temporary, target); committed = end;
    recordProgress(true);
  }
}
async function inspect(item) {
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: item.key }));
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of response.Body) {
    bytes += chunk.length;
    hash.update(chunk);
  }
  if (bytes !== item.size || Number(response.ContentLength) !== item.size) {
    throw new Error("source object changed during observation");
  }
  let tags = [];
  if (Number(response.TagCount ?? 0) > 0) {
    const tagged = await client.send(new GetObjectTaggingCommand({ Bucket: bucket, Key: item.key }));
    tags = (tagged.TagSet ?? []).map(({ Key, Value }) => ({ Key, Value }));
    tags.sort((a, b) => a.Key.localeCompare(b.Key));
  }
  return { key: item.key, size: bytes, sha256: hash.digest("hex"),
    contentType: response.ContentType ?? null,
    contentEncoding: response.ContentEncoding ?? null,
    cacheControl: response.CacheControl ?? null,
    contentDisposition: response.ContentDisposition ?? null,
    metadata: response.Metadata ?? {}, tags, etag: response.ETag ?? item.etag,
    versionId: response.VersionId ?? null, classification: "included" };
}
async function worker() {
  while (true) {
    const index = cursor++;
    if (index >= listed.length) return;
    evidence[index] = await inspect(listed[index]);
    completed += 1;
    completedBytes += listed[index].size;
    commitReadyShards();
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, listed.length) }, worker));
commitReadyShards();
recordProgress(true);

const sourceTmp = `${outputDir}/source-manifest.jsonl.tmp`;
const sourceFinal = `${outputDir}/source-manifest.jsonl`;
const sourceFd = openSync(sourceTmp, "wx", 0o600);
const sourceHash = createHash("sha256");
for (const item of evidence) {
  const line = `${JSON.stringify(item)}\n`;
  writeSync(sourceFd, line);
  sourceHash.update(line);
}
fsyncSync(sourceFd);
closeSync(sourceFd);
renameSync(sourceTmp, sourceFinal);
const manifestSha256 = sourceHash.digest("hex");

const canonicalTmp = `${outputDir}/canonical-manifest.json.tmp`;
const canonicalFinal = `${outputDir}/canonical-manifest.json`;
const canonicalFd = openSync(canonicalTmp, "wx", 0o600);
const canonicalHash = createHash("sha256");
const appendCanonical = (value) => {
  writeSync(canonicalFd, value);
  canonicalHash.update(value);
};
appendCanonical(`{"schemaVersion":1,"sources":[${JSON.stringify({
  ...coordinate,
  observedAt: new Date().toISOString(),
  manifestSha256,
})}],"objects":[`);
evidence.forEach((item, index) => {
  if (index) appendCanonical(",");
  appendCanonical(JSON.stringify({ ...item, sources: [coordinate] }));
});
appendCanonical("]}\n");
fsyncSync(canonicalFd);
closeSync(canonicalFd);
renameSync(canonicalTmp, canonicalFinal);

const elapsedSeconds = Math.max(1, (Date.now() - started) / 1000);
const bytes = evidence.reduce((sum, item) => sum + item.size, 0);
const summary = { schemaVersion: 1, source: coordinate, startedAt,
  completedAt: new Date().toISOString(), objects: evidence.length, bytes,
  maxObjectBytes: evidence.reduce((maximum, item) => Math.max(maximum, item.size), 0),
  concurrency,
  elapsedSeconds,
  objectsPerSecond: evidence.length / elapsedSeconds,
  mebibytesPerSecond: bytes / 1048576 / elapsedSeconds,
  manifestSha256, canonicalSha256: canonicalHash.digest("hex") };
const summaryTmp = `${outputDir}/summary.json.tmp`;
const summaryFinal = `${outputDir}/summary.json`;
writeFileSync(summaryTmp, `${JSON.stringify(summary)}\n`, { mode: 0o600, flag: "wx" });
const summaryFd = openSync(summaryTmp, "r");
fsyncSync(summaryFd);
closeSync(summaryFd);
renameSync(summaryTmp, summaryFinal);
console.log(JSON.stringify({ status: "complete", ...summary }));
