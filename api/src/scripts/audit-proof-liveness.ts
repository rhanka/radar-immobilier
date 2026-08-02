/**
 * audit-proof-liveness — mesure l'état (vivant / mort / inconnu) des URL de
 * preuve documentaire (PV, PDF `sourceUrl`) portées par les nœuds du graphe.
 *
 * Read-only. NE modifie ni le graphe, ni la base, ni S3. Produit une mesure
 * honnête (chiffres réels) + un manifeste des URL mortes, en distinguant celles
 * qui sont **récupérables depuis l'archive S3** (nœud portant un `docSha`).
 *
 * Deux sources d'entrée, exclusives :
 *   --dir <path>   lit les snapshots locaux <path>/graph/<ville>/latest.json
 *                  (aucune dépendance externe — node builtins + fetch)
 *   (défaut)       lit les snapshots S3 graph/<ville>/latest.json via
 *                  @aws-sdk/client-s3 (SCRAPE_S3_* / GRAPH_S3_* dans l'env)
 *
 * Champs URL collectés par nœud : refs[].sourceUrl, refs[].rawRef,
 * refs[].documentUrl, properties.sourceUrl, properties.url_grille, source_ref.
 * L'archive S3 est indexée par `docSha` (refs[].docSha / properties.docSha) :
 * une URL morte dont le nœud porte un docSha est **archive-recoverable**.
 *
 * Usage :
 *   tsx api/src/scripts/audit-proof-liveness.ts --dir tmp/scw-upload-codex-r13a4
 *   tsx api/src/scripts/audit-proof-liveness.ts --out report.json --format json
 *
 * Options : --format markdown|json (déf. markdown) · --out <path> (déf. stdout)
 *   · --concurrency N (déf. 16) · --timeout ms (déf. 12000) · --retries N (déf. 2)
 *   · --limit N (borne le nombre d'URL sondées — pilote) · --city <slug>
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setDefaultResultOrder } from "node:dns";

// happy-eyeballs : privilégier IPv4 (évite les ETIMEDOUT IPv6 fréquents sur SCW).
setDefaultResultOrder("ipv4first");

type Dict = Record<string, unknown>;
type Format = "markdown" | "json";

interface Options {
  dir: string | null;
  format: Format;
  out: string | null;
  concurrency: number;
  timeout: number;
  retries: number;
  limit: number | null;
  city: string | null;
}

/** Une URL de preuve distincte + provenance agrégée. */
interface ProofUrl {
  url: string;
  cities: Set<string>;
  fields: Set<string>;
  docShas: Set<string>; // archive S3 disponible si non vide
}

type Verdict = "alive" | "dead" | "unknown";

interface Probe {
  url: string;
  verdict: Verdict;
  status: number | null;
  method: string; // HEAD | GET | -
  error: string | null;
  cities: string[];
  fields: string[];
  archiveRecoverable: boolean;
  docShas: string[];
}

function parseArgs(argv: string[]): Options {
  const out: Options = {
    dir: null,
    format: "markdown",
    out: null,
    concurrency: 16,
    timeout: 12_000,
    retries: 2,
    limit: null,
    city: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]!;
    const next = () => {
      const n = argv[++i];
      if (n === undefined) throw new Error(`Missing value for ${v}`);
      return n;
    };
    switch (v) {
      case "--dir": out.dir = next(); break;
      case "--format": {
        const f = next();
        if (f !== "markdown" && f !== "json") throw new Error("--format must be markdown|json");
        out.format = f;
        break;
      }
      case "--out": out.out = next(); break;
      case "--concurrency": out.concurrency = Number(next()); break;
      case "--timeout": out.timeout = Number(next()); break;
      case "--retries": out.retries = Number(next()); break;
      case "--limit": out.limit = Number(next()); break;
      case "--city": out.city = next(); break;
      default: throw new Error(`Unknown argument: ${v}`);
    }
  }
  if (!Number.isInteger(out.concurrency) || out.concurrency <= 0) throw new Error("--concurrency must be a positive integer");
  if (!Number.isFinite(out.timeout) || out.timeout <= 0) throw new Error("--timeout must be > 0");
  if (!Number.isInteger(out.retries) || out.retries < 0) throw new Error("--retries must be >= 0");
  if (out.limit !== null && (!Number.isInteger(out.limit) || out.limit <= 0)) throw new Error("--limit must be a positive integer");
  return out;
}

