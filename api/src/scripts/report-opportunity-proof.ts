/**
 * Read-only WPB-E2E proof audit.
 *
 * Usage:
 *   make exec-api CMD="npx tsx src/scripts/report-opportunity-proof.ts" ENV=wpb-e2e-proof
 */

import { sql } from "drizzle-orm";
import { loadConfig } from "../config.js";
import { createDb } from "../db/client.js";
import { isMulti4Plus, isPrecoceSignal, isZonageSignal } from "../services/graph/graph-store.js";

type Dict = Record<string, unknown>;
type Format = "markdown" | "json";
type Row = { id: string; type: string; label: string; city_slug: string; source_ref: string | null; props: Dict; category: string | null; nb_unites_max: string | null; intensite: string | null; etape: string | null; description: string | null; geo_zones: string[]; geo_lots: string[]; graph_zones: string[]; graph_lots: string[]; zone_details: string[]; lot_details: string[]; grid_refs: Array<string | null>; scoring_grid_versions: Array<string | null> };

function args(): { city: string | null; format: Format; limit: number; partial: boolean } {
  const out = { city: null as string | null, format: "markdown" as Format, limit: 33, partial: false };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const v = a[i]!;
    if (v === "--allow-partial") out.partial = true;
    else if (v === "--city") out.city = a[++i] ?? null;
    else if (v === "--format") out.format = (a[++i] as Format | undefined) ?? "markdown";
    else if (v === "--limit") out.limit = Number(a[++i] ?? "33");
    else throw new Error(`Unknown argument: ${v}`);
  }
  if (!Number.isInteger(out.limit) || out.limit <= 0) throw new Error("--limit must be > 0");
  if (out.format !== "markdown" && out.format !== "json") throw new Error("--format must be markdown|json");
  return out;
}

function rec(v: unknown): Dict {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? v as Dict : {};
}

