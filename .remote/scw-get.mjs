/**
 * scw-get — telecharge le raw d'une ville depuis SCW vers un dossier local (pour graphify).
 * Usage (conteneur api, creds SCRAPE_S3_*):
 *   npx tsx /workspace/.remote/scw-get.mjs <slug> /out/<slug>
 * Ecrit les *.pdf/.html (pas les .meta.json) sous <outdir>/.
 */
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../api/src/config.js";
import { getScrapeObjectStore } from "../api/src/storage/s3-object-store.js";

const slug = process.argv[2];
const outdir = process.argv[3];
if (!slug || !outdir) { console.error("usage: scw-get.mjs <slug> <outdir>"); process.exit(2); }
fs.mkdirSync(outdir, { recursive: true });
const store = getScrapeObjectStore(loadConfig());
const prefix = `raw/proces-verbaux-${slug}/cas/`;
const keys = await store.list(prefix);
let n = 0;
for (const k of keys) {
  if (k.endsWith(".meta.json")) continue;
  const body = await store.get(k);
  const name = k.split("/").pop();
  fs.writeFileSync(path.join(outdir, name), Buffer.from(body));
  n++;
}
console.log(JSON.stringify({ slug, downloaded: n }));