function asRecord(v: unknown): Dict {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Dict) : {};
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

/** Extrait toutes les (url, field, docSha) d'un nœud graphify. */
export function collectFromNode(node: Dict): Array<{ url: string; field: string; docSha: string | null }> {
  const found: Array<{ url: string; field: string; docSha: string | null }> = [];
  const props = asRecord(node.properties);
  const refs = Array.isArray(node.refs) ? node.refs : [];

  const push = (url: string | null, field: string, docSha: string | null) => {
    if (url && /^https?:\/\//i.test(url)) found.push({ url, field, docSha });
  };

  for (const rawRef of refs) {
    const ref = asRecord(rawRef);
    const docSha = asString(ref.docSha) ?? asString(props.docSha);
    push(asString(ref.sourceUrl), "refs.sourceUrl", docSha);
    push(asString(ref.rawRef), "refs.rawRef", docSha);
    push(asString(ref.documentUrl), "refs.documentUrl", docSha);
  }
  const propDocSha = asString(props.docSha);
  push(asString(props.sourceUrl), "properties.sourceUrl", propDocSha);
  push(asString(props.url_grille), "properties.url_grille", propDocSha);
  push(asString(node.source_ref), "source_ref", propDocSha);
  return found;
}

/** Agrège toutes les URL de preuve d'un graphe de ville dans la map partagée. */
export function collectFromGraph(citySlug: string, graph: Dict, map: Map<string, ProofUrl>): void {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  for (const rawNode of nodes) {
    const node = asRecord(rawNode);
    for (const { url, field, docSha } of collectFromNode(node)) {
      let entry = map.get(url);
      if (!entry) {
        entry = { url, cities: new Set(), fields: new Set(), docShas: new Set() };
        map.set(url, entry);
      }
      entry.cities.add(citySlug);
      entry.fields.add(field);
      if (docSha) entry.docShas.add(docSha);
    }
  }
}

function readLocalGraphs(dir: string, cityFilter: string | null): Map<string, ProofUrl> {
  const graphRoot = join(dir, "graph");
  const map = new Map<string, ProofUrl>();
  let cities: string[];
  try {
    cities = readdirSync(graphRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch (err) {
    throw new Error(`cannot list ${graphRoot}: ${err instanceof Error ? err.message : String(err)}`);
  }
  for (const city of cities) {
    if (cityFilter && city !== cityFilter) continue;
    const file = join(graphRoot, city, "latest.json");
    let graph: Dict;
    try {
      graph = JSON.parse(readFileSync(file, "utf8")) as Dict;
    } catch {
      continue; // fichier absent/illisible : ignoré (comme la projection)
    }
    collectFromGraph(city, graph, map);
  }
  return map;
}

async function readS3Graphs(cityFilter: string | null): Promise<Map<string, ProofUrl>> {
  // Import paresseux : le mode --dir ne dépend jamais de @aws-sdk.
  const { S3Client, ListObjectsV2Command, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const endpoint = process.env.GRAPH_S3_ENDPOINT ?? process.env.SCRAPE_S3_ENDPOINT ?? process.env.S3_ENDPOINT;
  const bucket = process.env.GRAPH_S3_BUCKET ?? process.env.SCRAPE_S3_BUCKET ?? process.env.S3_BUCKET;
  const region = process.env.GRAPH_S3_REGION ?? process.env.SCRAPE_S3_REGION ?? process.env.S3_REGION ?? "fr-par";
  const accessKeyId = process.env.GRAPH_S3_ACCESS_KEY ?? process.env.SCRAPE_S3_ACCESS_KEY ?? process.env.S3_ACCESS_KEY;
  const secretAccessKey = process.env.GRAPH_S3_SECRET_KEY ?? process.env.SCRAPE_S3_SECRET_KEY ?? process.env.S3_SECRET_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("S3 config incomplete (need *_S3_ENDPOINT/BUCKET/ACCESS_KEY/SECRET_KEY). Use --dir for local snapshots.");
  }
  const client = new S3Client({ endpoint, region, credentials: { accessKeyId, secretAccessKey }, forcePathStyle: true, maxAttempts: 10 });
  const map = new Map<string, ProofUrl>();
  let token: string | undefined;
  const keys: string[] = [];
  do {
    const res = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: "graph/", ContinuationToken: token }));
    for (const obj of res.Contents ?? []) if (obj.Key?.endsWith("/latest.json")) keys.push(obj.Key);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  for (const key of keys) {
    const city = key.split("/")[1] ?? key;
    if (cityFilter && city !== cityFilter) continue;
    try {
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const body = await res.Body?.transformToString();
      if (!body) continue;
      collectFromGraph(city, JSON.parse(body) as Dict, map);
    } catch {
      continue;
    }
  }
  return map;
}

/** Sonde une URL : HEAD, repli GET Range si HEAD est refusé (403/405/501). */
async function probeUrl(url: string, timeout: number, retries: number): Promise<{ verdict: Verdict; status: number | null; method: string; error: string | null }> {
  let lastError: string | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const head = await fetchWithTimeout(url, "HEAD", timeout, {});
      if (head.status === 403 || head.status === 405 || head.status === 501) {
        const get = await fetchWithTimeout(url, "GET", timeout, { Range: "bytes=0-0" });
        return { verdict: classify(get.status), status: get.status, method: "GET", error: null };
      }
      return { verdict: classify(head.status), status: head.status, method: "HEAD", error: null };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < retries) await sleep(300 * (attempt + 1));
    }
  }
  return { verdict: "unknown", status: null, method: "-", error: lastError };
}

