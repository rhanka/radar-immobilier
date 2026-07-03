/**
 * purge-pv-all — supprime TOUTES les cles sous pv/ (pollution de scw-get/upload, prefixe non-canonique).
 * + supprime la cle racine found.json si presente.
 * Usage (conteneur api, -w /workspace/api): npx tsx /workspace/.remote/purge-pv-all.mjs
 */
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { loadConfig } from "../api/src/config.js";
import { getScrapeObjectStore } from "../api/src/storage/s3-object-store.js";

const store = getScrapeObjectStore(loadConfig());
let n = 0;
for (const key of await store.list("pv/")) {
  await store.client.send(new DeleteObjectCommand({ Bucket: store.bucket, Key: key }));
  n++;
}
let f = 0;
for (const key of await store.list("found.json")) {
  await store.client.send(new DeleteObjectCommand({ Bucket: store.bucket, Key: key }));
  f++;
}
console.log(JSON.stringify({ pvDeleted: n, foundDeleted: f }));
