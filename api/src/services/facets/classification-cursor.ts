import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { Hash } from "./classification-query.js";
import { canonicalJson } from "./target.js";
import { ClassificationError } from "./classification-errors.js";

const keyId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const CursorPayload = z.object({ v: z.literal(1),
  purpose: z.enum(["signal-search", "lot-search", "signal-history", "lot-history"]),
  contextDigest: Hash, queryDigest: Hash, snapshotToken: Hash, position: integer,
  limit: z.number().int().min(1).max(100), issuedAt: integer, expiresAt: integer, keyId,
}).strict().refine((value) => value.expiresAt - value.issuedAt === 300);
export type CursorData = z.infer<typeof CursorPayload>;
export interface CursorKeyring { currentKeyId: string; keys: ReadonlyMap<string, Buffer> }
export function requireCursorKeyring(ring?: CursorKeyring): CursorKeyring {
  if (!ring || !keyId.safeParse(ring.currentKeyId).success || !ring.keys.has(ring.currentKeyId)
    || [...ring.keys].some(([id, key]) => !keyId.safeParse(id).success || !Buffer.isBuffer(key) || key.length < 32)) {
    throw new ClassificationError("transport_unavailable");
  }
  return ring;
}
function hmac(ring: CursorKeyring, id: string, text: string) {
  const key = ring.keys.get(id);
  if (!key) throw new ClassificationError("invalid_cursor");
  return createHmac("sha256", key).update(text).digest();
}
export function cursorContext(ring: CursorKeyring, sub: string, workspaceId: string, citySlug: string, id = ring.currentKeyId) {
  return hmac(ring, id, canonicalJson({ purpose: "classification-context-v1", sub,
    workspaceId: workspaceId.toLowerCase(), citySlug, mode: "signal" })).toString("hex");
}
export function signClassificationCursor(ring: CursorKeyring, payload: CursorData): string {
  const data = CursorPayload.parse(payload);
  const encoded = Buffer.from(canonicalJson(data)).toString("base64url");
  return `${encoded}.${hmac(ring, data.keyId, encoded).toString("base64url")}`;
}
export function parseClassificationCursor(ring: CursorKeyring, cursor: string): CursorData {
  if (Buffer.byteLength(cursor) > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(cursor)) {
    throw new ClassificationError("invalid_cursor");
  }
  const [encoded, signature] = cursor.split(".") as [string, string];
  let payload: CursorData;
  try { payload = CursorPayload.parse(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))); }
  catch { throw new ClassificationError("invalid_cursor"); }
  const expected = hmac(ring, payload.keyId, encoded);
  const actual = Buffer.from(signature, "base64url");
  if (actual.toString("base64url") !== signature || actual.length !== expected.length || !timingSafeEqual(expected, actual)
    || Buffer.from(canonicalJson(payload)).toString("base64url") !== encoded) throw new ClassificationError("invalid_cursor");
  return payload;
}
