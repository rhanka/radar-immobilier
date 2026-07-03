// liste les villes deja faites sous un prefixe (graph/<ville>/latest.json) -> 1 ville/ligne
import { loadConfig } from "../api/src/config.js";
import { getScrapeObjectStore } from "../api/src/storage/s3-object-store.js";
const prefix = process.argv[2] ?? "graph/";
const store = getScrapeObjectStore(loadConfig());
const keys = await store.list(prefix);
const villes = new Set();
for (const k of keys) {
  const m = k.replace(prefix, "").split("/")[0];
  if (m) villes.add(m);
}
console.log([...villes].sort().join("\n"));