async function fetchWithTimeout(url: string, method: string, timeout: number, headers: Record<string, string>): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { method, redirect: "follow", signal: controller.signal, headers: { "user-agent": "radar-immobilier-proof-audit/1.0", ...headers } });
  } finally {
    clearTimeout(timer);
  }
}

function classify(status: number): Verdict {
  if (status >= 200 && status < 400) return "alive";
  if (status >= 400 && status < 600) return "dead";
  return "unknown";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exécute `worker` sur `items` avec au plus `concurrency` en vol. */
async function mapPool<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]!, i);
    }
  }
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => run());
  await Promise.all(runners);
  return results;
}

function summarize(probes: Probe[]) {
  const total = probes.length;
  const dead = probes.filter((p) => p.verdict === "dead");
  const alive = probes.filter((p) => p.verdict === "alive");
  const unknown = probes.filter((p) => p.verdict === "unknown");
  const recoverable = dead.filter((p) => p.archiveRecoverable);
  const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 1000) / 10);

  const byCity = new Map<string, { total: number; dead: number; unknown: number }>();
  for (const p of probes) {
    for (const c of p.cities) {
      const e = byCity.get(c) ?? { total: 0, dead: 0, unknown: 0 };
      e.total++;
      if (p.verdict === "dead") e.dead++;
      if (p.verdict === "unknown") e.unknown++;
      byCity.set(c, e);
    }
  }
  return {
    total,
    alive: alive.length,
    dead: dead.length,
    unknown: unknown.length,
    alivePct: pct(alive.length),
    deadPct: pct(dead.length),
    unknownPct: pct(unknown.length),
    archiveRecoverableDead: recoverable.length,
    archiveRecoverablePctOfDead: dead.length === 0 ? 0 : Math.round((recoverable.length / dead.length) * 1000) / 10,
    cities: byCity.size,
    byCity: [...byCity.entries()].map(([city, e]) => ({ city, ...e, deadPct: e.total === 0 ? 0 : Math.round((e.dead / e.total) * 1000) / 10 })).sort((a, b) => b.deadPct - a.deadPct || b.total - a.total),
  };
}

