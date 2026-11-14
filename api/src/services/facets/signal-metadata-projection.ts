import { sql } from "drizzle-orm";
import { resultCivilDates, vivierFiltreCubeKey, vivierRankTuple } from "@radar/domain";
import type { Database } from "../../db/client.js";
import { classifyGraphNodeVivierV2 } from "../graph/graph-store.js";
import { graphSignalRankFreshness } from "../../routes/graph-signals.js";

export const SIGNAL_METADATA_VERSION = 1;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export interface MetadataSourceRow {
  id: string; type: string; label: string; props: unknown; sourceRef: string | null; createdAt: Date;
}

/** Write-time only. Call under the city lock, before publishing its revision. */
export async function refreshSignalMetadata(tx: Tx, citySlug: string, rows: readonly MetadataSourceRow[]) {
  const edges = await tx.execute(sql`SELECT src_id, dst_id, kind FROM graph_edges WHERE city_slug=${citySlug}`);
  const attachments = new Map<string, Array<{ id: string; kind: string; direction: string }>>();
  for (const edge of edges.rows) {
    for (const [id, other, direction] of [[edge.src_id, edge.dst_id, "out"], [edge.dst_id, edge.src_id, "in"]]) {
      const key = String(id);
      const list = attachments.get(key) ?? [];
      list.push({ id: String(other), kind: String(edge.kind), direction: String(direction) });
      attachments.set(key, list);
    }
  }
  const projected = rows.filter((r) => r.type === "Signal" || r.type === "DesignationEvent").map((row) => {
    const props = row.props as { properties?: Record<string, unknown> } | null;
    const fields = props?.properties ?? {};
    const text = (key: string) => fields[key] == null ? null : String(fields[key]);
    const classification = classifyGraphNodeVivierV2({ ...row, category: text("category"),
      description: text("description"), etapeAnnote: text("etape") });
    return { id: row.id, type: row.type,
      documentDates: resultCivilDates(row.props, "document"), scrapDates: resultCivilDates(row.props, "scrap"),
      bits: vivierFiltreCubeKey({ ...row, props: (row.props ?? {}) as Record<string, unknown>, classification }),
      rank: vivierRankTuple({ id: row.id, classification, fraicheur: graphSignalRankFreshness({ ...row, citySlug }) }),
      attachments: attachments.get(row.id) ?? [] };
  });
  await tx.execute(sql`DELETE FROM signal_metadata WHERE city_slug=${citySlug}`);
  // Bound parameters and transient JSON, including very large city projections.
  for (let offset = 0; offset < projected.length; offset += 500) {
    await tx.execute(sql`INSERT INTO signal_metadata
      (city_slug,node_type,node_id,version,document_dates,scrap_dates,filter_bits,rank_key,attachments)
      SELECT ${citySlug},r.type,r.id,${SIGNAL_METADATA_VERSION},r."documentDates",r."scrapDates",r.bits,r.rank,r.attachments
      FROM jsonb_to_recordset(${JSON.stringify(projected.slice(offset, offset + 500))}::jsonb)
      AS r(id text,type text,"documentDates" text[],"scrapDates" text[],bits text,rank jsonb,attachments jsonb)`);
  }
  await tx.execute(sql`INSERT INTO signal_metadata_versions(city_slug,version,target_count)
    VALUES (${citySlug},${SIGNAL_METADATA_VERSION},${projected.length}) ON CONFLICT(city_slug)
    DO UPDATE SET version=EXCLUDED.version,target_count=EXCLUDED.target_count`);
}
