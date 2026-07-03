import fs from "node:fs";
import { loadConfig } from "../api/src/config.js";
import { getScrapeObjectStore } from "../api/src/storage/s3-object-store.js";
const slug=process.argv[2];
const store=getScrapeObjectStore(loadConfig());
const body=await store.get(`graph/${slug}/latest.json`);
fs.writeFileSync(`/out/${slug}.json`, Buffer.from(body));
console.error("ok "+slug);
