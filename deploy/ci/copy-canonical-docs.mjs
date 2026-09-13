import { createHash } from "node:crypto";
import { once } from "node:events";
import { closeSync, createReadStream, createWriteStream, fsyncSync, openSync,
  readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { Agent as HttpsAgent } from "node:https";
import { createRequire } from "node:module";

const require = createRequire("/workspace/package.json");
const { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } =
  require("@aws-sdk/client-s3");
const { NodeHttpHandler } = require("@smithy/node-http-handler");
const required = (name) => process.env[name] || (() => { throw new Error(`${name} is required`); })();
const manifestPath = required("CANONICAL_MANIFEST");
const manifestDigest = required("CANONICAL_DIGEST");
const reportDir = required("REPORT_DIR");
const proofPath = required("CONDITIONAL_WRITE_PROOF");
const concurrency = Number(process.env.CONCURRENCY ?? "128");
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 128) throw new Error("invalid concurrency");
const source = { endpoint: required("SOURCE_ENDPOINT"), region: required("SOURCE_REGION"),
  bucket: required("SOURCE_BUCKET"), pathStyle: false };
const destination = { endpoint: required("DESTINATION_ENDPOINT"), region: required("DESTINATION_REGION"),
  bucket: required("DESTINATION_BUCKET"), pathStyle: false };
const sourceCredentials = { accessKeyId: required("MIGRATION_SOURCE_ACCESS_KEY_ID"),
  secretAccessKey: required("MIGRATION_SOURCE_SECRET_ACCESS_KEY") };
const destinationCredentials = { accessKeyId: required("MIGRATION_DESTINATION_ACCESS_KEY_ID"),
  secretAccessKey: required("MIGRATION_DESTINATION_SECRET_ACCESS_KEY") };
