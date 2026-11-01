import type { GeoRouteState, GeoRouteTarget } from "../router/geo-route.js";
import type { DemoView } from "../demo/views.js";
export const CONTEXT_SCHEMA = "immo.ui.context";
export const SESSION_SCHEMA = "immo.ui.session";
export const SCHEMA_VERSION = "1.0.0";
export const SESSION_KEY = "immo.ui.session.v1";
export const CONTEXT_PREFIX = "immo.ui.context.v1.";
export const MAX_CONTEXT_BYTES = 32 * 1024;
export const MAX_CONTEXTS = 32;
export const CONTEXT_TTL = 24 * 60 * 60 * 1000;
export const CONTEXT_DEBOUNCE = 250;
type WithoutState<T> = T extends unknown ? Omit<T, "state"> : never;
export type ContextTarget = { kind: "page"; view: DemoView }
  | { kind: "geo"; route: WithoutState<GeoRouteTarget> };
export interface ContextPayload { target: ContextTarget; state: GeoRouteState; partial: boolean }
export interface UiSession {
  schema: typeof SESSION_SCHEMA;
  schemaVersion: typeof SCHEMA_VERSION;
  partition: string;
  sessionEpoch: string;
  invalidated: boolean;
}
export interface UiContext {
  schema: typeof CONTEXT_SCHEMA;
  schemaVersion: typeof SCHEMA_VERSION;
  partition: string;
  sessionEpoch: string;
  workspaceId: string;
  tabId: string;
  revision: number;
  savedAt: number;
  expiresAt: number;
  payload: ContextPayload;
}
export interface SyncDependencies {
  storage: Storage | null;
  origin: string;
  snapshot(): { workspaceId: string; payload: ContextPayload } | null;
  revalidate(invalidated?: boolean): void;
  validateWorkspace(workspaceId: string, sub: string): Promise<boolean>;
  apply(workspaceId: string, payload: ContextPayload): void;
  notify?(key: string): void;
  now?: () => number;
  uuid?: () => string;
  partition?: typeof accountPartition;
}
export const contextKey = (c: Pick<UiContext, "partition" | "workspaceId" | "tabId">) =>
  `${CONTEXT_PREFIX}${c.partition}.${c.workspaceId}.${c.tabId}`;
/** Pseudonymous, not a security boundary against scripts on the UI origin. */
export async function accountPartition(origin: string, sub: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${origin}\u0000${sub}`);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (v) => v.toString(16).padStart(2, "0")).join("");
}
