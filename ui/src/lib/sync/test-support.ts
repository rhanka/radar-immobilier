import { vi } from "vitest";
import { normalizeGeoRouteState } from "../router/geo-route.js";
import { CONTEXT_SCHEMA, CONTEXT_TTL, SCHEMA_VERSION, type UiContext } from "./ui-state-contract.js";
export const workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const partition = "a".repeat(64);
export function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return { get length() { return values.size; }, key: (i) => [...values.keys()][i] ?? null,
    getItem: vi.fn((key) => values.get(key) ?? null),
    setItem: vi.fn((key, value) => { values.set(key, value); }),
    removeItem: vi.fn((key) => { values.delete(key); }), clear: () => values.clear() };
}
let counter = 0;
export const uuid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
export function context(now = 1000): UiContext {
  return { schema: CONTEXT_SCHEMA, schemaVersion: SCHEMA_VERSION, partition,
    sessionEpoch: uuid(), workspaceId, tabId: uuid(), revision: 1, savedAt: now,
    expiresAt: now + CONTEXT_TTL, payload: { target: { kind: "page", view: "sources" },
      state: normalizeGeoRouteState(), partial: false } };
}
