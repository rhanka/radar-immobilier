/**
 * scw-upload — pousse un arbre local vers SCW (bucket SCRAPE_S3_BUCKET=radar-immobilier-docs-pocs)
 * en miroir: <root>/<cle> -> s3://<bucket>/<cle>. Le seul writer S3 fiable ici (aws CLI casse).
 * Usage (dans le conteneur api, creds SCRAPE_S3_* via -e, root monte en -v):
 *   npx tsx /workspace/.remote/scw-upload.mjs /out
 */
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../api/src/config.js";
import { getScrapeObjectStore } from "../api/src/storage/s3-object-store.js";

const root = process.argv[2];
if (!root || !fs.existsSync(root)) { console.error("root introuvable:", root); process.exit(2); }
const store = getScrapeObjectStore(loadConfig());

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

let n = 0;
const keys = [];
for (const f of walk(root)) {
  const key = path.relative(root, f).split(path.sep).join("/");
  const body = fs.readFileSync(f);
  const ct = f.endsWith(".json") ? "application/json" : "application/octet-stream";
  await store.put(key, body, ct);
  n++;
  if (keys.length < 5) keys.push(key);
}
console.log(JSON.stringify({ uploaded: n, sample: keys }));
