import type { ObjectStore } from "../../storage/object-store.js";
import type { RefreshModelReceipt } from "./refresh-model-policy.js";
import { canonicalHash, canonicalJson } from "./replay/canonical-json.js";

export interface RefreshRunIdentity {
  readonly citySlug: string;
  readonly inputHash: string;
  readonly baselineHash: string;
  readonly profileHash: string;
  readonly registryHash: string;
  readonly packageVersion: string;
  readonly modelPolicy: string;
  readonly exclusions: readonly string[];
}

export type RefreshStage =
  | "corpus"
  | "profile"
  | "candidate"
  | "enriched"
  | "published"
  | "projected";

export interface RefreshStageReceipt {
  readonly stage: RefreshStage;
  readonly status: "completed" | "failed";
  readonly artifactHash?: string;
  readonly reason?: string;
  readonly recordedAt: string;
}

export interface RefreshState {
  readonly schemaVersion: 1;
  readonly createdAt: string;
  readonly identity: RefreshRunIdentity;
  readonly identityHash: string;
  readonly budgetLimit: number;
  readonly reservedCalls: number;
  readonly reservations: Readonly<Record<string, number>>;
  readonly completedChunks: Readonly<Record<string, { readonly key: string; readonly hash: string }>>;
  readonly receipts: Readonly<Partial<Record<RefreshStage, RefreshStageReceipt>>>;
  readonly documentModels?: Readonly<Record<string, readonly (RefreshModelReceipt & { readonly chunkId: string })[]>>;
  readonly candidate?: { readonly key: string; readonly hash: string };
}

export interface RefreshStateHandle {
  readonly key: string;
  readonly state: RefreshState;
}

export async function recordRefreshModel(store: ObjectStore, handle: RefreshStateHandle,
  docSha: string, chunkId: string, receipt: RefreshModelReceipt): Promise<RefreshStateHandle> {
  if (!/^[0-9a-f]{64}$/.test(docSha)) throw new Error("Invalid refresh document hash");
  return persist(store, handle.key, { ...handle.state, documentModels: {
    ...handle.state.documentModels,
    [docSha]: [...(handle.state.documentModels?.[docSha] ?? []), { ...receipt, chunkId }],
  } });
}

/** A run's identity minus the baseline it happened to start from. */
export type RefreshScopeSelector = Omit<RefreshRunIdentity, "baselineHash">;

export type RefreshPublishedSelector = RefreshScopeSelector & {
  readonly publishedHash: string;
};

function scopeHash(scope: RefreshScopeSelector): string {
  return canonicalHash({ ...scope, exclusions: [...scope.exclusions].sort() });
}

function stateKey(identity: RefreshRunIdentity): string {
  const digest = canonicalHash({ ...identity, exclusions: [...identity.exclusions].sort() }).slice(7);
  return `refresh/018/${identity.citySlug}/runs/${digest}/state.json`;
}

async function persist(store: ObjectStore, key: string, state: RefreshState): Promise<RefreshStateHandle> {
  await store.put(key, canonicalJson(state), "application/json");
  return { key, state };
}

function parseState(bytes: Uint8Array, identity: RefreshRunIdentity, key: string): RefreshState {
  const state = JSON.parse(new TextDecoder().decode(bytes)) as RefreshState;
  if (state.schemaVersion !== 1 || state.identityHash !== canonicalHash({
    ...identity,
    exclusions: [...identity.exclusions].sort(),
  })) throw new Error(`Refresh state identity mismatch at ${key}`);
  return state;
}

