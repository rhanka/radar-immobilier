// READ-ONLY drift measurement, run inside a radar-api pod (stdin, `node --input-type=module -`).
// S3: ListObjectsV2 + GetObject only. PG: SELECT only, session default_transaction_read_only=on.
// Same rules as the 2026-10-04 prod diagnostic (full.mjs + sim.js + contam2.js + group.js),
// applied to EVERY graph/<city>/latest.json; ABORT/HALT is not known here, so G2+G4 and
// G5a+G5b are reported together (state-based grouping).
import { createRequire } from "node:module";
const require = createRequire("/workspace/api/package.json");
const { S3Client, GetObjectCommand, ListObjectsV2Command } = require("@aws-sdk/client-s3");
const pg = require("pg");
const E = process.env;
const s3 = new S3Client({ region: E.SCRAPE_S3_REGION ?? E.S3_REGION, endpoint: E.SCRAPE_S3_ENDPOINT ?? E.S3_ENDPOINT,
  forcePathStyle: (E.SCRAPE_S3_FORCE_PATH_STYLE ?? E.S3_FORCE_PATH_STYLE) === "true",
  credentials: { accessKeyId: E.SCRAPE_S3_ACCESS_KEY ?? E.S3_ACCESS_KEY, secretAccessKey: E.SCRAPE_S3_SECRET_KEY ?? E.S3_SECRET_KEY } });
const Bucket = E.SCRAPE_S3_BUCKET;
const pool = new pg.Pool({ host: E.POSTGRES_HOST, port: +E.POSTGRES_PORT, user: E.POSTGRES_USER, password: E.POSTGRES_PASSWORD,
  database: E.POSTGRES_DB, max: 4, options: "-c default_transaction_read_only=on" });
const ro = (await pool.query("show default_transaction_read_only")).rows[0].default_transaction_read_only;
if (ro !== "on") throw Error("not read-only");

const keys = [];
let token;
do {
  const r = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: "graph/", ContinuationToken: token }));
  for (const o of r.Contents ?? []) if (/^graph\/[^/]+\/latest\.json$/.test(o.Key)) keys.push(o.Key);
  token = r.IsTruncated ? r.NextContinuationToken : undefined;
} while (token);
const cities = keys.map((k) => k.split("/")[1]);

// PG: a light index (id -> city) once; full rows city by city (memory stays small: shared api pod).
const pgCityById = new Map((await pool.query("select id, city_slug from graph_nodes")).rows.map((r) => [r.id, r.city_slug]));
const nullCity = [...pgCityById.values()].filter((c) => c === null).length;
const pgById = { get: (id) => (pgCityById.has(id) ? { city_slug: pgCityById.get(id) } : undefined), has: (id) => pgCityById.has(id) };

