/**
 * Classification cursor keyring loader (ARTEFACTS L3, relecture 2).
 *
 * searchSignalClassifications requires classification.cursorKeyring even
 * for the first page; without it every search fails with
 * transport_unavailable. The keyring is loaded from the environment so the
 * same key survives restarts and is shared by every instance:
 * - CLASSIFICATION_CURSOR_SECRET: 32+ byte secret, base64/base64url/hex
 * - CLASSIFICATION_CURSOR_KEY_ID: key identifier, [A-Za-z0-9_-]{1,64}
 *
 * Missing or invalid configuration resolves to undefined (closed): searches
 * keep failing closed with transport_unavailable instead of signing with an
 * ephemeral key that would invalidate continuations after restart.
 */
import type { CursorKeyring } from "../services/facets/classification-cursor.js";

export const CLASSIFICATION_CURSOR_SECRET_ENV = "CLASSIFICATION_CURSOR_SECRET";
export const CLASSIFICATION_CURSOR_KEY_ID_ENV = "CLASSIFICATION_CURSOR_KEY_ID";

const KEY_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function decodeSecret(raw: string): Buffer | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const hex = /^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0
    ? (() => { try { return Buffer.from(trimmed, "hex"); } catch { return null; } })()
    : null;
  if (hex && hex.length >= 32) return hex;
  for (const encoding of ["base64url", "base64"] as const) {
    try {
      if (!(encoding === "base64url" ? /^[A-Za-z0-9_-]+={0,2}$/ : /^[A-Za-z0-9+/]+={0,2}$/).test(trimmed)) continue;
      const bytes = Buffer.from(trimmed, encoding);
      if (bytes.length >= 32 && bytes.toString(encoding).replace(/=+$/, "") === trimmed.replace(/=+$/, "")) return bytes;
    } catch { /* try next encoding */ }
  }
  return null;
}

export function cursorKeyringFromParts(secret: string, keyId: string): CursorKeyring | undefined {
  if (!KEY_ID_RE.test(keyId)) return undefined;
  const key = decodeSecret(secret);
  if (!key) return undefined;
  return { currentKeyId: keyId, keys: new Map([[keyId, key]]) };
}

export function resolveReaderCursorKeyring(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): CursorKeyring | undefined {
  const secret = env[CLASSIFICATION_CURSOR_SECRET_ENV] ?? "";
  const keyId = (env[CLASSIFICATION_CURSOR_KEY_ID_ENV] ?? "").trim();
  if (secret === "" || keyId === "") return undefined;
  return cursorKeyringFromParts(secret, keyId);
}
