/**
 * scw-purge — supprime toutes les cles sous un prefixe du store SCW. DESTRUCTIF.
 * Usage (conteneur api, creds SCRAPE_S3_*):
 *   npx tsx /workspace/.remote/scw-purge.mjs raw/proces-verbaux-<slug>/
 */
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { loadConfig } from "../api/src/config.js";
import { getScrapeObjectStore } from "../api/src/storage/s3-object-store.js";

const prefix = process.argv[2];
if (!prefix || prefix === "raw/" || prefix === "graph/" || prefix === "parsed/" || prefix.length < 6) {
  console.error("refus: prefixe trop large ou manquant:", prefix); process.exit(2);
}
const store = getScrapeObjectStore(loadConfig());
const keys = await store.list(prefix);
let n = 0;
for (const key of keys) {
  await store.client.send(new DeleteObjectCommand({ Bucket: store.bucket, Key: key }));
  n++;
}
console.log(JSON.stringify({ prefix, deleted: n }));
