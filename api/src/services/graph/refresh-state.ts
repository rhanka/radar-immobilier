import type { ObjectStore } from "../../storage/object-store.js";
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
  readonly identity: RefreshRunIdentity;
  readonly identityHash: string;
  readonly budgetLimit: number;
  readonly reservedCalls: number;
  readonly reservations: Readonly<Record<string, number>>;
  readonly completedChunks: Readonly<Record<string, string>>;
  readonly receipts: Readonly<Partial<Record<RefreshStage, RefreshStageReceipt>>>;
  readonly candidate?: { readonly key: string; readonly hash: string };
}

export interface RefreshStateHandle {
  readonly key: string;
  readonly state: RefreshState;
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
    identity: normalized,
    identityHash,
    budgetLimit,
    reservedCalls: 0,
    reservations: {},
    completedChunks: {},
    receipts: {},
  });
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
  outputHash: string,
): Promise<RefreshStateHandle> {
  if (!handle.state.reservations[chunkId]) throw new Error(`Chunk ${chunkId} was not reserved`);
  return persist(store, handle.key, {
    ...handle.state,
    completedChunks: { ...handle.state.completedChunks, [chunkId]: outputHash },
  });
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