function renderMarkdown(summary: ReturnType<typeof summarize>, deadProbes: Probe[], generatedAt: string, source: string): string {
  const L: string[] = [];
  L.push("# Audit — état des URL de preuve documentaire", "");
  L.push(`Généré : ${generatedAt}`, `Source : ${source}`, "");
  L.push("## Mesure globale", "");
  L.push(`- URL de preuve distinctes sondées : **${summary.total}** (${summary.cities} villes)`);
  L.push(`- Vivantes : **${summary.alive}** (${summary.alivePct} %)`);
  L.push(`- Mortes : **${summary.dead}** (${summary.deadPct} %)`);
  L.push(`- Inconnues (timeout/réseau) : **${summary.unknown}** (${summary.unknownPct} %)`);
  L.push(`- Mortes **récupérables depuis l'archive S3** (docSha présent) : **${summary.archiveRecoverableDead}** / ${summary.dead} (${summary.archiveRecoverablePctOfDead} % des mortes)`);
  L.push("");
  L.push("## Pire état par ville (deadPct décroissant, top 25)", "");
  L.push("| Ville | URL | Mortes | % mortes | Inconnues |", "|---|---:|---:|---:|---:|");
  for (const c of summary.byCity.slice(0, 25)) L.push(`| ${c.city} | ${c.total} | ${c.dead} | ${c.deadPct} | ${c.unknown} |`);
  L.push("");
  L.push("## Manifeste des URL mortes", "");
  L.push("| # | Villes | Champ | Statut | Archive | URL |", "|---:|---|---|---:|:---:|---|");
  deadProbes.forEach((p, i) => {
    L.push(`| ${i + 1} | ${p.cities.join(", ")} | ${p.fields.join(", ")} | ${p.status ?? "-"} | ${p.archiveRecoverable ? "oui" : "non"} | ${p.url} |`);
  });
  L.push("");
  return L.join("\n") + "\n";
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const generatedAt = new Date().toISOString();
  const source = options.dir ? `local:${options.dir}/graph/*` : "s3:graph/*";

  const urlMap = options.dir ? readLocalGraphs(options.dir, options.city) : await readS3Graphs(options.city);
  let proofs = [...urlMap.values()];
  proofs.sort((a, b) => a.url.localeCompare(b.url)); // déterminisme
  if (options.limit !== null) proofs = proofs.slice(0, options.limit);

  process.stderr.write(`audit-proof-liveness: ${proofs.length} URL distinctes à sonder (concurrency=${options.concurrency}, timeout=${options.timeout}ms)\n`);

  const probes: Probe[] = await mapPool(proofs, options.concurrency, async (p) => {
    const r = await probeUrl(p.url, options.timeout, options.retries);
    return {
      url: p.url,
      verdict: r.verdict,
      status: r.status,
      method: r.method,
      error: r.error,
      cities: [...p.cities].sort(),
      fields: [...p.fields].sort(),
      archiveRecoverable: p.docShas.size > 0,
      docShas: [...p.docShas],
    };
  });

  const summary = summarize(probes);
  const deadProbes = probes.filter((p) => p.verdict === "dead").sort((a, b) => Number(b.archiveRecoverable) - Number(a.archiveRecoverable) || a.url.localeCompare(b.url));

  const output = options.format === "json"
    ? JSON.stringify({ generatedAt, source, summary, probes }, null, 2) + "\n"
    : renderMarkdown(summary, deadProbes, generatedAt, source);

  if (options.out) {
    writeFileSync(options.out, output);
    process.stderr.write(`audit-proof-liveness: rapport écrit → ${options.out}\n`);
  } else {
    process.stdout.write(output);
  }
  process.stderr.write(`audit-proof-liveness: ${summary.dead}/${summary.total} mortes (${summary.deadPct} %), ${summary.archiveRecoverableDead} récupérables archive\n`);
}

// Exécution directe uniquement (pas quand importé par un test).
const invokedDirectly = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(`audit-proof-liveness: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  });
}