// ---- sim.js / contam2.js rules (identical) ----
const CIT = ["excerpt", "citation", "quote", "text"], RAW = ["rawRef", "raw_ref", "rawObjectKey", "raw_object_key", "file", "ref", "sourceRef", "source_ref", "path", "s3Key", "s3_key"];
const ne = (r, ks) => ks.some((k) => typeof r[k] === "string" && r[k].trim().length > 0);
const prov = (r) => r.provisional === true || r.provisional === "true" || String(r.linkSource ?? r.link_source ?? "").trim() === "radar-auto-link";
function complete(p) { if (Array.isArray(p.refs)) for (const r of p.refs) { if (!r || typeof r !== "object" || Array.isArray(r)) continue; if (prov(r)) continue; if (ne(r, CIT) && ne(r, RAW)) return true; } if (prov(p)) return false; return ne(p, CIT) && ne(p, RAW); }
const SIG = new Set(["Signal", "DesignationEvent"]);
const DS = new Set(["effet_densifiant", "etape", "instrument"]), DV = new Set(["", "autre", "inconnu"]);
const bp = (p) => p && typeof p.properties === "object" && p.properties && !Array.isArray(p.properties) ? p.properties : {};
function has(pr, k) { if (!pr || !Object.prototype.hasOwnProperty.call(pr, k)) return false; const v = pr[k]; if (v == null) return false; if (!DS.has(k)) return true; if (typeof v !== "string") return true; return !DV.has(v.trim().toLowerCase()); }
const shaInfo = (p) => { const o = []; for (const r of (Array.isArray(p?.refs) ? p.refs : [])) { if (!r || typeof r !== "object" || Array.isArray(r)) continue; const raw = typeof r.rawRef === "string" ? r.rawRef : ""; if (raw.startsWith("generated://")) continue; const s = (typeof r.docSha === "string" && r.docSha) || (raw.match(/\/cas\/([^/]+)\.[^/.]+$/) || [])[1]; if (s) o.push({ s, raw }); } return o; };
function row(n) { const p = {}; for (const k of ["community", "community_name", "source_file", "status", "description", "refs"]) if (n[k] !== undefined) p[k] = n[k]; if (n.properties !== undefined) { const pr = n.properties || {}; p.properties = (pr.etape != null || pr.statut != null) ? { ...pr, regulatoryStatus: "derived" } : n.properties; } return { id: n.id, type: n.file_type ?? n.type ?? "concept", props: p }; }
function merge(rows) { const m = new Map(); for (const r of rows) { const c = m.get(r.id); if (!c) { m.set(r.id, r); continue; } const refs = [...(c.props.refs || []), ...(r.props.refs || [])]; const seen = new Set(); const mr = refs.filter((x) => { const k = JSON.stringify(x); if (seen.has(k)) return false; seen.add(k); return true; }); m.set(r.id, { ...c, ...r, props: { ...c.props, ...r.props, ...(refs.length ? { refs: mr } : {}) } }); } return [...m.values()]; }

