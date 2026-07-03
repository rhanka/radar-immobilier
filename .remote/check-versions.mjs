/**
 * check-versions — pour une liste de slugs, imprime {slug, version} de graph/<slug>/latest.json sur SCW.
 * version = ontology_version, ou "MISSING" si absent, ou "ERR" si JSON illisible.
 * Usage (conteneur api, creds SCRAPE_S3_*):
 *   npx tsx /workspace/.remote/check-versions.mjs slugA slugB slugC ...
 */
import { loadConfig } from "../api/src/config.js";
import { getScrapeObjectStore } from "../api/src/storage/s3-object-store.js";

const slugs = process.argv.slice(2);
if (!slugs.length) { console.error("usage: check-versions.mjs <slug...>"); process.exit(2); }
const store = getScrapeObjectStore(loadConfig());
for (const slug of slugs) {
  const key = `graph/${slug}/latest.json`;
  try {
    const body = await store.get(key);
    if (!body) { console.log(JSON.stringify({ slug, version: "MISSING" })); continue; }
    let v = "ERR";
    try { v = JSON.parse(Buffer.from(body).toString("utf8")).ontology_version ?? "NONE"; } catch {}
    console.log(JSON.stringify({ slug, version: v }));
  } catch (e) {
    console.log(JSON.stringify({ slug, version: "MISSING" }));
  }
}
