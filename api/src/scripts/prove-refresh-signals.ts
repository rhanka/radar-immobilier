/** Read-only proof projection for graph_nodes exports. */
import { readFile, writeFile } from "node:fs/promises";
import { classifyGraphNodeVivierV2 } from "../services/graph/graph-store.js";

export interface ExportedGraphNode {
  id: string;
  citySlug?: string | null;
  city_slug?: string | null;
  type: string;
  category?: string | null;
  label?: string | null;
  description?: string | null;
  etapeAnnote?: string | null;
  etape_annote?: string | null;
  props?: unknown;
  sourceRef?: string | null;
  source_ref?: string | null;
}

export interface ProofRow {
  id: string;
  citySlug: string;
  type: string;
  vivier: string;
  url: string;
}

function value(record: Record<string, unknown>, key: string): string | null {
  const item = record[key];
  return typeof item === "string" && item.trim() ? item.trim() : null;
}

function properties(props: unknown): Record<string, unknown> {
  if (!props || typeof props !== "object" || Array.isArray(props)) return {};
  const nested = (props as Record<string, unknown>).properties;
  return nested && typeof nested === "object" && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : {};
}

function url(origin: string, citySlug: string): string {
  return `${origin.replace(/\/$/, "")}/geo/city/${encodeURIComponent(citySlug)}?mode=signal&filter.subset=b`;
}

export function proveRefreshSignals(
  nodes: readonly ExportedGraphNode[],
  ids: readonly string[],
  origin: string,
): ProofRow[] {
  const wanted = new Set(ids.filter(Boolean));
  const rows = nodes
    .filter((node) => wanted.has(node.id) && (node.type === "Signal" || node.type === "DesignationEvent"))
    .map((node) => {
      const nested = properties(node.props);
      const category = node.category ?? value(nested, "category");
      const description = node.description ?? value(nested, "description");
      const etapeAnnote = node.etapeAnnote ?? node.etape_annote ?? value(nested, "etape");
      const sourceRef = node.sourceRef ?? node.source_ref ?? value(nested, "sourceRef") ?? value(nested, "source_ref");
      const classification = classifyGraphNodeVivierV2({
        id: node.id, type: node.type, category, label: node.label ?? null, description,
        etapeAnnote, props: node.props, sourceRef,
      });
      const citySlug = node.citySlug ?? node.city_slug;
      if (!citySlug) throw new Error(`signal ${node.id}: citySlug missing from export`);
      const vivier = classification.exclusion_reason !== null
        ? `exclu (${classification.exclusion_reason})`
        : classification.zonage.valeur === "oui" && classification.residentiel.valeur === "oui"
          ? "B′ qualifié"
          : `B′ à confirmer (${classification.residentiel.valeur})`;
      return { id: node.id, citySlug, type: node.type, vivier, url: url(origin, citySlug) };
    });
  const found = new Set(rows.map((row) => row.id));
  const absent = [...wanted].filter((id) => !found.has(id));
  if (absent.length) throw new Error(`signal ids absent/non signal: ${absent.join(", ")}`);
  return rows;
}

export function markdown(rows: readonly ProofRow[]): string {
  return ["| signal | ville | type | classification vivier | URL |", "| --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row.id} | ${row.citySlug} | ${row.type} | ${row.vivier} | ${row.url} |`), ""].join("\n");
}

async function main(): Promise<void> {
  const [input, idsArgument, origin = "https://immo-preprod.sent-tech.ca", output] = process.argv.slice(2);
  if (!input || !idsArgument) throw new Error("usage: prove-refresh-signals <export.ndjson> <id,...> [origin] [output.md]");
  const nodes = (await readFile(input, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as ExportedGraphNode);
  const report = markdown(proveRefreshSignals(nodes, idsArgument.split(","), origin));
  if (output) await writeFile(output, report);
  else process.stdout.write(report);
}

if (process.argv[1]?.endsWith("prove-refresh-signals.js")) void main();
