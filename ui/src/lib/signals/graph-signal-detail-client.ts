/**
 * Client for GET /api/graph-signals/:city
 *
 * Fetches Signal + DesignationEvent nodes for one city from graph_nodes
 * (graphify pipeline, ~197 villes), NOT the old ontology project-state.
 *
 * Anti-invention: returns 404 when no signal nodes exist for the city.
 */

/**
 * A documentary reference attached to a Signal or DesignationEvent node.
 *
 * Mirrors the graphify v2 `refs` array items stored in graph_nodes.props.refs.
 *   - docSha     : SHA-256 hex of the source document (always present)
 *   - excerpt    : short citation extracted from the document (optional)
 *   - page       : 1-based page number in the PDF (optional)
 *   - sourceUrl  : public URL of the original PDF/page (optional, preferred for link)
 *   - rawRef     : SCW-internal path (optional, fallback identifier)
 */
export interface SignalDocRef {
  docSha: string;
  excerpt?: string;
  page?: number;
  sourceUrl?: string;
  rawRef?: string;
  documentUrl?: string;
  title?: string;
  contentType?: string;
  fetchedAt?: string;
  publishedAt?: string;
  bbox?: unknown;
}

/**
 * Extract typed SignalDocRef[] from graphify props.
 *
 * Graphify versions have not used one stable evidence shape: some rows store
 * `docSha/sourceUrl/excerpt`, others store `file/ref/citation` or only top-level
 * citation fields. Keep every usable citation/PDF reference instead of dropping
 * it because one identifier key is missing.
 */
export function extractDocRefs(props: Record<string, unknown>): SignalDocRef[] {
  const result: SignalDocRef[] = [];
  const raw = props["refs"];

  if (Array.isArray(raw)) {
    raw.forEach((item, index) => {
      const ref = parseDocRefRecord(item, `ref-${index + 1}`);
      if (ref) result.push(ref);
    });
  }

  const topLevelRef = parseDocRefRecord(props, "citation");
  if (topLevelRef) result.push(topLevelRef);

  return dedupeRefs(result);
}

function parseDocRefRecord(item: unknown, fallbackId: string): SignalDocRef | null {
  if (typeof item !== "object" || item === null) return null;
  const r = item as Record<string, unknown>;
  const excerpt = firstString(r, [
    "excerpt",
    "citation",
    "quote",
    "text",
    "selection",
    "highlight",
  ]);
  const sourceUrl = firstString(r, [
    "sourceUrl",
    "source_url",
    "pdfUrl",
    "pdf_url",
    "url",
    "href",
  ]);
  const rawRef = firstString(r, [
    "rawRef",
    "raw_ref",
    "file",
    "ref",
    "sourceRef",
    "source_ref",
    "path",
    "s3Key",
    "s3_key",
  ]);
  const docSha = firstString(r, [
    "docSha",
    "doc_sha",
    "sha",
    "sha256",
    "hash",
    "documentSha",
    "document_sha",
    "file",
    "ref",
    "sourceRef",
    "source_ref",
  ]);
  const page = firstNumber(r, ["page", "pageNumber", "page_number"]);
  const documentUrl = firstString(r, ["documentUrl", "document_url", "apiUrl", "api_url"]);
  const title = firstString(r, ["title", "documentTitle", "document_title"]);
  const contentType = firstString(r, ["contentType", "content_type", "mimeType", "mime_type"]);
  const fetchedAt = firstString(r, ["fetchedAt", "fetched_at"]);
  const publishedAt = firstString(r, [
    "publishedAt",
    "published_at",
    "documentDate",
    "document_date",
  ]);
  const bbox = r.bbox ?? r.boundingBox ?? r.bounding_box;

  if (!docSha && !excerpt && !sourceUrl && !rawRef && !documentUrl) return null;

  return {
    docSha: docSha ?? rawRef ?? sourceUrl ?? documentUrl ?? fallbackId,
    ...(excerpt !== null ? { excerpt } : {}),
    ...(page !== null ? { page } : {}),
    ...(sourceUrl !== null ? { sourceUrl } : {}),
    ...(rawRef !== null ? { rawRef } : {}),
    ...(documentUrl !== null ? { documentUrl } : {}),
    ...(title !== null ? { title } : {}),
    ...(contentType !== null ? { contentType } : {}),
    ...(fetchedAt !== null ? { fetchedAt } : {}),
    ...(publishedAt !== null ? { publishedAt } : {}),
    ...(bbox !== undefined ? { bbox } : {}),
  };
}

function firstString(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function firstNumber(
  record: Record<string, unknown>,
  keys: readonly string[],
): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function dedupeRefs(refs: readonly SignalDocRef[]): SignalDocRef[] {
  const seen = new Set<string>();
  const result: SignalDocRef[] = [];
  for (const ref of refs) {
    const key = [
      ref.docSha,
      ref.page ?? "",
      ref.sourceUrl ?? "",
      ref.rawRef ?? "",
      ref.documentUrl ?? "",
      ref.excerpt ?? "",
    ].join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
  }
  return result;
}

export interface GraphSignalNode {
  id: string;
  type: "Signal" | "DesignationEvent" | string;
  label: string;
  citySlug: string | null;
  sourceRef: string | null;
  createdAt: string | null;
  description?: string | null;
  publishedAt?: string | null;
  docRefs?: SignalDocRef[];
  props: Record<string, unknown>;
}

export interface GraphSignalDetailResponse {
  ok: boolean;
  citySlug: string;
  nodes: GraphSignalNode[];
}

export async function fetchGraphSignalDetail(
  citySlug: string,
  baseUrl = "",
): Promise<GraphSignalDetailResponse> {
  const res = await fetch(
    `${baseUrl}/api/graph-signals/${encodeURIComponent(citySlug)}`,
  );
  if (!res.ok) throw new Error(`graph-signals/${citySlug}: ${res.status}`);
  return res.json();
}
