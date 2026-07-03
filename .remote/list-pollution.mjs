/**
 * list-pollution — inventaire des cles SCW hors raw/graph/parsed (pollution) + pv/.
 * Usage (conteneur api, -w /workspace/api): npx tsx /workspace/.remote/list-pollution.mjs
 */
import { loadConfig } from "../api/src/config.js";
import { getScrapeObjectStore } from "../api/src/storage/s3-object-store.js";

const store = getScrapeObjectStore(loadConfig());
const pv = await store.list("pv/");
const pvVilles = new Set(pv.map((k) => k.split("/")[1]).filter(Boolean));
const root = await store.list("");
const stray = root.filter((k) => {
  const top = k.split("/")[0];
  return !["raw", "graph", "parsed", "pv"].includes(top);
});
console.log(JSON.stringify({
  pvKeys: pv.length,
  pvVilles: pvVilles.size,
  pvVillesList: [...pvVilles].sort(),
  strayKeys: stray.length,
  strayList: stray.slice(0, 50),
}, null, 1));
