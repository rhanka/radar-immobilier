/**
 * scrape-adhoc — RECUEIL de villes NON cablees dans ALL_PV_CITIES.
 * Construit une PvCityConfig inline {citySlug, pvIndexUrl, sourceId} et lance le
 * recueil officiel (adapter generique) -> raw/proces-verbaux-<slug>/cas/ sur SCW.
 * Usage (dans le conteneur api, creds SCRAPE_S3_* via -e, found.json monte en -v):
 *   LIVE_SCRAPE_LIMIT=6 npx tsx /workspace/.remote/scrape-adhoc.mts /in/found.json
 * found.json = [{ "slug": "...", "pvIndexUrl": "https://..." }, ...]
 */
import fs from "node:fs";
import { loadConfig } from "../api/src/config.js";
import { getScrapeObjectStore } from "../api/src/storage/s3-object-store.js";
import { ProcesVerbauxGenericAdapter } from "../packages/radar-sources/src/sources/proces-verbaux-generic.js";
import { runRecueilWithManifest } from "../api/src/services/sources/recueil.js";

const inPath = process.argv[2];
if (!inPath || !fs.existsSync(inPath)) { console.error("found.json introuvable:", inPath); process.exit(2); }
const cities = JSON.parse(fs.readFileSync(inPath, "utf8"));
const store = getScrapeObjectStore(loadConfig());
const limitEnv = process.env.LIVE_SCRAPE_LIMIT;
const limit = limitEnv ? Number.parseInt(limitEnv, 10) : 6;

for (const c of cities) {
  const slug = c.slug;
  const pvIndexUrl = c.pvIndexUrl;
  if (!slug || !pvIndexUrl || !/^https:/i.test(pvIndexUrl)) {
    console.log(JSON.stringify({ city: slug, status: "error", error: "missing/invalid pvIndexUrl" }));
    continue;
  }
  const config = { citySlug: slug, pvIndexUrl, sourceId: "proces-verbaux-" + slug };
  try {
    const adapter = new ProcesVerbauxGenericAdapter(config, {});
    const outcome = await runRecueilWithManifest(config.sourceId, adapter, store, { limit });
    if (!outcome.ok) {
      console.log(JSON.stringify({ city: slug, status: "error", error: `[${outcome.error}] ${outcome.detail}` }));
    } else {
      console.log(JSON.stringify({ city: slug, status: outcome.status ?? "ok", docs: outcome.count ?? (outcome.casKeys ? outcome.casKeys.length : 0) }));
    }
  } catch (e) {
    console.log(JSON.stringify({ city: slug, status: "error", error: String(e && e.message || e).slice(0, 200) }));
  }
}
