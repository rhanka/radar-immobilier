import type { GraphSignalCard } from "../../routes/graph-signals.js";
import type { McpSignalSearchArgs } from "../../routes/mcp-signal-search.js";

type SearchCard = Pick<GraphSignalCard, "id" | "type" | "label" | "citySlug" | "sourceRef"
  | "description" | "publishedAt" | "docRefs" | "regulatoryStatus" | "props">;
const norm = (value: string) => value.trim().toLowerCase();
function firstStr(...values: unknown[]): string {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() ?? "";
}

/** Preserve the deployed domain mapping; the canonical builder owns classification. */
export function toMcpSignalResult(node: SearchCard, fallbackCity: string) {
  const nested = node.props.properties;
  const p = typeof nested === "object" && nested !== null && !Array.isArray(nested)
    ? nested as Record<string, unknown> : {};
  return {
    id: node.id, city: firstStr(node.citySlug, fallbackCity),
    type: firstStr(p.category, node.type), etape: firstStr(p.etape),
    regulatoryStatus: node.regulatoryStatus,
    etape_date: firstStr(p.etape_date, p.date, node.publishedAt),
    reglement_number: firstStr(p.reglement_number), zone_ref: firstStr(p.zone_ref, p.zone),
    no_lot: firstStr(p.no_lot) || null,
    summary: firstStr(node.description, node.label, p.description, p.summary),
    source_document_id: firstStr(node.sourceRef, node.docRefs[0]?.docSha),
  };
}

export function projectMcpSignalResults(cards: SearchCard[], args: McpSignalSearchArgs) {
  const q = args.query ? norm(args.query) : null;
  return cards.map((card) => toMcpSignalResult(card, args.city))
    .filter((s) => !args.etape || norm(s.etape) === norm(args.etape))
    .filter((s) => !q || norm(`${s.summary} ${s.type} ${s.reglement_number} ${s.zone_ref}`).includes(q))
    .slice(0, args.limit);
}