function str(...values: unknown[]): string | null {
  for (const v of values) if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

function num(...values: unknown[]): number | null {
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

function uniq(values: readonly unknown[]): string[] {
  return [...new Set(values.filter((v): v is string => typeof v === "string" && v.trim().length > 0))];
}

function proof(row: Row) {
  const props = row.props ?? {};
  const nested = rec(props.properties);
  const ref = Array.isArray(props.refs) ? rec(props.refs[0]) : {};
  const evidence = {
    description: str(row.description, props.description, nested.description),
    citation: str(ref.excerpt, ref.citation, props.excerpt, props.citation, nested.excerpt, nested.citation),
    document: str(ref.sourceUrl, ref.rawRef, ref.documentUrl, props.sourceUrl, nested.sourceUrl, props.rawRef, nested.rawRef, row.source_ref),
    page: num(ref.page, props.page, nested.page),
    bbox: ref.bbox ?? props.bbox ?? nested.bbox ?? null,
  };
  const zones = uniq([...row.geo_zones, ...row.graph_zones, ...row.zone_details]);
  const lots = uniq([...row.geo_lots, ...row.graph_lots, ...row.lot_details]);
  const grids = uniq(row.grid_refs);
  const checks = { citation: evidence.citation !== null, document: evidence.document !== null, page: evidence.page !== null, bbox: evidence.bbox !== null, zone: zones.length > 0, lots: lots.length > 0, grille: grids.length > 0 };
  return { id: row.id, type: row.type, citySlug: row.city_slug, label: row.label, evidence, zones, lots, grids, scoringGridVersions: uniq(row.scoring_grid_versions), missing: Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k) };
}

function renderMarkdown(items: ReturnType<typeof proof>[], total: number, limit: number): string {
  const ok = (b: boolean) => b ? "yes" : "no";
  const lines = ["# WPB-E2E Opportunity Proof Audit", "", `Generated: ${new Date().toISOString()}`, `Priority candidates found: ${total}; reported: ${items.length}/${limit}`, "", "| # | City | Signal | Citation | PDF/raw | Page | BBox | Zone | Lots | Grille | Missing |", "|---:|---|---|---|---|---|---|---|---|---|---|"];
  items.forEach((item, index) => {
    lines.push(`| ${index + 1} | ${item.citySlug} | ${item.type}:${item.id} | ${ok(item.evidence.citation !== null)} | ${ok(item.evidence.document !== null)} | ${ok(item.evidence.page !== null)} | ${ok(item.evidence.bbox !== null)} | ${ok(item.zones.length > 0)} | ${ok(item.lots.length > 0)} | ${ok(item.grids.length > 0)} | ${item.missing.join(", ") || "-"} |`);
  });
  items.forEach((item, index) => {
    lines.push("", `## ${index + 1}. ${item.label}`, "");
    lines.push(`- Signal: ${item.type} \`${item.id}\` (${item.citySlug})`);
    lines.push(`- Citation: ${item.evidence.citation ?? "MISSING"}`);
    lines.push(`- PDF/rawRef: ${item.evidence.document ?? "MISSING"}; page=${item.evidence.page ?? "MISSING"}; bbox=${JSON.stringify(item.evidence.bbox ?? "MISSING")}`);
    lines.push(`- Zones: ${item.zones.join("; ") || "MISSING"}`);
    lines.push(`- Lots: ${item.lots.join("; ") || "MISSING"}`);
    lines.push(`- Grille: ${item.grids.join("; ") || "MISSING"}`);
    lines.push(`- Scoring grid versions: ${item.scoringGridVersions.join(", ") || "not linked"}`);
  });
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const options = args();
  const { db, pool } = createDb(loadConfig());
  try {
    const result = await db.execute<Row>(sql`
      SELECT n.id, n.type, n.label, n.city_slug, n.source_ref, n.props,
        n.props->'properties'->>'category' AS category,
        n.props->'properties'->>'nb_unites_max' AS nb_unites_max,
        n.props->'properties'->>'intensite' AS intensite,
        n.props->'properties'->>'etape' AS etape,
        COALESCE(n.props->'properties'->>'description', n.props->>'description') AS description,
        ARRAY(SELECT DISTINCT target_id FROM geo_resolutions WHERE node_id = n.id AND relation_type = 'concerns_zone') AS geo_zones,
        ARRAY(SELECT DISTINCT target_id FROM geo_resolutions WHERE node_id = n.id AND relation_type = 'concerns_lot') AS geo_lots,
        ARRAY(SELECT DISTINCT x.label FROM graph_edges e JOIN graph_nodes x ON x.id = CASE WHEN e.src_id = n.id THEN e.dst_id ELSE e.src_id END WHERE (e.src_id = n.id OR e.dst_id = n.id) AND lower(x.type) = 'zone') AS graph_zones,
        ARRAY(SELECT DISTINCT x.label FROM graph_edges e JOIN graph_nodes x ON x.id = CASE WHEN e.src_id = n.id THEN e.dst_id ELSE e.src_id END WHERE (e.src_id = n.id OR e.dst_id = n.id) AND lower(x.type) = 'lot') AS graph_lots,
        ARRAY(SELECT DISTINCT code_affiche || ' [' || geom_source || ':' || raw_ref || ']' FROM zone_versions z WHERE z.canonical_id IN (SELECT target_id FROM geo_resolutions WHERE node_id = n.id AND relation_type = 'concerns_zone')) AS zone_details,
        ARRAY(SELECT DISTINCT no_lot || ' [' || geom_source || ':' || raw_ref || ']' FROM lot_versions l WHERE l.canonical_id IN (SELECT target_id FROM geo_resolutions WHERE node_id = n.id AND relation_type = 'concerns_lot')) AS lot_details,
        ARRAY(SELECT DISTINCT COALESCE(x.props->'properties'->>'url_grille', x.props->>'url_grille', x.source_ref) FROM graph_edges e JOIN graph_nodes x ON x.id = CASE WHEN e.src_id = n.id THEN e.dst_id ELSE e.src_id END WHERE (e.src_id = n.id OR e.dst_id = n.id) AND (x.label ILIKE '%grille%' OR x.props::text ILIKE '%grille%' OR x.props::text ILIKE '%grid%')) AS grid_refs,
        ARRAY(SELECT DISTINCT grid_version FROM opportunity_dossiers d WHERE d.city_slug = n.city_slug AND (d.zone_canonical_id IN (SELECT target_id FROM geo_resolutions WHERE node_id = n.id AND relation_type = 'concerns_zone') OR d.lot_canonical_id IN (SELECT target_id FROM geo_resolutions WHERE node_id = n.id AND relation_type = 'concerns_lot'))) AS scoring_grid_versions
      FROM graph_nodes n
      WHERE n.type IN ('Signal', 'DesignationEvent') AND n.city_slug IS NOT NULL
        AND (${options.city}::text IS NULL OR n.city_slug = ${options.city})
      ORDER BY n.city_slug, n.id
    `);
    const priority = result.rows
      .filter((r) => isZonageSignal(r.type, r.category) && isMulti4Plus(r.type, r.nb_unites_max, r.intensite) && isPrecoceSignal(r.etape, r.label, r.description))
      .map(proof);
    if (priority.length < options.limit && !options.partial) throw new Error(`Only ${priority.length} z|m|p priority candidates found; expected at least ${options.limit}. Re-run with --allow-partial to emit a partial report.`);
    const items = priority.slice(0, options.limit);
    console.log(options.format === "json" ? JSON.stringify({ generatedAt: new Date().toISOString(), totalPriority: priority.length, items }, null, 2) : renderMarkdown(items, priority.length, options.limit));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`report-opportunity-proof: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
});
