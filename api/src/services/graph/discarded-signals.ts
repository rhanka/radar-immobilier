/**
 * LOT 2 — discarded-signal predicate, no storage. A discarded signal is
 * keyed by its NATIVE triple `(city_slug, type, id)` built verbatim via
 * `discardedSignalKey` (never a `gn-` prefix, never a legacy UUID); a node
 * recreated with the same triple stays discarded. The per-viewer set comes
 * from the injected port; the default port is empty (no production effect).
 */

/** Encodes one native triple; parts are used verbatim, no prefix added. */
export function discardedSignalKey(
  citySlug: string | null | undefined,
  type: string,
  id: string,
): string {
  const sep = String.fromCharCode(0);
  return `${citySlug ?? ""}${sep}${type}${sep}${id}`;
}

/** Viewer identity. `null` = anonymous / open mode. */
export type DiscardedViewer = string | null;

/** Injected port; implementations must return native keys only. */
export interface DiscardedSignalsPort {
  forViewer(viewer: DiscardedViewer): ReadonlySet<string>;
}

const EMPTY_SET: ReadonlySet<string> = new Set<string>();

/** Default port: empty for every viewer. */
export const EMPTY_DISCARDED_SIGNALS: DiscardedSignalsPort = {
  forViewer: () => EMPTY_SET,
};

/** Minimal native identity shared by projection rows and served nodes. */
export interface DiscardableSignal {
  citySlug: string | null;
  type: string;
  id: string;
}

/**
 * Remove discarded entries. Pure: the filtered set aggregates and renders
 * exactly like the dataset without those entries (ranking, B classification
 * and `exclusion_reason` of kept signals unchanged).
 */
export function filterDiscardedSignals<T extends DiscardableSignal>(
  items: readonly T[],
  discarded: ReadonlySet<string>,
): T[] {
  if (discarded.size === 0) return [...items];
  return items.filter(
    (item) => !discarded.has(discardedSignalKey(item.citySlug, item.type, item.id)),
  );
}

/**
 * Viewer from the request session set by the `protect` middleware
 * (`c.get("session")`): the session `sub`, else `null` (open mode / tests).
 */
export function resolveGraphSignalsViewer(context: unknown): DiscardedViewer {
  const get = (context as { get?: unknown } | null | undefined)?.get;
  if (typeof get !== "function") return null;
  let session: unknown;
  try {
    session = (get as (key: string) => unknown).call(context, "session");
  } catch {
    return null;
  }
  if (typeof session !== "object" || session === null) return null;
  const sub = (session as Record<string, unknown>).sub;
  return typeof sub === "string" && sub.length > 0 ? sub : null;
}
