export const BUCKET_KINDS = [
  "municipality",
  "signal",
  "zone",
  "lot",
] as const;

export type BucketKind = (typeof BUCKET_KINDS)[number];
export type SelectionKey = `${BucketKind}:${string}`;
export type BucketGeometryState = "present" | "missing" | "text-only";

export interface ParsedSelectionKey {
  kind: BucketKind;
  id: string;
}

export interface BucketEntity {
  key: SelectionKey;
  kind: BucketKind;
  id: string;
  label: string;
  parentKey: SelectionKey | null;
  childKeys: readonly SelectionKey[];
  geometryState: BucketGeometryState;
  meta?: Readonly<Record<string, unknown>>;
}

export interface SelectionBucketState {
  selectedKeys: ReadonlySet<SelectionKey>;
  focusedKey: SelectionKey | null;
  hoveredKey: SelectionKey | null;
  expandedKeys: ReadonlySet<SelectionKey>;
}

export interface SelectionVisualState {
  selected: boolean;
  focused: boolean;
  hovered: boolean;
  dimmed: boolean;
  opacity: number;
}

export const FULL_SELECTION_OPACITY = 1;
export const DIMMED_SELECTION_OPACITY = 0.5;

const BUCKET_KIND_SET = new Set<string>(BUCKET_KINDS);

export function makeKey(kind: BucketKind, id: string): SelectionKey {
  const normalizedId = id.trim();
  if (normalizedId.length === 0) {
    throw new Error(`Cannot build ${kind} selection key with an empty id`);
  }
  return `${kind}:${encodeURIComponent(normalizedId)}` as SelectionKey;
}

export function parseKey(key: string): ParsedSelectionKey | null {
  const separatorIndex = key.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === key.length - 1) {
    return null;
  }

  const kind = key.slice(0, separatorIndex);
  if (!BUCKET_KIND_SET.has(kind)) return null;

  try {
    const id = decodeURIComponent(key.slice(separatorIndex + 1));
    if (id.trim().length === 0) return null;
    return { kind: kind as BucketKind, id };
  } catch {
    return null;
  }
}

export function createSelectionBucketState(
  init: {
    selectedKeys?: Iterable<SelectionKey>;
    focusedKey?: SelectionKey | null;
    hoveredKey?: SelectionKey | null;
    expandedKeys?: Iterable<SelectionKey>;
  } = {},
): SelectionBucketState {
  return {
    selectedKeys: new Set(init.selectedKeys ?? []),
    focusedKey: init.focusedKey ?? null,
    hoveredKey: init.hoveredKey ?? null,
    expandedKeys: new Set(init.expandedKeys ?? []),
  };
}

export function toggleSelection(
  state: SelectionBucketState,
  key: SelectionKey,
): SelectionBucketState {
  if (state.selectedKeys.has(key)) return removeSelection(state, key);

  const selectedKeys = new Set(state.selectedKeys);
  selectedKeys.add(key);
  return { ...state, selectedKeys };
}

export function removeSelection(
  state: SelectionBucketState,
  key: SelectionKey,
): SelectionBucketState {
  if (!state.selectedKeys.has(key)) return state;

  const selectedKeys = new Set(state.selectedKeys);
  selectedKeys.delete(key);

  const expandedKeys = state.expandedKeys.has(key)
    ? removeFromReadonlySet(state.expandedKeys, key)
    : state.expandedKeys;

  return {
    ...state,
    selectedKeys,
    expandedKeys,
    focusedKey: state.focusedKey === key ? null : state.focusedKey,
    hoveredKey: state.hoveredKey === key ? null : state.hoveredKey,
  };
}

export function clearSelectionGroup(
  state: SelectionBucketState,
  kind: BucketKind,
): SelectionBucketState {
  const selectedKeys = filterKeysByKind(state.selectedKeys, kind);
  const expandedKeys = filterKeysByKind(state.expandedKeys, kind);
  const focusedKey = keyHasKind(state.focusedKey, kind) ? null : state.focusedKey;
  const hoveredKey = keyHasKind(state.hoveredKey, kind) ? null : state.hoveredKey;

  if (
    selectedKeys === state.selectedKeys &&
    expandedKeys === state.expandedKeys &&
    focusedKey === state.focusedKey &&
    hoveredKey === state.hoveredKey
  ) {
    return state;
  }

  return {
    ...state,
    selectedKeys,
    expandedKeys,
    focusedKey,
    hoveredKey,
  };
}

export function setFocus(
  state: SelectionBucketState,
  key: SelectionKey | null,
): SelectionBucketState {
  if (state.focusedKey === key) return state;
  return { ...state, focusedKey: key };
}

export function setHover(
  state: SelectionBucketState,
  key: SelectionKey | null,
): SelectionBucketState {
  if (state.hoveredKey === key) return state;
  return { ...state, hoveredKey: key };
}

export function toggleExpansion(
  state: SelectionBucketState,
  key: SelectionKey,
): SelectionBucketState {
  const expandedKeys = new Set(state.expandedKeys);
  if (expandedKeys.has(key)) {
    expandedKeys.delete(key);
  } else {
    expandedKeys.add(key);
  }
  return { ...state, expandedKeys };
}

export function deriveOpacity(
  state: Pick<SelectionBucketState, "selectedKeys">,
  key: SelectionKey,
): number {
  if (state.selectedKeys.size === 0) return FULL_SELECTION_OPACITY;
  return state.selectedKeys.has(key)
    ? FULL_SELECTION_OPACITY
    : DIMMED_SELECTION_OPACITY;
}

export function selectionVisualState(
  state: SelectionBucketState,
  key: SelectionKey,
): SelectionVisualState {
  const selected = state.selectedKeys.has(key);
  const opacity = deriveOpacity(state, key);
  return {
    selected,
    focused: state.focusedKey === key,
    hovered: state.hoveredKey === key,
    dimmed: opacity < FULL_SELECTION_OPACITY,
    opacity,
  };
}

function removeFromReadonlySet<T>(source: ReadonlySet<T>, value: T): ReadonlySet<T> {
  const next = new Set(source);
  next.delete(value);
  return next;
}

function filterKeysByKind(
  keys: ReadonlySet<SelectionKey>,
  kind: BucketKind,
): ReadonlySet<SelectionKey> {
  let changed = false;
  const next = new Set<SelectionKey>();
  for (const key of keys) {
    if (keyHasKind(key, kind)) {
      changed = true;
    } else {
      next.add(key);
    }
  }
  return changed ? next : keys;
}

function keyHasKind(key: SelectionKey | null, kind: BucketKind): boolean {
  if (!key) return false;
  return parseKey(key)?.kind === kind;
}