export async function openRefreshState(
  store: ObjectStore,
  identity: RefreshRunIdentity,
  budgetLimit: number,
  now: () => Date = () => new Date(),
): Promise<RefreshStateHandle> {
  if (!Number.isInteger(budgetLimit) || budgetLimit < 1) throw new Error("Refresh budget must be positive");
  const normalized = { ...identity, exclusions: [...identity.exclusions].sort() };
  const identityHash = canonicalHash(normalized);
  const key = stateKey(normalized);
  if (await store.head(key)) {
    const state = parseState(await store.get(key), normalized, key);
    if (state.budgetLimit !== budgetLimit) throw new Error("Refresh budget differs from durable state");
    return { key, state };
  }
  return persist(store, key, {
    schemaVersion: 1,
    createdAt: now().toISOString(),
    identity: normalized,
    identityHash,
    budgetLimit,
    reservedCalls: 0,
    reservations: {},
    completedChunks: {},
    receipts: {},
  });
}

/**
 * Read every durable run state of one city, in one LIST plus one GET per state.
 *
 * A city is asked about its whole history once per cycle, then matched in
 * memory as many times as it has candidate documents. Doing the LIST inside the
 * per-candidate match would make the S3 cost quadratic in the number of
 * documents a city accumulates, on every city, every day.
 */
export async function readRefreshStates(
  store: ObjectStore,
  citySlug: string,
): Promise<readonly RefreshStateHandle[]> {
  if (!store.list) return [];
  const keys = (await store.list(`refresh/018/${citySlug}/runs/`))
    .filter((key) => key.endsWith("/state.json"));
  const handles: RefreshStateHandle[] = [];
  for (const key of keys) {
    const state = JSON.parse(new TextDecoder().decode(await store.get(key))) as RefreshState;
    const validIdentity = state.schemaVersion === 1 && state.identityHash === canonicalHash({
      ...state.identity, exclusions: [...state.identity.exclusions].sort(),
    });
    if (validIdentity) handles.push({ key, state });
  }
  return handles;
}

/** Match an already-read set of run states; the pure half of {@link findPublishedRefreshState}. */
export function matchPublishedRefreshState(
  states: readonly RefreshStateHandle[],
  selector: RefreshPublishedSelector,
): RefreshStateHandle | null {
  const { publishedHash, ...scope } = selector;
  const expectedScope = scopeHash(scope);
  const matches = states.filter(({ state }) => {
    const { baselineHash: _baselineHash, ...candidate } = state.identity;
    return canonicalHash(candidate) === expectedScope
      && state.receipts.published?.status === "completed"
      && state.receipts.published.artifactHash === publishedHash;
  });
  if (matches.length > 1) throw new Error("Ambiguous published refresh state");
  return matches[0] ?? null;
}

/**
 * Was this exact document already extracted AND projected for this city under
 * this configuration — whatever the canonical baseline happened to be that day?
 *
 * This is the refresh's memory of work that does not need doing again, and it is
 * deliberately NOT tied to the current baseline. A document's extraction depends
 * on the document's own text, never on the baseline, which only takes part in the
 * later merge. Tying the memory to the baseline would make every publication
 * invalidate the memory of every OTHER document of the same city, so a city with
 * two pending documents would extract them alternately, for ever, at full model
 * price. A completed projection is the durable proof that a document's signals
 * already reached Postgres.
 */
export function matchProjectedRefreshState(
  states: readonly RefreshStateHandle[],
  scope: RefreshScopeSelector,
): RefreshStateHandle | null {
  const expectedScope = scopeHash(scope);
  return states.find(({ state }) => {
    const { baselineHash: _baselineHash, ...candidate } = state.identity;
    return canonicalHash(candidate) === expectedScope
      && state.receipts.projected?.status === "completed";
  }) ?? null;
}

/** Find a prior run whose own published bytes are still canonical for this input/config. */
export async function findPublishedRefreshState(
  store: ObjectStore,
  selector: RefreshPublishedSelector,
): Promise<RefreshStateHandle | null> {
  return matchPublishedRefreshState(await readRefreshStates(store, selector.citySlug), selector);
}

