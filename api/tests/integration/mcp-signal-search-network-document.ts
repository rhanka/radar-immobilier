import { randomUUID } from "node:crypto";
import { S3Client } from "@aws-sdk/client-s3";
import { buildRawDocumentRecord, rawMetaKey } from "@radar/sources";
import { S3ObjectStore } from "../../src/storage/s3-object-store.js";

/** Genuine S3 transport to the isolated synthetic bucket, including in the image. */
export async function networkDocumentStore() {
  const endpoint = process.env.S3_ENDPOINT;
  if (!endpoint) throw new Error("Synthetic document storage endpoint required");
  const client = new S3Client({ endpoint, region: "us-east-1", forcePathStyle: true,
    credentials: { accessKeyId: "synthetic", secretAccessKey: "synthetic" } });
  const store = new S3ObjectStore(client, "radar-immobilier-docs");
  try { await store.ensureBucket(); } catch (error) { client.destroy(); throw error; }
  const seed = async () => {
    const body = `%PDF-1.4 synthetic network evidence ${randomUUID()}`;
    const record = buildRawDocumentRecord({ source: "synthetic-network-documents",
      sourceUrl: "https://municipality.example.test/minutes/2026-09-22.pdf",
      title: "Synthetic council minutes", publishedAt: "2026-09-22",
      body: new TextEncoder().encode(body), fetchedAt: "2026-10-01T10:00:00.000Z",
      contentType: "application/pdf", provenance: { version: "1.0.0", userAgent: "radar/test", viaObscura: false } });
    await store.put(record.storageKey, body, "application/pdf");
    await store.put(rawMetaKey(record.storageKey), JSON.stringify(record), "application/json");
    return record;
  };
  return { store, seed, close: () => client.destroy() };
}
