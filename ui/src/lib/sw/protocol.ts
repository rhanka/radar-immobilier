/** Coordination only: no values, credentials, URLs or operations on this wire. */
export const SW_PROTOCOL_VERSION = 1;
export const SW_SCRIPT_URL = "/immo-sw.js";
export const SW_SCOPE = "/";
export const SW_MAX_MESSAGE_BYTES = 8192;
export const SW_HANDSHAKE_TIMEOUT_MS = 1500;
export interface SwMessage {
  protocol: number;
  type: string;
  id: string;
  correlationId?: string;
  payload?: Record<string, unknown>;
}
export interface SwWorkerInfo { workerBuildId: string; protocolVersion: number }
export interface SwInvalidatePayload {
  scope: "signals" | "workspace" | "context";
  workspaceId?: string;
  citySlug?: string;
}
export const isUuidLike = (v: unknown): v is string => typeof v === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 128;
export const onlyKeys = (v: Record<string, unknown>, keys: string[]): boolean =>
  Object.keys(v).every((key) => keys.includes(key));

/** Local correlation identity, never a credential; works without secure APIs. */
export function createClientId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 15) | 64; bytes[8] = (bytes[8]! & 63) | 128;
  const s = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

export function validateSwMessage(raw: unknown, direction: "client" | "worker"): raw is SwMessage {
  if (!isRecord(raw) || !onlyKeys(raw, ["protocol", "type", "id", "correlationId", "payload"])
    || raw.protocol !== 1 || !text(raw.id) || !text(raw.type)
    || (raw.correlationId !== undefined && !text(raw.correlationId))) return false;
  try { if (new TextEncoder().encode(JSON.stringify(raw)).length > SW_MAX_MESSAGE_BYTES) return false; }
  catch { return false; }
  const p = raw.payload;
  if (direction === "client" && ["PING", "ACTIVATE_COMPATIBLE"].includes(raw.type)) return p === undefined;
  if (!isRecord(p)) return false;
  if (raw.type === "INVALIDATE") return onlyKeys(p, ["scope", "workspaceId", "citySlug"])
    && ["signals", "workspace", "context"].includes(String(p.scope))
    && (p.workspaceId === undefined || isUuidLike(p.workspaceId))
    && (p.citySlug === undefined || text(p.citySlug));
  if (raw.type === "SESSION_INVALIDATED") return onlyKeys(p, ["partition", "epoch"])
    && text(p.partition) && isUuidLike(p.epoch);
  if (direction === "client") return raw.type === "HELLO"
    && onlyKeys(p, ["clientBuildId", "tabId", "protocolVersion"])
    && text(p.clientBuildId) && isUuidLike(p.tabId) && Number.isInteger(p.protocolVersion);
  switch (raw.type) {
    case "HELLO": case "HELLO_ACK": case "PONG":
      return onlyKeys(p, ["workerBuildId", "protocolVersion"])
        && text(p.workerBuildId) && Number.isInteger(p.protocolVersion);
    case "DISABLED": return onlyKeys(p, ["workerBuildId"]) && text(p.workerBuildId);
    case "ACTIVATE_RESULT": return onlyKeys(p, ["ok", "reason"]) && typeof p.ok === "boolean"
      && (p.reason === undefined || text(p.reason));
    case "INVALIDATE_RELAYED": case "SESSION_INVALIDATED_RELAYED":
      return onlyKeys(p, ["relayedTo"]) && Number.isInteger(p.relayedTo) && Number(p.relayedTo) >= 0;
    case "ERROR": return onlyKeys(p, ["reason"]) && text(p.reason);
    default: return false;
  }
}
