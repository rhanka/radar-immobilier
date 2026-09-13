import { Buffer } from "node:buffer";

const sameRecord = (left, right) => {
  const entries = (value) => Object.entries(value ?? {}).sort(([a], [b]) =>
    Buffer.from(a).compare(Buffer.from(b)));
  return JSON.stringify(entries(left)) === JSON.stringify(entries(right));
};
const sameTags = (left, right) => {
  const sorted = (value) => [...(value ?? [])].sort((a, b) =>
    Buffer.from(`${a.Key}\0${a.Value}`).compare(Buffer.from(`${b.Key}\0${b.Value}`)));
  return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
};

export const readObjectRecord = async ({ client, bucket, key, GetObjectCommand,
  GetObjectTaggingCommand, digestBody, outputPath }) => {
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const digest = await digestBody(response, outputPath);
  const tagged = await client.send(new GetObjectTaggingCommand({ Bucket: bucket, Key: key }));
  return { ...digest, contentLength: Number(response.ContentLength), contentType: response.ContentType ?? null,
    contentEncoding: response.ContentEncoding ?? null, cacheControl: response.CacheControl ?? null,
    contentDisposition: response.ContentDisposition ?? null, metadata: response.Metadata ?? {},
    tags: tagged.TagSet ?? [], etag: response.ETag ?? "", versionId: response.VersionId ?? null };
};

export const sameDestinationRecord = (item, observed) => observed.bytes === item.size &&
  observed.contentLength === item.size && observed.sha256 === item.sha256 &&
  observed.contentType === (item.contentType ?? null) &&
  observed.contentEncoding === (item.contentEncoding ?? null) &&
  observed.cacheControl === (item.cacheControl ?? null) &&
  observed.contentDisposition === (item.contentDisposition ?? null) &&
  sameRecord(observed.metadata, item.metadata) && sameTags(observed.tags, item.tags);
