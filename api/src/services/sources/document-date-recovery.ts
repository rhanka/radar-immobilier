import { resolveDocumentDate, type DocumentDate } from "@radar/sources";

import { normalizeRawRef, type DocumentMetadata } from "./document-resolver.js";

/**
 * Stock recovery of documentary dates on the refs of an already-published city graph.
 *
 * Deterministic, no model call: each ref that names a raw document (`rawRef`) receives
 * - `fetchedAt` (collection instant) from the raw sidecar when the ref has none;
 * - `documentDate` + `publishedAt` mirror from the sidecar (`resolveDocumentDate`, which keeps
 *   status, precision, kind, method and evidence) when the ref has no documentary date yet.
 *
 * A value already present on a ref is never overwritten. A present value that disagrees with
 * the sidecar is reported as a conflict and kept as is. A ref whose `docSha` differs from the
 * sidecar identity is left untouched (identity conflict). Re-running on the output is a no-op.
 */

export type MetadataLookup = (rawRef: string) => Promise<DocumentMetadata | null>;

export interface DocumentDateRecoveryConflict {
  readonly entityId: string;
  readonly rawRef: string;
  readonly field: "fetchedAt" | "documentDate" | "docSha";
  readonly current: unknown;
  readonly metadata: unknown;
}

export interface DocumentDateRecoveryStats {
  /** Refs carrying a usable `rawRef` (nodes, edges, links; root and nested refs). */
  refs: number;
  refsUpdated: number;
  fetchedAtAdded: number;
  documentDateAdded: number;
  /** Refs whose rawRef has no readable sidecar. */
  refsWithoutMetadata: number;
  /** After recovery: refs still without a known day-precision documentary date. */
  refsWithoutDocumentDate: number;
  /** After recovery: refs still without fetchedAt. */
  refsWithoutFetchedAt: number;
  conflicts: number;
  /** Distinct raw documents whose metadata was projected on at least one ref. */
  documentsUpdated: number;
  /** Signal-type nodes (Signal, DesignationEvent). */
  signals: number;
  signalsUpdated: number;
  /** After recovery: signals without any ref documentary day (document basis needs the stage fallback). */
  signalsWithoutDocumentDate: number;
  /** After recovery: signals without any ref fetchedAt (invisible in a bounded scrape window). */
  signalsWithoutFetchedAt: number;
}

export interface DocumentDateRecoveryPlan {
  readonly nextGraph: Record<string, unknown>;
  readonly changed: boolean;
  readonly stats: DocumentDateRecoveryStats;
  readonly conflicts: DocumentDateRecoveryConflict[];
  readonly updatedSignalIds: string[];
}

/** Every rawRef cited by a graph (nodes, edges, links; root and nested refs). */
export function collectGraphRawRefs(graph: Record<string, unknown>): string[] {
  const out = new Set<string>();
  const visitRefs = (refs: unknown) => {
    if (!Array.isArray(refs)) return;
    for (const ref of refs) {
      const value = ref && typeof ref === "object" ? (ref as Record<string, unknown>)["rawRef"] : undefined;
      const rawRef = typeof value === "string" ? normalizeRawRef(value) : null;
      if (rawRef) out.add(rawRef);
    }
  };
  for (const key of ["nodes", "edges", "links"]) {
    const list = graph[key];
    if (!Array.isArray(list)) continue;
    for (const entity of list) {
      if (!entity || typeof entity !== "object") continue;
      const value = entity as Record<string, unknown>;
      visitRefs(value["refs"]);
      const properties = value["properties"];
      if (properties && typeof properties === "object") visitRefs((properties as Record<string, unknown>)["refs"]);
    }
  }
  return [...out];
}

const SIGNAL_NODE_TYPES = new Set(["Signal", "DesignationEvent"]);

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function emptyRecoveryStats(): DocumentDateRecoveryStats {
  return { refs: 0, refsUpdated: 0, fetchedAtAdded: 0, documentDateAdded: 0, refsWithoutMetadata: 0,
    refsWithoutDocumentDate: 0, refsWithoutFetchedAt: 0, conflicts: 0, documentsUpdated: 0,
    signals: 0, signalsUpdated: 0, signalsWithoutDocumentDate: 0, signalsWithoutFetchedAt: 0 };
}

export function addRecoveryStats(total: DocumentDateRecoveryStats, add: DocumentDateRecoveryStats): void {
  for (const key of Object.keys(total) as (keyof DocumentDateRecoveryStats)[]) total[key] += add[key];
}

/** An explicit `unknown` status is not a date: it may be completed, never a known/ambiguous value. */
function hasDocumentDate(ref: Record<string, unknown>): boolean {
  return resolveDocumentDate(ref).status !== "unknown"
    || (typeof ref["publishedAt"] === "string" && ref["publishedAt"] !== "");
}

function isKnownDay(date: DocumentDate): boolean {
  return date.status === "known" && date.precision === "day";
}

function sameDocumentDate(current: DocumentDate, metadata: DocumentDate): boolean {
  if (current.status !== "known" || metadata.status !== "known") return current.status === metadata.status;
  return current.value === metadata.value;
}

interface RefOutcome {
  readonly ref: unknown;
  readonly changed: boolean;
  readonly hasDay: boolean;
  readonly hasFetchedAt: boolean;
}

