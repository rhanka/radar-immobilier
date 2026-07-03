/**
 * scrape-list — preuve store.list : liste les objets sous un prefixe du store SCW.
 * Usage (dans le conteneur api, creds SCRAPE_S3_* injectes):
 *   npx tsx /workspace/.remote/scrape-list.mts raw/proces-verbaux-<slug>/
 */
import { loadConfig } from "../api/src/config.js";
import { getScrapeObjectStore } from "../api/src/storage/s3-object-store.js";

const prefix = process.argv[2] ?? "raw/";
const store = getScrapeObjectStore(loadConfig());
const keys = await store.list(prefix);
console.log(JSON.stringify({ prefix, count: keys.length, sample: keys.slice(0, 8) }));
