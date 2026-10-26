/**
 * PW-A application CSRF: stateless v1 token bound to the application
 * origin, the canonical principal, the presented cookie, and the intent.
 * No store, no session family; the OIDC flow cookie stays login-only.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { PwPrincipal } from "../services/facets/pw-write-digests.js";
import type { PwIdentityDomain } from "./write-intent-principal.js";

function hkdfCsrfKey(sessionSecret: string, domain: PwIdentityDomain): Buffer {
  const salt = Buffer.alloc(0);
  const info = Buffer.from(`radar-pw-csrf-v1${JSON.stringify([
    domain.identityIssuer, domain.tier, domain.appOrigin, domain.clientId])}`, "utf8");
  const prk = createHmac("sha256", salt).update(sessionSecret, "utf8").digest();
  const okm = createHmac("sha256", prk).update(Buffer.concat([info, Buffer.from([1])])).digest();
  return okm;
}

function canonicalCsrf(domain: PwIdentityDomain, principal: PwPrincipal,
  cookieHash: string, intentId: string, expiresAtSec: number): string {
  return JSON.stringify(["pw-csrf-v1", domain.appOrigin,
    [principal.issuer, principal.sub, principal.tier], cookieHash,
    intentId.toLowerCase(), expiresAtSec]);
}

/** Issue a <=512 byte token; expiry is min(issue+600 s, session.exp). */
export function issueWriteIntentCsrf(args: {
  domain: PwIdentityDomain; principal: PwPrincipal; rawCookie: string;
  intentId: string; issuedAtMs: number; sessionExpSec: number; sessionSecret: string;
}): string {
  const expiresAtSec = Math.min(
    Math.floor(args.issuedAtMs / 1000) + 600, args.sessionExpSec);
  const cookieHash = createHash("sha256").update(args.rawCookie, "utf8").digest("hex");
  const mac = createHmac("sha256", hkdfCsrfKey(args.sessionSecret, args.domain))
    .update(canonicalCsrf(args.domain, args.principal, cookieHash,
      args.intentId, expiresAtSec), "utf8").digest("hex");
  const token = `v1.${expiresAtSec}.${mac}`;
  if (token.length > 512) throw new Error("csrf token exceeds budget");
  return token;
}

/** Verify binding, format, and expiry with a constant-time MAC compare. */
export function verifyWriteIntentCsrf(args: {
  token: string; domain: PwIdentityDomain; principal: PwPrincipal;
  rawCookie: string; intentId: string; nowMs: number; sessionSecret: string;
}): boolean {
  if (args.token.length > 512 || !/^v1\.[1-9][0-9]*\.[a-f0-9]{64}$/.test(args.token)) return false;
  const parts = args.token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const expiresAtSec = Number(parts[1]);
  if (!Number.isSafeInteger(expiresAtSec) || expiresAtSec * 1000 <= args.nowMs) return false;
  const cookieHash = createHash("sha256").update(args.rawCookie, "utf8").digest("hex");
  const mac = createHmac("sha256", hkdfCsrfKey(args.sessionSecret, args.domain))
    .update(canonicalCsrf(args.domain, args.principal, cookieHash,
      args.intentId, expiresAtSec), "utf8").digest("hex");
  const seen = parts[2] ?? "";
  if (seen.length !== mac.length) return false;
  return timingSafeEqual(Buffer.from(seen, "utf8"), Buffer.from(mac, "utf8"));
}