/** Plan the recovery of one published city graph (pure apart from metadata reads). */
export async function planGraphDocumentDateRecovery(graph: Record<string, unknown>,
  metadataFor: MetadataLookup): Promise<DocumentDateRecoveryPlan> {
  const stats = emptyRecoveryStats();
  const conflicts: DocumentDateRecoveryConflict[] = [];
  const updatedDocuments = new Set<string>();
  const updatedSignalIds: string[] = [];

  async function recoverRef(entityId: string, value: unknown): Promise<RefOutcome> {
    const ref = record(value);
    const rawRefValue = ref?.["rawRef"];
    const rawRef = typeof rawRefValue === "string" ? normalizeRawRef(rawRefValue) : null;
    if (!ref || !rawRef) {
      const date = ref ? resolveDocumentDate(ref) : { status: "unknown" as const };
      return { ref: value, changed: false, hasDay: isKnownDay(date),
        hasFetchedAt: typeof ref?.["fetchedAt"] === "string" };
    }
    stats.refs += 1;
    const metadata = await metadataFor(rawRef);
    const finish = (out: Record<string, unknown>, changed: boolean): RefOutcome => {
      const date = resolveDocumentDate(out);
      const hasDay = isKnownDay(date);
      const hasFetchedAt = typeof out["fetchedAt"] === "string";
      if (!hasDay) stats.refsWithoutDocumentDate += 1;
      if (!hasFetchedAt) stats.refsWithoutFetchedAt += 1;
      return { ref: changed ? out : value, changed, hasDay, hasFetchedAt };
    };
    if (!metadata || metadata.rawRef !== rawRef) {
      stats.refsWithoutMetadata += 1;
      return finish(ref, false);
    }
    const docSha = ref["docSha"];
    if (typeof docSha === "string" && docSha !== "" && docSha !== metadata.docSha) {
      stats.conflicts += 1;
      conflicts.push({ entityId, rawRef, field: "docSha", current: docSha, metadata: metadata.docSha });
      return finish(ref, false);
    }
    const out: Record<string, unknown> = { ...ref };
    let changed = false;
    if (ref["fetchedAt"] === undefined) {
      out["fetchedAt"] = metadata.fetchedAt;
      stats.fetchedAtAdded += 1;
      changed = true;
    } else if (ref["fetchedAt"] !== metadata.fetchedAt) {
      stats.conflicts += 1;
      conflicts.push({ entityId, rawRef, field: "fetchedAt", current: ref["fetchedAt"], metadata: metadata.fetchedAt });
    }
    if (!hasDocumentDate(ref)) {
      if (metadata.documentDate.status === "known") {
        out["documentDate"] = metadata.documentDate;
        out["publishedAt"] = metadata.documentDate.value;
        stats.documentDateAdded += 1;
        changed = true;
      }
    } else if (metadata.documentDate.status !== "unknown"
      && !sameDocumentDate(resolveDocumentDate(ref), metadata.documentDate)) {
      stats.conflicts += 1;
      conflicts.push({ entityId, rawRef, field: "documentDate",
        current: ref["documentDate"] ?? ref["publishedAt"], metadata: metadata.documentDate });
    }
    if (changed) {
      stats.refsUpdated += 1;
      updatedDocuments.add(rawRef);
    }
    return finish(out, changed);
  }

  async function recoverRefs(entityId: string, refs: unknown) {
    if (!Array.isArray(refs)) return { refs, changed: false, outcomes: [] as RefOutcome[] };
    const outcomes: RefOutcome[] = [];
    for (const ref of refs) outcomes.push(await recoverRef(entityId, ref));
    return { refs: outcomes.map((outcome) => outcome.ref), changed: outcomes.some((o) => o.changed), outcomes };
  }

  async function recoverEntity(entity: unknown, isSignal: (value: Record<string, unknown>) => boolean) {
    const value = record(entity);
    if (!value) return { entity, changed: false };
    const id = typeof value["id"] === "string" ? value["id"]
      : `${String(value["source"] ?? "?")}->${String(value["target"] ?? "?")}`;
    const root = await recoverRefs(id, value["refs"]);
    const properties = record(value["properties"]);
    const nested = properties ? await recoverRefs(id, properties["refs"]) : null;
    const changed = root.changed || (nested?.changed ?? false);
    if (isSignal(value)) {
      const outcomes = [...root.outcomes, ...(nested?.outcomes ?? [])];
      stats.signals += 1;
      if (changed) { stats.signalsUpdated += 1; updatedSignalIds.push(id); }
      if (!outcomes.some((o) => o.hasDay)) stats.signalsWithoutDocumentDate += 1;
      if (!outcomes.some((o) => o.hasFetchedAt)) stats.signalsWithoutFetchedAt += 1;
    }
    if (!changed) return { entity, changed: false };
    return { entity: { ...value, ...(root.changed ? { refs: root.refs } : {}),
      ...(nested?.changed && properties ? { properties: { ...properties, refs: nested.refs } } : {}) },
    changed: true };
  }

  const nodeType = (value: Record<string, unknown>) => {
    const type = value["type"] ?? value["file_type"];
    return typeof type === "string" && SIGNAL_NODE_TYPES.has(type);
  };
  let changed = false;
  const next: Record<string, unknown> = { ...graph };
  for (const [key, isSignal] of [["nodes", nodeType], ["edges", () => false], ["links", () => false]] as const) {
    const list = graph[key];
    if (!Array.isArray(list)) continue;
    const out: unknown[] = [];
    let listChanged = false;
    for (const entity of list) {
      const result = await recoverEntity(entity, isSignal);
      out.push(result.entity);
      listChanged ||= result.changed;
    }
    if (listChanged) { next[key] = out; changed = true; }
  }
  stats.documentsUpdated = updatedDocuments.size;
  return { nextGraph: changed ? next : graph, changed, stats, conflicts, updatedSignalIds };
}
