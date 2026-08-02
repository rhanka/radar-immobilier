/** Emit read-only Graphify 3.4 Phase A candidates from the local projection. */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { setDefaultResultOrder } from "node:dns";
import { loadConfig, resolveGraphS3Config } from "../config.js";
import { createDb } from "../db/client.js";
import { createScrapeS3Client, S3ObjectStore } from "../storage/s3-object-store.js";
import { subgraphForCity } from "../services/graph/graph-store.js";
import { enrichGraphify34Snapshot } from "../services/graph/graphify-34-enrichment.js";
import { snapshotFromExistingCity } from "../services/graph/graphify-34-snapshot.js";
import type { Graphify34EnrichmentStats, Graphify34FieldStats } from "../services/graph/graphify-34-enrichment.js";
setDefaultResultOrder("ipv4first");
const DEFAULT_TSV = "docs/spec/reports/set-167-bprime.tsv";
const DEFAULT_OUT_DIR = "scratch/graphify34-candidates";
type Options = { tsv: string; outDir: string; limit: number | null; preenrich: boolean; s3Prefix: string | null };
type Set167Row = { graphCitySlug: string };
type FieldName = keyof Graphify34EnrichmentStats["fields"];
type FieldAggregate = Graphify34FieldStats;
type FieldAggregates = Record<FieldName, FieldAggregate>;
type AggregateStats = {
  requested: number; emitted: number; fields: FieldAggregates;
  etape_added: number; instrument_added: number; effet_densifiant_added: number;
  aborts: number; empty_cities: string[]; aborted_cities: { city: string; reason: string }[];
};
function parseArgs(argv: string[]): Options {
  const options: Options = { tsv: DEFAULT_TSV, outDir: DEFAULT_OUT_DIR, limit: null, preenrich: false, s3Prefix: null };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--tsv") {
      options.tsv = argv[++index] ?? "";
    } else if (arg === "--out-dir") {
      options.outDir = argv[++index] ?? "";
    } else if (arg === "--emit-preenrich") {
      options.preenrich = true;
    } else if (arg === "--s3-prefix") {
      options.s3Prefix = (argv[++index] ?? "").replace(/\/+$/, "");
    } else if (arg === "--limit") {
      const rawLimit = argv[++index] ?? "";
      const limit = Number(rawLimit);
      if (!Number.isInteger(limit) || limit < 1) {
        throw new Error(`--limit must be a positive integer, received: ${rawLimit}`);
      }
      options.limit = limit;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (options.tsv.trim() === "") throw new Error("--tsv requires a path");
  if (options.outDir.trim() === "") throw new Error("--out-dir requires a path");
  return options;
}
function readSet167Rows(tsv: string): Set167Row[] {
  const rows = tsv.split(/\r?\n/).flatMap((line, index): Set167Row[] => {
    if (line.trim() === "" || line.startsWith("#") || line.startsWith("slug\t")) return [];
    const columns = line.split("\t");
    if (columns.length < 5) throw new Error(`TSV line ${index + 1} has fewer than 5 columns`);
    if (columns[3]?.trim() !== "2.3") return [];
    const graphCitySlug = columns[4]?.trim() ?? "";
    if (graphCitySlug === "") throw new Error(`TSV line ${index + 1} has no graph_city_slug`);
    return [{ graphCitySlug }];
  });
  const seen = new Set<string>();
  for (const row of rows) if (seen.has(row.graphCitySlug)) {
    throw new Error(`duplicate graph_city_slug in v2.3 TSV rows: ${row.graphCitySlug}`);
  } else seen.add(row.graphCitySlug);
  return rows;
}
/**
 * Déroule une erreur (drizzle enveloppe le vrai pg.DatabaseError dans `.cause`,
 * son `.message` n'étant que « Failed query: <sql> ») et extrait tous les champs
 * postgres utiles au diagnostic (code, detail, schema, table, column, routine…).
 * Sans ça le rapport est AVEUGLE sur la vraie cause d'un abort (infra/cond 2026-08-02).
 */
function describeError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 5; depth++) {
    if (current instanceof Error) {
      parts.push(`${depth === 0 ? "" : "cause: "}${current.name}: ${current.message}`);
      const pg = current as unknown as Record<string, unknown>;
      for (const key of ["code", "detail", "hint", "severity", "schema", "table", "column", "dataType", "constraint", "routine", "position", "where"]) {
        const value = pg[key];
        if (typeof value === "string" && value !== "") parts.push(`${key}=${value}`);
      }
      current = (current as { cause?: unknown }).cause;
    } else {
      parts.push(`cause: ${String(current)}`);
      break;
    }
  }
  return parts.join(" | ");
}

