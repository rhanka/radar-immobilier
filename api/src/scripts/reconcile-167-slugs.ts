/**
 * reconcile-167-slugs — réconcilie les slugs du SET 167 (convention
 * wp1-atome-par-ville : tiret simple) avec le `city_slug` AUTORITAIRE du graphe
 * (= préfixe S3 `graph/<city_slug>/` = graph_nodes.city_slug ; convention tiret
 * DOUBLE pour séparateur MRC, apostrophes repliées).
 *
 * Motif : recette joint sur city_slug ; 41/167 ne matchaient pas → villes ratées
 * silencieusement. Ce script produit la table de correspondance autoritaire.
 *
 * Read-only. Lit le tsv du SET 167 + liste S3 graph/*, matche chaque slug 167 à
 * un city_slug graphe (exact, sinon normalisé), et émet un tsv augmenté d'une
 * colonne `graph_city_slug` + `match` (exact|normalized|UNMATCHED).
 *
 * Usage :
 *   tsx --env-file=.env api/src/scripts/reconcile-167-slugs.ts \
 *     --in docs/spec/reports/set-167-bprime.tsv \
 *     --out docs/spec/reports/set-167-bprime.tsv
 */

import { readFileSync, writeFileSync } from "node:fs";
import { setDefaultResultOrder } from "node:dns";

setDefaultResultOrder("ipv4first");

interface Row {
  slug: string;
  name: string;
  priorityRank: string;
  graphVersion: string;
  comments: string[]; // lignes # d'en-tête à préserver
}

function parseArgs(argv: string[]): { in: string; out: string } {
  const out = { in: "docs/spec/reports/set-167-bprime.tsv", out: "docs/spec/reports/set-167-bprime.tsv" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--in") out.in = argv[++i]!;
    else if (argv[i] === "--out") out.out = argv[++i]!;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return out;
}

/** Normalisation tolérante : collapse tirets répétés, retire les apostrophes. */
export function normalizeSlug(slug: string): string {
  return slug
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")   // diacritiques combinants
    .replace(/['’]/g, "")    // apostrophes droites/courbes
    .replace(/-+/g, "-")               // tirets répétés → simple
    .replace(/^-|-$/g, "");
}

async function listGraphSlugs(): Promise<Set<string>> {
  const { S3Client, ListObjectsV2Command } = await import("@aws-sdk/client-s3");
  const e = process.env;
  const endpoint = e.GRAPH_S3_ENDPOINT ?? e.SCRAPE_S3_ENDPOINT ?? e.S3_ENDPOINT;
  const bucket = e.GRAPH_S3_BUCKET ?? e.SCRAPE_S3_BUCKET ?? e.S3_BUCKET;
  const region = e.GRAPH_S3_REGION ?? e.SCRAPE_S3_REGION ?? e.S3_REGION ?? "fr-par";
  const accessKeyId = e.GRAPH_S3_ACCESS_KEY ?? e.SCRAPE_S3_ACCESS_KEY ?? e.S3_ACCESS_KEY;
  const secretAccessKey = e.GRAPH_S3_SECRET_KEY ?? e.SCRAPE_S3_SECRET_KEY ?? e.S3_SECRET_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("S3 config incomplete (need *_S3_ENDPOINT/BUCKET/ACCESS_KEY/SECRET_KEY).");
  }
  const client = new S3Client({ endpoint, region, credentials: { accessKeyId, secretAccessKey }, forcePathStyle: true, maxAttempts: 10 });
  const slugs = new Set<string>();
  let token: string | undefined;
  do {
    const res = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: "graph/", Delimiter: "/", ContinuationToken: token }));
    for (const p of res.CommonPrefixes ?? []) {
      const m = /^graph\/([^/]+)\/$/.exec(p.Prefix ?? "");
      if (m) slugs.add(m[1]!);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return slugs;
}

function readRows(path: string): { rows: Row[]; comments: string[]; header: string } {
  const lines = readFileSync(path, "utf8").split("\n");
  const comments: string[] = [];
  const rows: Row[] = [];
  let header = "";
  for (const line of lines) {
    if (line.startsWith("#")) { comments.push(line); continue; }
    if (line.trim() === "") continue;
    if (!header && line.startsWith("slug\t")) { header = line; continue; }
    const [slug, name, priorityRank, graphVersion] = line.split("\t");
    rows.push({ slug: slug ?? "", name: name ?? "", priorityRank: priorityRank ?? "", graphVersion: graphVersion ?? "", comments: [] });
  }
  return { rows, comments, header };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const { rows, comments } = readRows(opts.in);
  const graphSlugs = await listGraphSlugs();
  process.stderr.write(`reconcile-167-slugs: ${graphSlugs.size} city_slug graphe listés (S3), ${rows.length} villes 167 à matcher\n`);

  // Index normalisé du graphe pour le fallback tolérant.
  const graphByNorm = new Map<string, string[]>();
  for (const g of graphSlugs) {
    const n = normalizeSlug(g);
    (graphByNorm.get(n) ?? graphByNorm.set(n, []).get(n)!).push(g);
  }

  let exact = 0, normalized = 0, unmatched = 0;
  const outLines: string[] = [];
  outLines.push("# SET 167 B′ canonique — priorityRank<=167 (figé conducteur 2026-08-02, source wp1-atome-par-ville.tsv)");
  outLines.push("# graph_city_slug = city_slug AUTORITAIRE (préfixe S3 graph/ = graph_nodes.city_slug, tiret double MRC). match=exact|normalized|UNMATCHED.");
  outLines.push("slug\tname\tpriorityRank\tgraph_version\tgraph_city_slug\tmatch");
  const unmatchedList: string[] = [];
  for (const r of rows) {
    let graphSlug = "";
    let match = "UNMATCHED";
    if (graphSlugs.has(r.slug)) { graphSlug = r.slug; match = "exact"; exact++; }
    else {
      const cands = graphByNorm.get(normalizeSlug(r.slug));
      if (cands && cands.length === 1) { graphSlug = cands[0]!; match = "normalized"; normalized++; }
      else if (cands && cands.length > 1) { graphSlug = cands.join("|"); match = "AMBIGUOUS"; unmatched++; unmatchedList.push(`${r.slug} → ${match} (${graphSlug})`); }
      else { unmatched++; unmatchedList.push(`${r.slug} → UNMATCHED (graph_version=${r.graphVersion})`); }
    }
    outLines.push(`${r.slug}\t${r.name}\t${r.priorityRank}\t${r.graphVersion}\t${graphSlug}\t${match}`);
  }
  void comments; // en-tête régénéré ci-dessus
  writeFileSync(opts.out, outLines.join("\n") + "\n");
  process.stderr.write(`reconcile-167-slugs: exact=${exact} normalized=${normalized} unmatched=${unmatched} → ${opts.out}\n`);
  if (unmatchedList.length > 0) {
    process.stderr.write("NON MATCHÉS (à traiter / probablement v2.2 non projetées ou 5 sans graphe) :\n" + unmatchedList.map((u) => "  " + u).join("\n") + "\n");
  }
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(`reconcile-167-slugs: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  });
}
