/**
 * AEAD page-session envelope (ARTEFACTS A6/H5).
 *
 * AES-256-GCM seal/open for the `__Host-preview-session` cookie value.
 * The key derives from the server session secret; tampered or re-keyed
 * values fail closed. Payloads stay small (no profile blobs inside).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const CONTEXT = "artefacts-h5-preview-session-v1";

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(CONTEXT).update(secret).digest();
}

export function sealSession(payload: string, secret: string): string {
  const key = deriveKey(secret);
  const nonce = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  const body = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${nonce.toString("base64url")}.${body.toString("base64url")}.${tag.toString("base64url")}`;
}

export function openSession(sealed: string, secret: string): string | null {
  try {
    const parts = sealed.split(".");
    if (parts.length !== 3) return null;
    const [nonceB64, bodyB64, tagB64] = parts as [string, string, string];
    const key = deriveKey(secret);
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(nonceB64, "base64url"), { authTagLength: 16 });
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    const body = Buffer.concat([
      decipher.update(Buffer.from(bodyB64, "base64url")),
      decipher.final(),
    ]);
    return body.toString("utf8");
  } catch {
    return null;
  }
}
