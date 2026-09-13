import { createHash } from "node:crypto";

import type { ObjectReader } from "../../storage/object-store.js";

const HEADER = "source_id\tcity_slug\tsha\trepresentation_key\tsidecar_key";
const SHA256 = /^[0-9a-f]{64}$/;

export interface RefreshCorpusChunk {
  readonly id: string;
  readonly docSha: string;
  readonly originalKey: string;
  readonly sourceUrl: string;
  readonly pages: readonly number[];
  readonly text: string;
}

export function containsNormalizedPdfExcerpt(
  pageText: string,
  excerpt: string,
): boolean {
  const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
  const normalizedExcerpt = normalize(excerpt);

  return normalizedExcerpt.length > 0 && normalize(pageText).includes(normalizedExcerpt);
}

export interface RefreshCorpusDocument {
  readonly sourceId: string;
  readonly citySlug: string;
  readonly sha256: string;
  readonly originalKey: string;
  readonly sourceUrl: string;
  readonly pages: readonly { page: number; text: string }[];
  readonly chunks: readonly RefreshCorpusChunk[];
}

export interface RefreshCorpus {
  readonly inputHash: string;
  readonly documents: readonly RefreshCorpusDocument[];
  readonly chunks: readonly RefreshCorpusChunk[];
}

interface ManifestEntry {
  readonly sourceId: string;
  readonly citySlug: string;
  readonly sha256: string;
  readonly representationKey: string;
  readonly sidecarKey: string;
}

export interface MaterializeRefreshCorpusOptions {
  readonly citySlug: string;
  readonly manifestKey: string;
  readonly reader: Pick<ObjectReader, "get">;
  readonly extractPdf: (bytes: Uint8Array, sourceUrl: string) => Promise<string>;
}

function parseManifest(bytes: Uint8Array): ManifestEntry[] {
  const lines = new TextDecoder().decode(bytes).trimEnd().split("\n");
  if (lines.shift() !== HEADER) throw new Error("Invalid refresh manifest header");
  const seen = new Set<string>();
  return lines.filter(Boolean).map((line, index) => {
    const fields = line.split("\t");
    if (fields.length !== 5) throw new Error(`Invalid refresh manifest row ${index + 2}`);
    const [sourceId, citySlug, sha256, representationKey, sidecarKey] = fields as [string, string, string, string, string];
    if (!SHA256.test(sha256)) throw new Error(`Invalid SHA-256 at manifest row ${index + 2}`);
    const prefix = `raw/${sourceId}/cas/${sha256}`;
    if (!["pdf", "html", "txt"].some((extension) => representationKey === `${prefix}.${extension}`)) {
      throw new Error(`Invalid CAS representation path at manifest row ${index + 2}`);
    }
    if (sidecarKey !== "source-gap" && sidecarKey !== `${representationKey}.meta.json`) {
      throw new Error(`Invalid CAS sidecar path at manifest row ${index + 2}`);
    }
    const identity = `${sourceId}\0${citySlug}\0${sha256}`;
    if (seen.has(identity)) throw new Error(`Duplicate refresh input ${identity.replaceAll("\0", "/")}`);
    seen.add(identity);
    return { sourceId, citySlug, sha256, representationKey, sidecarKey };
  });
}

function splitBounded(text: string, maxBytes: number): string[] {
  const parts: string[] = [];
  let part = "";
  let bytes = 0;
  for (const character of text) {
    const size = Buffer.byteLength(character);
    if (part && bytes + size > maxBytes) {
      parts.push(part);
      part = "";
      bytes = 0;
    }
    part += character;
    bytes += size;
  }
  if (part) parts.push(part);
  return parts;
}

function chunkDocument(doc: Omit<RefreshCorpusDocument, "chunks">): RefreshCorpusChunk[] {
  const totalBytes = doc.pages.reduce((sum, page) => sum + Buffer.byteLength(page.text), 0);
  const maxBytes = totalBytes <= 200_000 ? 200_000 : totalBytes <= 400_000 ? 120_000 : 30_000;
  const chunks: { pages: number[]; parts: string[]; bytes: number }[] = [];
  for (const page of doc.pages) {
    const marker = `[PDF PAGE ${page.page}]\n`;
    for (const part of splitBounded(page.text, maxBytes - Buffer.byteLength(marker) - 2)) {
      const bytes = Buffer.byteLength(marker) + Buffer.byteLength(part) + 2;
      let current = chunks.at(-1);
      if (!current || current.bytes + bytes > maxBytes) {
        current = { pages: [], parts: [], bytes: 0 };
        chunks.push(current);
      }
      current.pages.push(page.page);
      current.parts.push(`${marker}${part}`);
      current.bytes += bytes;
    }
  }
  return chunks.map((chunk, index) => ({
    id: `${doc.sha256}.${index + 1}`,
    docSha: doc.sha256,
    originalKey: doc.originalKey,
    sourceUrl: doc.sourceUrl,
    pages: [...new Set(chunk.pages)],
    text: chunk.parts.join("\n\n"),
  }));
}

export async function materializeRefreshCorpus(options: MaterializeRefreshCorpusOptions): Promise<RefreshCorpus> {
  const selected = parseManifest(await options.reader.get(options.manifestKey))
    .filter((entry) => entry.citySlug === options.citySlug)
    .sort((a, b) => a.representationKey.localeCompare(b.representationKey));
  if (selected.length === 0) throw new Error(`No manifest inputs selected for ${options.citySlug}`);
  const documents: RefreshCorpusDocument[] = [];
  for (const entry of selected) {
    if (!entry.representationKey.endsWith(".pdf") || entry.sidecarKey === "source-gap") {
      throw new Error(`Exact-PDF refresh requires a PDF and sidecar: ${entry.representationKey}`);
    }
    const bytes = await options.reader.get(entry.representationKey);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== entry.sha256) throw new Error(`Checksum mismatch for ${entry.representationKey}`);
    const sidecar = JSON.parse(new TextDecoder().decode(await options.reader.get(entry.sidecarKey))) as { sourceUrl?: unknown };
    if (typeof sidecar.sourceUrl !== "string" || !URL.canParse(sidecar.sourceUrl)) {
      throw new Error(`Missing public source URL for ${entry.representationKey}`);
    }
    const text = await options.extractPdf(bytes, sidecar.sourceUrl);
    const pageTexts = text.split("\f");
    if (pageTexts.at(-1) === "") pageTexts.pop();
    if (!pageTexts.some((page) => page.trim())) throw new Error(`Unsupported scanned PDF ${entry.representationKey}`);
    const base = { sourceId: entry.sourceId, citySlug: entry.citySlug, sha256: entry.sha256,
      originalKey: entry.representationKey, sourceUrl: sidecar.sourceUrl,
      pages: pageTexts.map((page, index) => ({ page: index + 1, text: page })) };
    documents.push({ ...base, chunks: chunkDocument(base) });
  }
  const inputHash = createHash("sha256").update(selected.map((entry) =>
    `${entry.sourceId}\t${entry.citySlug}\t${entry.sha256}\t${entry.representationKey}`).join("\n")).digest("hex");
  return { inputHash, documents, chunks: documents.flatMap((document) => document.chunks) };
}