function emptyFieldAggregate(): FieldAggregate {
  return { before_missing: 0, after_present: 0, added_or_canonicalized: 0 };
}
function emptyFields(): FieldAggregates {
  return {
    effet_densifiant: emptyFieldAggregate(),
    etape: emptyFieldAggregate(),
    instrument: emptyFieldAggregate(),
  };
}
function createAggregateStats(requested: number): AggregateStats {
  return {
    requested,
    emitted: 0,
    fields: emptyFields(),
    etape_added: 0,
    instrument_added: 0,
    effet_densifiant_added: 0,
    aborts: 0,
    empty_cities: [],
    aborted_cities: [],
  };
}
function addCityStats(aggregate: AggregateStats, stats: Graphify34EnrichmentStats): void {
  for (const field of ["effet_densifiant", "etape", "instrument"] as const) {
    const target = aggregate.fields[field];
    const source = stats.fields[field];
    target.before_missing += source.before_missing;
    target.after_present += source.after_present;
    target.added_or_canonicalized += source.added_or_canonicalized;
  }
  aggregate.etape_added += stats.fields.etape.added_or_canonicalized;
  aggregate.instrument_added += stats.fields.instrument.added_or_canonicalized;
  aggregate.effet_densifiant_added += stats.fields.effet_densifiant.added_or_canonicalized;
}
async function emitCity(db: Parameters<typeof subgraphForCity>[0], city: string, outDir: string, aggregate: AggregateStats, preenrich: boolean): Promise<void> {
  const existing = await subgraphForCity(db, city);
  if (existing.nodes.length === 0) {
    aggregate.empty_cities.push(city);
    return;
  }
  // base = projection PROD PG telle quelle (pré-enrichissement) ; snapshot = base + instrument/etape.
  // Émettre les deux permet à recette un diff bit-fidèle intra-cluster (enrichi vs pré-enrichi,
  // même instant/cluster), indépendant de toute baseline externe ou du cluster de recette.
  const base = snapshotFromExistingCity(existing);
  const { snapshot, stats } = enrichGraphify34Snapshot(base, city);
  addCityStats(aggregate, stats);
  const cityDir = resolve(outDir, city);
  await mkdir(cityDir, { recursive: true });
  await writeFile(resolve(cityDir, "latest.json"), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  if (preenrich) {
    const preDir = resolve(outDir, "preenrich", city);
    await mkdir(preDir, { recursive: true });
    await writeFile(resolve(preDir, "latest.json"), `${JSON.stringify(base, null, 2)}\n`, "utf8");
  }
  aggregate.emitted++;
}
async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const rows = readSet167Rows(await readFile(options.tsv, "utf8"));
  const selectedRows = options.limit === null ? rows : rows.slice(0, options.limit);
  const outDir = resolve(options.outDir);
  const aggregate = createAggregateStats(selectedRows.length);
  const config = loadConfig();
  // Confirme la cible DB réelle (host/port/db/user) — sans password. Écarte
  // définitivement l'hypothèse « mauvais postgres » en la rendant observable.
  process.stderr.write(
    `emit DB target: host=${config.POSTGRES_HOST} port=${config.POSTGRES_PORT} db=${config.POSTGRES_DB} user=${config.POSTGRES_USER}\n`,
  );
  const { db, pool } = createDb(config);
  try {
    await mkdir(outDir, { recursive: true });
    for (const { graphCitySlug: city } of selectedRows) {
      try { await emitCity(db, city, outDir, aggregate, options.preenrich); }
      catch (error: unknown) {
        aggregate.aborts++;
        const reason = describeError(error);
        aggregate.aborted_cities.push({ city, reason });
        // Log stderr immédiat des 3 premiers aborts : le rapport JSON final peut
        // être tronqué par `kubectl logs --tail`, mais ces lignes restent visibles
        // et portent la VRAIE cause pg (err.cause), pas juste « Failed query ».
        if (aggregate.aborts <= 3) process.stderr.write(`emit ABORT [${city}]: ${reason}\n`);
      }
    }
  } finally { await pool.end(); }
  // Sink S3 optionnel : le job K8s (fire-and-forget) n'a pas de CLI S3 ; on
  // uploade le dossier via S3ObjectStore.put (la garde ne refuse QUE
  // graph/<city>/latest.json ; le préfixe scratch/ est libre).
  let uploaded = 0;
  if (options.s3Prefix !== null) {
    const s3Config = resolveGraphS3Config(loadConfig());
    const store = new S3ObjectStore(createScrapeS3Client(s3Config), s3Config.bucket);
    for (const entry of await readdir(outDir, { recursive: true })) {
      if (!entry.endsWith("latest.json")) continue;
      const key = `${options.s3Prefix}/${entry.split(sep).join("/")}`;
      await store.put(key, await readFile(resolve(outDir, entry)), "application/json");
      uploaded++;
    }
    process.stderr.write(`emit-graphify34-candidates: ${uploaded} fichiers uploadés vers s3://${s3Config.bucket}/${options.s3Prefix}/\n`);
  }
  const missingOrAborted = [
    ...aggregate.empty_cities,
    ...aggregate.aborted_cities.map(({ city }) => city),
  ];
  const report = {
    tsv: resolve(options.tsv),
    outDir,
    s3Prefix: options.s3Prefix,
    uploaded,
    graphVersion: "2.3",
    aggregateStats: aggregate,
    missingOrAborted,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (missingOrAborted.length > 0) process.exitCode = 1;
}
main().catch((error: unknown) => {
  console.error(`emit-graphify34-candidates: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