const getNodes = async (city) => JSON.parse(await (await s3.send(new GetObjectCommand({ Bucket, Key: `graph/${city}/latest.json` }))).Body.transformToString()).nodes ?? [];
const pool4 = async (list, fn) => { const q = [...list]; await Promise.all(Array.from({ length: 4 }, async () => { while (q.length) await fn(q.shift()); })); };
// Pass 1: S3 ids per city (ids only) and S3 cleanliness.
const s3owners = new Map(); let s3Foreign = 0; const s3ForeignCities = new Set();
await pool4(cities, async (city) => {
  for (const n of await getNodes(city)) {
    (s3owners.get(n.id) ?? s3owners.set(n.id, new Set()).get(n.id)).add(city);
    const c2 = new Set(shaInfo(n).map((x) => (x.raw.match(/proces-verbaux-([^/]+)\//) || [])[1]).filter(Boolean));
    if ([...c2].some((c) => c !== city)) { s3Foreign++; s3ForeignCities.add(city); }
  }
});
const foreignByCity = {};

const drift = {}; const groups = {};
await pool4(cities, async (city) => {
  const s3n = await getNodes(city);
  const before = (await pool.query("select id, type, city_slug, props from graph_nodes where city_slug = $1", [city])).rows;
  for (const r of before) {
    const c2 = new Set(shaInfo(r.props || {}).map((x) => (x.raw.match(/proces-verbaux-([^/]+)\//) || [])[1]).filter(Boolean));
    if ([...c2].some((c) => c !== city)) (foreignByCity[city] ??= []).push(r.id);
  }
  const pgIds = new Set(before.map((r) => r.id)), s3Ids = new Set(s3n.map((n) => n.id));
  const onlyS3 = [...s3Ids].filter((id) => !pgIds.has(id)), onlyPG = [...pgIds].filter((id) => !s3Ids.has(id));
  if (!onlyS3.length && !onlyPG.length) return;
  const after = merge(s3n.map(row)); const afterById = new Map(after.map((r) => [r.id, r]));
  let g1 = 0, g3 = 0;
  for (const b of before) {
    const bpB = bp(b.props), bpA = bp(afterById.get(b.id)?.props ?? {});
    if (Object.keys(bpB).some((k) => has(bpB, k) && !has(bpA, k))) g1++;
    const bs = new Set(shaInfo(b.props || {}).map((x) => x.s)); if (bs.size) { const as = new Set(shaInfo(afterById.get(b.id)?.props ?? {}).map((x) => x.s)); if ([...bs].some((s) => !as.has(s))) g3++; }
  }
  const cb = before.filter((r) => SIG.has(r.type) && complete(r.props || {})).length;
  const ca = after.filter((r) => SIG.has(r.type) && !(pgById.get(r.id) && pgById.get(r.id).city_slug !== city) && complete(r.props)).length;
  const owned = onlyS3.filter((id) => pgById.has(id)).length;
  const verdict = g1 ? "gate1-business-property" : g3 ? "gate3-source-ref" : ca < cb ? "gate2-completeness" : "pass";
  // contam2: regressions whose missing docSha comes from another city's PV, or whose id is in another city's S3
  let foreignRegs = 0, regs = 0;
  if (verdict === "gate1-business-property" || verdict === "gate3-source-ref") {
    const s3ById = new Map(s3n.map((n) => [n.id, n]));
    for (const r of before) {
      const n = s3ById.get(r.id), a = n || {}; const ap = { ...(a.properties || {}) }; if (ap.etape != null || ap.statut != null) ap.regulatoryStatus = "d";
      const bpp = (r.props || {}).properties || {}; const missK = Object.keys(bpp).filter((k) => has(bpp, k) && !has(ap, k));
      const bs = shaInfo(r.props || {}); const as = new Set(shaInfo(a).map((x) => x.s)); const miss = bs.filter((x) => !as.has(x.s));
      if (!missK.length && !miss.length) continue; regs++;
      const rawCities = [...new Set(miss.map((x) => (x.raw.match(/proces-verbaux-([^/]+)\//) || [])[1] || "?"))];
      const otherS3 = [...(s3owners.get(r.id) || [])].filter((x) => x !== city);
      if (rawCities.some((x) => x !== city && x !== "?") || otherS3.length) foreignRegs++;
    }
  }
  const cls = regs && foreignRegs === regs ? "all-foreign" : foreignRegs ? "mixed" : "local";
  const dir = onlyS3.length && onlyPG.length ? "both" : onlyS3.length ? "S3>PG" : "PG>S3";
  const pgOnlyTypes = [...new Set(before.filter((r) => !s3Ids.has(r.id)).map((r) => r.type))];
  let group;
  if (dir === "both") group = "G6-both";
  else if (dir === "PG>S3") group = pgOnlyTypes.every((t) => t === "source" || t === "designationevent") ? "G1-PG-ontology" : "G1x-PG-ahead-other";
  else if (verdict === "pass") group = "G3-S3-collision-only";
  else if (verdict === "gate2-completeness") group = "G5ab-completeness";
  else if (cls === "all-foreign") group = "G2G4-collision-refused";
  else group = "G5c-local-ref-loss";
  (groups[group] ??= []).push(city);
  drift[city] = { group, s3: s3n.length, pg: before.length, onlyS3: onlyS3.length, onlyPG: onlyPG.length, verdict, cb, ca, owned, cls, foreignRegs, pgOnlyTypes };
});
await pool.end();

const sharedIds = [...s3owners.values()].filter((s) => s.size > 1).length;
process.stdout.write(JSON.stringify({
  bucket: Bucket, readOnly: ro, measuredAt: new Date().toISOString(), cities: cities.length, pgNodes: pgCityById.size, pgNullCity: nullCity,
  drift: Object.keys(drift).length, groups: Object.fromEntries(Object.entries(groups).map(([g, l]) => [g, l.length])),
  pgOnlyNodesG1: (groups["G1-PG-ontology"] ?? []).reduce((a, c) => a + drift[c].onlyPG, 0),
  s3OnlyNodes: Object.values(drift).reduce((a, d) => a + d.onlyS3, 0),
  foreignPg: { nodes: Object.values(foreignByCity).reduce((a, l) => a + l.length, 0), cities: Object.keys(foreignByCity).length },
  foreignS3: { nodes: s3Foreign, cities: s3ForeignCities.size }, idsSharedAcrossCitiesInS3: sharedIds,
  foreignRegressions: { nodes: Object.values(drift).reduce((a, d) => a + d.foreignRegs, 0), cities: Object.values(drift).filter((d) => d.foreignRegs).length },
  groupLists: groups, perCity: drift,
}));