const manifestBytes = readFileSync(manifestPath);
if (createHash("sha256").update(manifestBytes).digest("hex") !== manifestDigest) throw new Error("manifest digest differs");
const objects = manifestBytes.toString("utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
if (objects.length !== 59017 || objects.reduce((sum, item) => sum + item.size, 0) !== 12534514457 ||
  new Set(objects.map(({ key }) => key)).size !== objects.length || objects.some((item) =>
    typeof item.key !== "string" || !Number.isSafeInteger(item.size) || item.size < 0 ||
    !/^[0-9a-f]{64}$/.test(item.sha256) || item.metadata === null || typeof item.metadata !== "object" ||
    !Array.isArray(item.tags) || item.tags.some((tag) => typeof tag.Key !== "string" || typeof tag.Value !== "string"))) {
  throw new Error("canonical PROD corpus contract differs");
}
const proof = JSON.parse(readFileSync(proofPath, "utf8"));
const identity = createHash("sha256").update(destinationCredentials.accessKeyId).digest("hex");
const expiresAt = Date.parse(proof.expiresAt);
if (proof.schemaVersion !== 1 || Object.keys(destination).some((key) => proof.destination?.[key] !== destination[key]) ||
  proof.identityFingerprint !== identity || proof.capabilities?.ifNoneMatchCreate !== true ||
  proof.capabilities?.ifMatchUpdate !== true || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
  throw new Error("destination conditional-write proof is invalid");
}
const client = (coordinate, credentials) => new S3Client({ endpoint: coordinate.endpoint,
  region: coordinate.region, forcePathStyle: false, credentials, maxAttempts: 4,
  requestHandler: new NodeHttpHandler({ httpsAgent: new HttpsAgent({ keepAlive: true, maxSockets: concurrency }) }) });
const sourceClient = client(source, sourceCredentials);
const destinationClient = client(destination, destinationCredentials);
const allowSingleProofPrune = process.env.PRUNE_SINGLE_EXTRA_CONFIRM === "1";
const started = Date.now();
const results = [];
const atomicJson = (path, value) => {
  const tmp = `${path}.tmp`; writeFileSync(tmp, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  const fd = openSync(tmp, "r"); fsyncSync(fd); closeSync(fd); renameSync(tmp, path);
};
const digestBody = async (response, outputPath) => {
  const hash = createHash("sha256"); let bytes = 0; let output;
  if (outputPath) output = createWriteStream(outputPath, { flags: "wx", mode: 0o600 });
  try {
    for await (const chunk of response.Body) {
      bytes += chunk.length; hash.update(chunk);
      if (output && !output.write(chunk)) await once(output, "drain");
    }
    if (output) { output.end(); await once(output, "close"); }
  } catch (error) {
    output?.destroy(); if (outputPath) { try { unlinkSync(outputPath); } catch {} } throw error;
  }
  return { bytes, sha256: hash.digest("hex") };
};
const getDigest = async (clientInstance, bucket, key, outputPath) => {
  const response = await clientInstance.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const digest = await digestBody(response, outputPath);
  return { ...digest, contentLength: Number(response.ContentLength) };
};
const missing = (error) => error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404;
const tagging = (tags) => tags.map(({ Key, Value }) =>
  `${encodeURIComponent(Key)}=${encodeURIComponent(Value)}`).join("&");
const listDestination = async () => {
  const listed = []; let continuationToken;
  do {
    const page = await destinationClient.send(new ListObjectsV2Command({ Bucket: destination.bucket,
      MaxKeys: 1000, ContinuationToken: continuationToken }));
    for (const item of page.Contents ?? []) listed.push({ key: item.Key, size: item.Size, etag: item.ETag ?? "" });
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    if (page.IsTruncated && !continuationToken) throw new Error("truncated destination listing lacks a token");
  } while (continuationToken);
  return listed.sort((a, b) => Buffer.from(a.key).compare(Buffer.from(b.key)));
};
const targetDiff = (listed) => {
  const expected = new Map(objects.map((item) => [item.key, item.size]));
  const observed = new Map(listed.map((item) => [item.key, item.size]));
  return { missing: objects.filter((item) => !observed.has(item.key)).map(({ key, size }) => ({ key, size })),
    extra: listed.filter((item) => !expected.has(item.key)),
    sizeConflicts: listed.filter((item) => expected.has(item.key) && expected.get(item.key) !== item.size) };
};
const progress = () => {
  const elapsedSeconds = Math.max(1, (Date.now() - started) / 1000);
  const processed = results.length; const logicalBytes = results.reduce((sum, item) => sum + item.size, 0);
  atomicJson(`${reportDir}/progress.json`, { expected: 59017, processed,
    matching: results.filter(({ status }) => status === "matching").length,
    copied: results.filter(({ status }) => status === "copied").length,
    failed: results.filter(({ status }) => status === "failed").length, logicalBytes, elapsedSeconds,
    opsPerSecond: processed / elapsedSeconds, logicalMiBPerSecond: logicalBytes / 1048576 / elapsedSeconds,
    etaSeconds: processed ? Math.ceil((59017 - processed) / (processed / elapsedSeconds)) : null });
};
const copyOne = async (item, index) => {
  try {
    const observed = await getDigest(destinationClient, destination.bucket, item.key);
    return observed.bytes === item.size && observed.contentLength === item.size && observed.sha256 === item.sha256
      ? { status: "matching", key: item.key, size: item.size }
      : { status: "failed", reason: "destination-conflict", key: item.key, size: item.size };
  } catch (error) { if (!missing(error)) return { status: "failed", reason: "destination-read", key: item.key, size: item.size }; }
  const bodyPath = `/tmp/canonical-docs-${index}`;
  try {
    const sourceDigest = await getDigest(sourceClient, source.bucket, item.key, bodyPath);
    if (sourceDigest.bytes !== item.size || sourceDigest.contentLength !== item.size || sourceDigest.sha256 !== item.sha256) {
      return { status: "failed", reason: "canonical-source", key: item.key, size: item.size };
    }
    const response = await destinationClient.send(new PutObjectCommand({ Bucket: destination.bucket, Key: item.key,
      Body: createReadStream(bodyPath), ContentLength: item.size, IfNoneMatch: "*", ContentType: item.contentType ?? undefined,
      ContentEncoding: item.contentEncoding ?? undefined, CacheControl: item.cacheControl ?? undefined,
      ContentDisposition: item.contentDisposition ?? undefined, Metadata: item.metadata,
      Tagging: item.tags.length ? tagging(item.tags) : undefined }));
    const observed = await getDigest(destinationClient, destination.bucket, item.key);
    if (observed.bytes !== item.size || observed.sha256 !== item.sha256) {
      return { status: "failed", reason: "post-copy-read", key: item.key, size: item.size };
    }
    return { status: "copied", key: item.key, size: item.size, etag: response.ETag ?? "" };
  } catch (error) {
    return { status: "failed", reason: "conditional-copy", key: item.key, size: item.size };
  } finally { try { unlinkSync(bodyPath); } catch {} }
};
for (let offset = 0; offset < objects.length; offset += concurrency) {
  const batch = objects.slice(offset, offset + concurrency);
  results.push(...await Promise.all(batch.map((item, index) => copyOne(item, offset + index))));
  progress(); if (results.filter(({ status }) => status === "failed").length >= 20) break;
}
results.sort((a, b) => Buffer.from(a.key).compare(Buffer.from(b.key)));
atomicJson(`${reportDir}/copy-ledger.json`, results);
const summary = JSON.parse(readFileSync(`${reportDir}/progress.json`, "utf8"));
summary.schemaVersion = 1; summary.canonicalDigest = manifestDigest;
let listed = await listDestination(); let diff = targetDiff(listed); summary.prunedExtra = 0;
atomicJson(`${reportDir}/target-diff-before-prune.json`, diff);
if (summary.processed === 59017 && summary.failed === 0 && diff.missing.length === 0 &&
  diff.sizeConflicts.length === 0 && diff.extra.length === 1 && allowSingleProofPrune) {
  const extra = diff.extra[0];
  if (!extra.etag) throw new Error("single proof extra lacks an ETag");
  await destinationClient.send(new DeleteObjectCommand({ Bucket: destination.bucket, Key: extra.key, IfMatch: extra.etag }));
  summary.prunedExtra = 1; listed = await listDestination(); diff = targetDiff(listed);
}
atomicJson(`${reportDir}/target-diff.json`, diff);
summary.exactParity = diff.missing.length === 0 && diff.extra.length === 0 && diff.sizeConflicts.length === 0;
summary.complete = summary.processed === 59017 && summary.failed === 0 && summary.exactParity;
atomicJson(`${reportDir}/summary.json`, summary);
if (!summary.complete) throw new Error("canonical copy did not reach exact parity");
console.log(JSON.stringify({ status: "complete", ...summary }));
