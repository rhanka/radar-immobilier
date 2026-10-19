/**
 * LOT 2 — discarded-signal predicate, no storage. A discarded signal is
 * keyed by its NATIVE triple `(city_slug, type, id)` built verbatim via
 * `discardedSignalKey` (never a `gn-` prefix, never a legacy UUID); a node
 * recreated with the same triple stays discarded. The per-viewer set comes
 * from the injected port; the default port is empty (no production effect).
 */

/** Separator illegal in slugs/ids, so distinct triples never collide. */
const KEY_SEPARATOR = String.fromCharCode(0);

declare const discardedSignalBrand: unique symbol;

/** Branded native triple; only `discardedSignalKey` produces it. */
export type DiscardedSignalKey = string & {
  readonly [discardedSignalBrand]: "DiscardedSignalKey";
};

/** Encodes one native triple; parts are used verbatim, no prefix added. */
export function discardedSignalKey(
  citySlug: string,
  type: string,
  id: string,
): DiscardedSignalKey {
  return `${citySlug}${KEY_SEPARATOR}${type}${KEY_SEPARATOR}${id}` as DiscardedSignalKey;
}

/** Viewer identity. `null` = anonymous / open mode. */
export type DiscardedViewer = string | null;

/** Injected port; implementations must return native keys only. */
export interface DiscardedSignalsPort {
  forViewer(viewer: DiscardedViewer): Promise<ReadonlySet<DiscardedSignalKey>>;
}

/** The single shared empty key set (default port + reveal bypass). */
export const EMPTY_DISCARDED_KEYS: ReadonlySet<DiscardedSignalKey> =
  new Set<DiscardedSignalKey>();

/** Default port: empty for every viewer. */
export const EMPTY_DISCARDED_SIGNALS: DiscardedSignalsPort = {
  forViewer: async () => EMPTY_DISCARDED_KEYS,
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
 * and `exclusion_reason` of kept signals unchanged). Nodes without a city
 * carry no native triple and are never discarded.
 */
export function filterDiscardedSignals<T extends DiscardableSignal>(
  items: readonly T[],
  discarded: ReadonlySet<DiscardedSignalKey>,
): T[] {
  if (discarded.size === 0) return [...items];
  return items.filter((item) => {
    if (typeof item.citySlug !== "string" || item.citySlug.length === 0) return true;
    return !discarded.has(discardedSignalKey(item.citySlug, item.type, item.id));
  });
}