export async function reserveRefreshChunk(
  store: ObjectStore,
  handle: RefreshStateHandle,
  chunkId: string,
  maximumAttempts: number,
): Promise<RefreshStateHandle & { readonly shouldCall: boolean }> {
  if (handle.state.completedChunks[chunkId]) return { ...handle, shouldCall: false };
  if (!chunkId || !Number.isInteger(maximumAttempts) || maximumAttempts < 1) {
    throw new Error("Invalid refresh chunk reservation");
  }
  const reservedCalls = handle.state.reservedCalls + maximumAttempts;
  if (reservedCalls > handle.state.budgetLimit) throw new Error("Refresh call budget exhausted");
  const state: RefreshState = {
    ...handle.state,
    reservedCalls,
    reservations: {
      ...handle.state.reservations,
      [chunkId]: (handle.state.reservations[chunkId] ?? 0) + maximumAttempts,
    },
  };
  return { ...await persist(store, handle.key, state), shouldCall: true };
}

export async function completeRefreshChunk(
  store: ObjectStore,
  handle: RefreshStateHandle,
  chunkId: string,
  output: unknown,
): Promise<RefreshStateHandle> {
  if (!handle.state.reservations[chunkId]) throw new Error(`Chunk ${chunkId} was not reserved`);
  if (!/^[a-zA-Z0-9._-]+$/.test(chunkId)) throw new Error("Invalid refresh chunk identifier");
  const hash = canonicalHash(output);
  const key = handle.key.replace(/state\.json$/, `chunks/${chunkId}-${hash.slice(7)}.json`);
  await store.put(key, canonicalJson(output), "application/json");
  return persist(store, handle.key, {
    ...handle.state,
    completedChunks: { ...handle.state.completedChunks, [chunkId]: { key, hash } },
  });
}

export async function readCompletedRefreshChunk<T>(
  store: ObjectStore,
  handle: RefreshStateHandle,
  chunkId: string,
): Promise<T> {
  const completed = handle.state.completedChunks[chunkId];
  if (!completed) throw new Error(`Chunk ${chunkId} is not complete`);
  const output = JSON.parse(new TextDecoder().decode(await store.get(completed.key))) as T;
  if (canonicalHash(output) !== completed.hash) throw new Error(`Completed chunk ${chunkId} hash mismatch`);
  return output;
}

export async function writeRefreshCandidate(
  store: ObjectStore,
  handle: RefreshStateHandle,
  candidate: unknown,
): Promise<RefreshStateHandle> {
  const body = canonicalJson(candidate);
  const hash = canonicalHash(candidate);
  if (handle.state.candidate && handle.state.candidate.hash !== hash) {
    throw new Error("Non-deterministic candidate for immutable refresh identity");
  }
  if (handle.state.candidate) return handle;
  const key = handle.key.replace(/state\.json$/, `candidate-${hash.slice(7)}.json`);
  await store.put(key, body, "application/json");
  return persist(store, handle.key, { ...handle.state, candidate: { key, hash } });
}

export async function writeRefreshStageReceipt(
  store: ObjectStore,
  handle: RefreshStateHandle,
  receipt: RefreshStageReceipt,
): Promise<RefreshStateHandle> {
  if (receipt.reason !== undefined && !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(receipt.reason)) {
    throw new Error("Refresh receipt reason must be a redacted reason code");
  }
  if (receipt.artifactHash !== undefined && !/^sha256:[0-9a-f]{64}$/.test(receipt.artifactHash)) {
    throw new Error("Refresh receipt artifact hash is invalid");
  }
  if (!Number.isFinite(Date.parse(receipt.recordedAt))) throw new Error("Refresh receipt timestamp is invalid");
  const key = handle.key.replace(/state\.json$/, `receipts/${receipt.stage}.json`);
  await store.put(key, canonicalJson(receipt), "application/json");
  return persist(store, handle.key, {
    ...handle.state,
    receipts: { ...handle.state.receipts, [receipt.stage]: receipt },
  });
}
