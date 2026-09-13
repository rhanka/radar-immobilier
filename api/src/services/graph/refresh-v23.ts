import type { Extraction, OntologyCitation } from "@sentropic/graphify";

import {
  containsNormalizedPdfExcerpt,
  type RefreshCorpusDocument,
} from "./refresh-corpus.js";
import {
  graphifyGraphSchema,
  type GraphifyGraph,
  type GraphifyLink,
  type GraphifyNode,
} from "./graph-store.js";

export interface RefreshV23Options {
  readonly municipality: string;
  readonly generatedAt: string;
  readonly documents: readonly RefreshCorpusDocument[];
  readonly baseline: GraphifyGraph;
  readonly excludedNodeIds?: ReadonlySet<string>;
}

export interface RefreshV23Graph extends GraphifyGraph {
  readonly municipality: string;
  readonly generated_at: string;
  readonly ontology_version: "2.3";
  readonly pv_count: number;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function integerPage(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function citationExcerpt(citation: OntologyCitation, evidence: Record<string, unknown>): string | null {
  for (const value of [citation.excerpt, evidence["excerpt"]]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function refsFor(
  citations: readonly OntologyCitation[] | undefined,
  evidenceIds: readonly string[] | undefined,
  evidenceById: ReadonlyMap<string, Record<string, unknown>>,
  documents: readonly RefreshCorpusDocument[],
): Record<string, unknown>[] {
  const inputs = citations?.length ? citations : (evidenceIds ?? []).map((id) =>
    record(evidenceById.get(id)) as unknown as OntologyCitation);
  return inputs.map((citation) => {
    const evidence = record((evidenceIds ?? []).map((id) => evidenceById.get(id))
      .find((candidate) => candidate?.["source_file"] === citation.source_file));
    const directSha = citation.docSha;
    const document = documents.find((candidate) =>
      candidate.sha256 === directSha || candidate.originalKey === citation.source_file ||
      candidate.originalKey === citation.rawRef);
    if (!document) throw new Error(`Citation is not bound to an original document: ${citation.source_file}`);
    const page = integerPage(citation.page ?? evidence["page"]);
    const excerpt = citationExcerpt(citation, evidence);
    const pageText = page === null ? undefined : document.pages.find((item) => item.page === page)?.text;
    if (page === null || !excerpt
      || !containsNormalizedPdfExcerpt(pageText ?? "", excerpt)) {
      throw new Error(`Citation is not grounded on original PDF page: ${citation.source_file}`);
    }
    return {
      docSha: document.sha256,
      rawRef: document.originalKey,
      sourceUrl: document.sourceUrl,
      page,
      excerpt,
    };
  });
}

const TOP_LEVEL_ONTOLOGY_PROPERTY_KEYS = [
  "status",
  "resolution",
  "etape",
  "etape_date",
  "reglement_number",
] as const;

function ontologyProperties(values: Record<string, unknown>): Record<string, unknown> {
  const properties = { ...record(values["properties"]) };
  for (const key of TOP_LEVEL_ONTOLOGY_PROPERTY_KEYS) {
    if (values[key] !== undefined) properties[key] = values[key];
  }
  return properties;
}

function mapNode(
  node: Extraction["nodes"][number],
  evidence: ReadonlyMap<string, Record<string, unknown>>,
  documents: readonly RefreshCorpusDocument[],
): GraphifyNode {
  const values = record(node);
  const nodeType = node.node_type ?? values["type"] ?? node.file_type;
  if (typeof nodeType !== "string" || !nodeType) throw new Error(`Missing node type for ${node.id}`);
  const properties = ontologyProperties(values);
  const refs = refsFor(node.citations, node.evidence_refs, evidence, documents);
  return {
    id: node.id,
    type: nodeType,
    label: node.label || node.id,
    ...(typeof properties["description"] === "string" ? { description: properties["description"] } : {}),
    properties,
    ...(refs.length ? { refs } : {}),
  };
}

function mapEdge(
  edge: Extraction["edges"][number],
  evidence: ReadonlyMap<string, Record<string, unknown>>,
  documents: readonly RefreshCorpusDocument[],
): GraphifyLink {
  const refs = refsFor(edge.citations, edge.evidence_refs, evidence, documents);
  return {
    source: edge.source,
    target: edge.target,
    type: edge.relation,
    ...(edge.confidence ? { confidence: edge.confidence } : {}),
    ...(refs.length ? { refs } : {}),
  };
}

export function extractionToV23Graph(extraction: Extraction, options: RefreshV23Options): RefreshV23Graph {
  const excluded = options.excludedNodeIds ?? new Set<string>();
  const evidence = new Map((extraction.evidence ?? []).filter((item) => item.id)
    .map((item) => [item.id, record(item)]));
  const nodes = new Map<string, GraphifyNode>();
  for (const node of options.baseline.nodes) if (!excluded.has(node.id)) nodes.set(node.id, node);
  for (const node of extraction.nodes.map((item) => mapNode(item, evidence, options.documents))) {
    if (!excluded.has(node.id) && !nodes.has(node.id)) nodes.set(node.id, node);
  }
  const edgeKey = (edge: GraphifyLink) => `${edge.source}\0${edge.target}\0${edge.relation ?? edge.type ?? ""}`;
  const edges = new Map<string, GraphifyLink>();
  const baselineEdges = options.baseline.edges ?? options.baseline.links ?? [];
  for (const edge of baselineEdges) {
    if (!excluded.has(edge.source) && !excluded.has(edge.target)) edges.set(edgeKey(edge), edge);
  }
  for (const edge of extraction.edges.map((item) => mapEdge(item, evidence, options.documents))) {
    if (!excluded.has(edge.source) && !excluded.has(edge.target) && !edges.has(edgeKey(edge))) edges.set(edgeKey(edge), edge);
  }
  const candidate = {
    municipality: options.municipality,
    generated_at: options.generatedAt,
    ontology_version: "2.3" as const,
    pv_count: options.documents.length,
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.values()].sort((a, b) => edgeKey(a).localeCompare(edgeKey(b))),
  };
  graphifyGraphSchema.parse(candidate);
  return candidate;
}
