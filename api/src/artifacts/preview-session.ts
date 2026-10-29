/**
 * Isolated reader page cookies (ARTEFACTS A6/H5).
 *
 * Two separate `__Host-` cookies: `__Host-preview-init` (short anti-replay
 * marker for the exchange) and `__Host-preview-session` (AEAD page session).
 * Both are Secure, HttpOnly, Path=/, with no Domain. `radar_session` is
 * never used as the page session and publisher/MCP credentials never reach
 * custom content.
 */
import { openSession, sealSession } from "./preview-aead.js";
import type { GrantClaims } from "./preview-grant.js";
import type { PwIdentityDomain } from "./write-intent-principal.js";

export const PREVIEW_INIT_COOKIE = "__Host-preview-init";
export const PREVIEW_SESSION_COOKIE = "__Host-preview-session";
export const PREVIEW_SESSION_TTL_MS = 15 * 60_000;

export interface PreviewSessionClaims {
  /** Attributed at verified application approval, never inferred from a read grant. */
  readonly writeIdentity?: PwIdentityDomain;
  readonly sid: string;
  readonly readerSub: string;
  readonly artifactId: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  /** Native resources only: host/release-bound authority sealed by the host. */
  readonly resource?: GrantClaims;
}

function hostCookie(name: string, value: string, maxAgeSeconds: number): string {
  const cookie = `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
  if (!/^[A-Za-z0-9._-]+$/.test(value) || Buffer.byteLength(cookie) > 4096) throw new Error("Invalid preview cookie");
  return cookie;
}

export function parseCookieHeader(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

export function mintInitCookie(ticket: string): string {
  return hostCookie(PREVIEW_INIT_COOKIE, ticket, 60);
}

export function mintSessionCookie(claims: PreviewSessionClaims, secret: string): string {
  const sealed = sealSession(JSON.stringify(claims), secret);
  const maxAge = Math.max(1, Math.floor((claims.expiresAt - claims.createdAt) / 1000));
  return hostCookie(PREVIEW_SESSION_COOKIE, sealed, maxAge);
}

export function readSessionClaims(
  cookieHeader: string | null | undefined,
  secret: string,
  now: number,
): PreviewSessionClaims | null {
  const sealed = parseCookieHeader(cookieHeader, PREVIEW_SESSION_COOKIE);
  if (!sealed || sealed.length > 4096) return null;
  const raw = openSession(sealed, secret);
  if (!raw) return null;
  try {
    const claims = JSON.parse(raw) as PreviewSessionClaims;
    if (typeof claims.sid !== "string" || typeof claims.readerSub !== "string") return null;
    if (typeof claims.expiresAt !== "number" || claims.expiresAt <= now) return null;
    return claims;
  } catch {
    return null;
  }
}
