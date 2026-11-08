import type { LiveIdentity } from "@sentropic/artifacts";
import { ArtifactOperationError } from "@sentropic/artifacts/server/outcome-contract";

/**
 * Staging of the live draft toward the Sentropic builder (host-live-api.ts contract, 07/11):
 * `POST v1/live/draft/page` (0..31 pages) then `POST v1/live/draft/seal`, both answering 204,
 * BEFORE every `POST v1/live/reconcile`. The draft is an OVERLAY on `baseHeadSha`: changed files
 * travel in pages, removed paths in `deletes`; an empty overlay is `pages: 0, deletes: []` with
 * `treeSha = liveTreeSha`.
 */
export const DRAFT_LIMITS = Object.freeze({ paths: 255, fileBytes: 1024 * 1024, totalBytes: 8 * 1024 * 1024,
  pageBytes: 1024 * 1024, pages: 32 });

/** Overlay entry as the package stores it: `text: null` is a deletion, `mode` a git tree mode string. */
export interface StagedOverlayEntry { readonly path: string; readonly text: string | null; readonly mode: string }

/** Current durable draft of the package store (revision token, base head, live tree, overlay). */
export interface LiveDraftSnapshot {
  readonly revision: string;
  readonly baseHeadSha: string;
  readonly liveTreeSha: string;
  readonly overlay: readonly StagedOverlayEntry[];
}

/** Reads the current draft of a live identity; absent: nothing to stage (provider_unavailable). */
export interface LiveDraftSource { current(identity: LiveIdentity): Promise<LiveDraftSnapshot | undefined> }

export interface DraftPageFile { readonly path: string; readonly mode: number; readonly data: string }
export interface DraftPageBody {
  readonly artifactId: string; readonly bindingGeneration: number; readonly revision: string;
  readonly page: number; readonly files: readonly DraftPageFile[];
}
export interface DraftSealBody {
  readonly artifactId: string; readonly bindingGeneration: number; readonly revision: string;
  readonly pages: number; readonly baseHeadSha: string; readonly treeSha: string; readonly deletes: readonly string[];
}

const fail = (): never => { throw new ArtifactOperationError("provider_unavailable"); };

/** Splits a package overlay into wire pages and deletes, within the host DRAFT_LIMITS (else provider_unavailable). */
export function planDraft(draft: LiveDraftSnapshot, identity: LiveIdentity): { pages: DraftPageBody[]; seal: DraftSealBody } {
  const deletes: string[] = [];
  const pages: DraftPageBody[] = [];
  let files: DraftPageFile[] = [];
  let pageBytes = 0;
  let total = 0;
  const paths = new Set<string>();
  const flush = () => {
    if (!files.length) return;
    pages.push({ artifactId: identity.artifactId, bindingGeneration: identity.bindingGeneration, revision: draft.revision,
      page: pages.length, files });
    files = []; pageBytes = 0;
  };
  for (const entry of draft.overlay) {
    if (paths.has(entry.path)) fail();
    paths.add(entry.path);
    if (entry.text === null) { deletes.push(entry.path); continue; }
    const bytes = Buffer.from(entry.text, "utf8");
    if (bytes.byteLength > DRAFT_LIMITS.fileBytes) fail();
    total += bytes.byteLength;
    if (total > DRAFT_LIMITS.totalBytes) fail();
    if (files.length > 0 && (pageBytes + bytes.byteLength > DRAFT_LIMITS.pageBytes || files.length >= DRAFT_LIMITS.paths)) flush();
    files.push({ path: entry.path, mode: entry.mode.endsWith("755") ? 0o755 : 0o644, data: bytes.toString("base64") });
    pageBytes += bytes.byteLength;
  }
  flush();
  if (paths.size > DRAFT_LIMITS.paths || pages.length > DRAFT_LIMITS.pages) fail();
  return { pages, seal: { artifactId: identity.artifactId, bindingGeneration: identity.bindingGeneration, revision: draft.revision,
    pages: pages.length, baseHeadSha: draft.baseHeadSha, treeSha: draft.liveTreeSha, deletes } };
}

/**
 * Stages the draft: pages in order, then the seal. `send` posts one body and returns the HTTP status;
 * anything but 204 (or a transport error) is `provider_unavailable`.
 */
export async function stageLiveDraft(source: LiveDraftSource, identity: LiveIdentity,
  send: (path: string, body: unknown) => Promise<{ status: number }>): Promise<void> {
  const draft = await source.current(identity);
  if (!draft) fail();
  const plan = planDraft(draft!, identity);
  for (const page of plan.pages) {
    if ((await send("v1/live/draft/page", page)).status !== 204) fail();
  }
  if ((await send("v1/live/draft/seal", plan.seal)).status !== 204) fail();
}
