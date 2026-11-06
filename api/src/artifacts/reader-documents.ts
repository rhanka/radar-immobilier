/**
 * J1.2d/e wagon 5 — `documents.pv.v1` (§11.3): the PV PDF served to an
 * artifact reader, resolved ONLY from a signal the reader can see. Never a
 * relay of `/api/documents/raw`:
 * - input is exactly `(workspaceId, citySlug, type, id, docSha)` — no
 *   `rawRef`, no `sourceUrl`, no other key (refused before any store read);
 * - the reader's workspace access is re-checked by the same scoped service
 *   as `signals.coherent-city.v1`, and an effectively archived target answers
 *   the same 404 as a missing one (no existence oracle);
 * - the storage key comes from the stored node's own doc-refs (the card built
 *   by the same builder as the DTO), never from the request;
 * - PDF only: `application/pdf` content type AND `%PDF-` magic bytes.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { graphNodes } from "../db/schema.js";
import type { RawDocumentRead } from "../routes/documents.js";
import { normalizeRawRef } from "../services/sources/document-resolver.js";
import { CitySlug, WorkspaceId } from "../services/facets/classification-query.js";
import { readWorkspaceArchiveCity } from "../services/facets/workspace-reader.js";
import { buildScopedSignalCards } from "../services/facets/scoped-signal-cards.js";
import { FacetError } from "../services/facets/target.js";
import { ScopeError } from "../services/facets/scope.js";
import { WorkspaceError } from "../services/workspaces/types.js";
import type { ObjectStore } from "../storage/object-store.js";
import type { ApiReaderContext } from "./reader-context.js";

/** Exact §11.3 input. Any other key (including `rawRef`, `sourceUrl`, `grant`) refuses. */
export const documentsPvParams = z.object({
  workspaceId: WorkspaceId,
  citySlug: CitySlug,
  type: z.enum(["Signal", "DesignationEvent"]),
  id: z.string().min(1).max(1024),
  docSha: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export type DocumentsPvParams = z.infer<typeof documentsPvParams>;

/** Closed resolution outcomes; the dispatch maps each to one typed answer. */
export type ReaderDocumentResult =
  | { kind: "pdf"; bytes: Uint8Array }
  | { kind: "not_found" }
  | { kind: "unsupported_media" }
  | { kind: "too_large" }
  /** Scoped-service refusal; the dispatch maps it through the closed classification table. */
  | { kind: "refused"; cause: WorkspaceError | ScopeError | FacetError };

export type ReaderDocumentRead = (
  params: DocumentsPvParams, context: ApiReaderContext,
) => Promise<ReaderDocumentResult>;

export interface ReaderDocumentDeps {
  readonly db: Database;
  readonly store: ObjectStore;
  /** Shared raw resolution (`createRawDocumentReader`), same stores as the app. */
  readonly readRaw: (normalizedRawRef: string, sourceUrl: string | null) => Promise<RawDocumentRead>;
}

/** CAS key → embedded docSha (`raw/proces-verbaux-<city>/cas/<sha>.pdf`). */
function docShaFromRawRef(rawRef: string): string | null {
  const match = rawRef.match(/\/cas\/([a-f0-9]{64})\.[^/.]+$/);
  return match ? match[1]! : null;
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

export function isPdfBytes(bytes: Uint8Array): boolean {
  if (bytes.byteLength < PDF_MAGIC.length) return false;
  return PDF_MAGIC.every((byte, index) => bytes[index] === byte);
}

export function createReaderDocumentRead(deps: ReaderDocumentDeps): ReaderDocumentRead {
  return async (params, context) => {
    try {
      // Approved account + active membership + open epoch + resolved history,
      // re-checked by the same scoped service as the coherent projection.
      const archive = await readWorkspaceArchiveCity(deps.db, context.readerSub,
        params.workspaceId, params.citySlug);
      const archived = archive.some((head) => head.effectiveDiscarded
        && head.target.type === params.type && head.target.id === params.id);
      if (archived) return { kind: "not_found" };
      const [node] = await deps.db.select().from(graphNodes).where(and(
        eq(graphNodes.citySlug, params.citySlug), eq(graphNodes.type, params.type),
        eq(graphNodes.id, params.id)));
      if (!node) return { kind: "not_found" };
      const [card] = await buildScopedSignalCards({ store: deps.store, docEnrichmentBudgetMs: 2000,
        onDegraded: () => console.error("[reader-op] documents.pv.v1 card degraded"),
        onRefFailed: () => console.error("[reader-op] documents.pv.v1 doc-ref enrichment failed") },
      [node], params.citySlug);
      const matches = new Map<string, string | null>();
      for (const ref of card?.docRefs ?? []) {
        if (typeof ref.rawRef !== "string") continue;
        const rawRef = normalizeRawRef(ref.rawRef);
        if (rawRef === null) continue;
        if (ref.docSha === params.docSha || docShaFromRawRef(rawRef) === params.docSha) {
          matches.set(rawRef, matches.get(rawRef) ?? ref.sourceUrl ?? null);
        }
      }
      // Zero or several distinct storage keys: same closed 404 (never a guess).
      if (matches.size !== 1) return { kind: "not_found" };
      const [rawRef, sourceUrl] = [...matches.entries()][0]!;
      const read = await deps.readRaw(rawRef, sourceUrl);
      if (read.kind === "not_found") return { kind: "not_found" };
      if (read.kind === "too_large") return { kind: "too_large" };
      if (!read.contentType.toLowerCase().startsWith("application/pdf") || !isPdfBytes(read.bytes)) {
        return { kind: "unsupported_media" };
      }
      return { kind: "pdf", bytes: read.bytes };
    } catch (error) {
      if (error instanceof WorkspaceError || error instanceof ScopeError || error instanceof FacetError) {
        if (error.status === 404) return { kind: "not_found" };
        return { kind: "refused", cause: error };
      }
      throw error;
    }
  };
}
