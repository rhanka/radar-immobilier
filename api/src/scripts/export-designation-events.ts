/**
 * export-designation-events — export READ-ONLY des DesignationEvents (et Signals)
 * du graphe pour un jeu de villes, en clé naturelle, pour le recall gate
 * qc-zoning-events de la lane jointures (WP5).
 *
 * Lit S3 graph/<city>/latest.json (aucune DB), extrait pour chaque nœud
 * DesignationEvent|Signal les champs de matching par clé naturelle :
 *   city_slug, node_type, kind/category, label, date, bylaw_numero, source_url,
 *   zone_ref, no_lot, docSha, page. Émet 1 ligne JSON par event (NDJSON).
 *
 * Usage :
 *   tsx --env-file=.env api/src/scripts/export-designation-events.ts \
 *     --cities saint-raymond,saint-stanislas,sutton,coaticook,saint-mathieu-de-beloeil,saint-eustache \
 *     --out export.ndjson
 */

import { writeFileSync } from "node:fs";
import { setDefaultResultOrder } from "node:dns";

setDefaultResultOrder("ipv4first");

type Dict = Record<string, unknown>;

function parseArgs(argv: string[]): { cities: string[]; out: string | null; types: string[] } {
  const out = { cities: [] as string[], out: null as string | null, types: ["DesignationEvent", "Signal"] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--cities") out.cities = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (argv[i] === "--out") out.out = argv[++i] ?? null;
    else if (argv[i] === "--types") out.types = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (out.cities.length === 0) throw new Error("--cities required (comma-separated graph_city_slug)");
  return out;
}

function rec(v: unknown): Dict {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Dict) : {};
}
function str(...vs: unknown[]): string | null {
  for (const v of vs) if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}
function numOrNull(...vs: unknown[]): number | null {
  for (const v of vs) { if (typeof v === "number" && Number.isFinite(v)) return v; }
  return null;
}

function s3() {
  const e = process.env;
  return {
    endpoint: e.GRAPH_S3_ENDPOINT ?? e.SCRAPE_S3_ENDPOINT ?? e.S3_ENDPOINT,
    bucket: e.GRAPH_S3_BUCKET ?? e.SCRAPE_S3_BUCKET ?? e.S3_BUCKET,
    region: e.GRAPH_S3_REGION ?? e.SCRAPE_S3_REGION ?? e.S3_REGION ?? "fr-par",
    accessKeyId: e.GRAPH_S3_ACCESS_KEY ?? e.SCRAPE_S3_ACCESS_KEY ?? e.S3_ACCESS_KEY,
    secretAccessKey: e.GRAPH_S3_SECRET_KEY ?? e.SCRAPE_S3_SECRET_KEY ?? e.S3_SECRET_KEY,
  };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const c = s3();
  if (!c.endpoint || !c.bucket || !c.accessKeyId || !c.secretAccessKey) throw new Error("S3 config incomplete");
  const client = new S3Client({ endpoint: c.endpoint, region: c.region, credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey }, forcePathStyle: true, maxAttempts: 10 });

  const lines: string[] = [];
  const perCity: Record<string, number> = {};
  const withZoneRef: Record<string, number> = {};
  for (const city of opts.cities) {
    let body: string | undefined;
    try {
      const res = await client.send(new GetObjectCommand({ Bucket: c.bucket, Key: `graph/${city}/latest.json` }));
      body = await res.Body?.transformToString();
    } catch (err) {
      process.stderr.write(`export: ${city} — GET échoué (${err instanceof Error ? err.message : String(err)})\n`);
      perCity[city] = -1; // absent
      continue;
    }
    if (!body) { perCity[city] = -1; continue; }
    const graph = rec(JSON.parse(body));
    const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    let n = 0, z = 0;
    for (const rawNode of nodes) {
      const node = rec(rawNode);
      if (!opts.types.includes(String(node.type))) continue;
      const p = rec(node.properties);
      const ref = Array.isArray(node.refs) ? rec(node.refs[0]) : {};
      const zone_ref = str(p.zone_ref);
      const row = {
        city_slug: str(p.city, city),
        node_type: str(node.type),
        node_id: str(node.id),
        kind: str(p.kind, p.category),
        label: str(node.label),
        date: str(p.date, p.etape_date, p.seance_date),
        etape: str(p.etape),
        bylaw_numero: str(p.reglement_number, p.bylaw_numero),
        source_url: str(ref.sourceUrl, p.sourceUrl, ref.rawRef),
        zone_ref,
        no_lot: str(p.no_lot),
        docSha: str(ref.docSha, p.docSha),
        page: numOrNull(ref.page, p.page),
      };
      lines.push(JSON.stringify(row));
      n++;
      if (zone_ref) z++;
    }
    perCity[city] = n;
    withZoneRef[city] = z;
  }

  const output = lines.join("\n") + (lines.length ? "\n" : "");
  if (opts.out) { writeFileSync(opts.out, output); process.stderr.write(`export: écrit ${lines.length} events → ${opts.out}\n`); }
  else process.stdout.write(output);
  process.stderr.write("export: par ville (events / dont zone_ref présent) :\n" + opts.cities.map((c2) => `  ${c2}: ${perCity[c2] === -1 ? "ABSENT S3" : `${perCity[c2]} / ${withZoneRef[c2] ?? 0}`}`).join("\n") + "\n");
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((err) => { console.error(`export-designation-events: ${err instanceof Error ? err.message : String(err)}`); process.exit(2); });
}
