// Lot I1 — signed prod admission snapshots (converged R2 §2.6).
//
// Source of truth: prod `public.account_users`. The emitter builds a MINIMAL
// identity snapshot (email, name, status, role, dates — no business content,
// Loi 25 minimisation), signs it with Ed25519 (private key in prod ONLY, from
// the `radar-admission-signing` k8s Secret), and pushes it to the preprod
// ingest webhook. Preprod verifies the signature and rejects anything else.
//
// The preprod `sub` may differ from the prod `sub` (distinct IdP domains), so
// the snapshot carries NO sub at all: the join key is the email.

import {
  createPrivateKey,
  createPublicKey,
  createHash,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import { z } from "zod";

export const ADMISSION_SNAPSHOT_VERSION = 1;

/** Canonical signature context, domain-separating admission signatures. */
const SIGNATURE_CONTEXT = "radar-admission-snapshot-v1";

/** Prod account statuses mirrored by the snapshot. */
export const ADMISSION_STATUSES = ["pending", "approved", "rejected", "suspended"] as const;
export type AdmissionStatus = (typeof ADMISSION_STATUSES)[number];

/** Prod roles mirrored by the snapshot (`is_admin` → admin/member). */
export const ADMISSION_ROLES = ["admin", "member"] as const;
export type AdmissionRole = (typeof ADMISSION_ROLES)[number];

const IsoDateTime = z.string().datetime({ offset: true });

export const AdmissionEntrySchema = z.object({
  email: z.string().trim().min(3).max(320),
  name: z.string().max(320).nullable(),
  status: z.enum(ADMISSION_STATUSES),
  role: z.enum(ADMISSION_ROLES),
  createdAt: IsoDateTime.nullable(),
  approvedAt: IsoDateTime.nullable(),
});
export type AdmissionEntry = z.infer<typeof AdmissionEntrySchema>;

export const AdmissionPayloadSchema = z.object({
  version: z.literal(ADMISSION_SNAPSHOT_VERSION),
  kid: z.string().min(1).max(64),
  issuedAt: IsoDateTime,
  full: z.boolean(),
  entries: z.array(AdmissionEntrySchema).max(100_000),
});
export type AdmissionPayload = z.infer<typeof AdmissionPayloadSchema>;

export const AdmissionEnvelopeSchema = z.object({
  payload: AdmissionPayloadSchema,
  signature: z.string().min(1),
});
export type AdmissionEnvelope = z.infer<typeof AdmissionEnvelopeSchema>;

/** A prod account row projected to the minimal snapshot fields. */
export interface AdmissionSourceRow {
  email: string | null;
  name: string | null;
  status: string;
  isAdmin: boolean;
  createdAt: Date | string | null;
  approvedAt: Date | string | null;
}

function toIso(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function normalizeAdmissionEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Valid total order on normalised emails (`0` on equality — the previous
 * `-1 : 1` comparator violated the `Array.prototype.sort` contract and could
 * invert same-email entries between `build` and `canonical` serialisation).
 */
function compareAdmissionEmails(a: string, b: string): number {
  const ka = normalizeAdmissionEmail(a);
  const kb = normalizeAdmissionEmail(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

function timeOrZero(value: string | null): number {
  if (value === null) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

/**
 * Deterministic winner among same-email rows (prod `email` is not UNIQUE for
 * `local` rows, so an old `rejected` row and a new `approved` row may share
 * an address). Preference: `approved` first, then most recent `approvedAt`,
 * then most recent `createdAt`, then raw email/name (total, input-order
 * independent).
 */
function isPreferredAdmissionEntry(candidate: AdmissionEntry, current: AdmissionEntry): boolean {
  const rank = (entry: AdmissionEntry) => (entry.status === "approved" ? 0 : 1);
  const rankDiff = rank(candidate) - rank(current);
  if (rankDiff !== 0) return rankDiff < 0;
  const approvedDiff = timeOrZero(candidate.approvedAt) - timeOrZero(current.approvedAt);
  if (approvedDiff !== 0) return approvedDiff > 0;
  const createdDiff = timeOrZero(candidate.createdAt) - timeOrZero(current.createdAt);
  if (createdDiff !== 0) return createdDiff > 0;
  if (candidate.email !== current.email) return candidate.email < current.email;
  return (candidate.name ?? "") < (current.name ?? "");
}

function isEmailLike(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Build the canonical snapshot payload from prod account rows. Rows without a
 * usable email are dropped (they cannot be joined in preprod); rows with an
 * unknown status are dropped rather than guessed. Entries are sorted by
 * normalised email so the canonical bytes are deterministic.
 */
export function buildAdmissionSnapshot(
  rows: AdmissionSourceRow[],
  opts: { kid: string; issuedAt: Date | string; full: boolean },
): AdmissionPayload {
  const issuedAt = opts.issuedAt instanceof Date ? opts.issuedAt.toISOString() : new Date(opts.issuedAt).toISOString();
  const byEmail = new Map<string, AdmissionEntry>();
  for (const row of rows) {
    if (typeof row.email !== "string" || !isEmailLike(row.email.trim())) continue;
    if (!(ADMISSION_STATUSES as readonly string[]).includes(row.status)) continue;
    const candidate: AdmissionEntry = {
      email: row.email.trim(),
      name: typeof row.name === "string" && row.name.length > 0 ? row.name : null,
      status: row.status as AdmissionStatus,
      role: row.isAdmin ? "admin" : "member",
      createdAt: toIso(row.createdAt),
      approvedAt: toIso(row.approvedAt),
    };
    const norm = normalizeAdmissionEmail(candidate.email);
    const current = byEmail.get(norm);
    if (!current || isPreferredAdmissionEntry(candidate, current)) byEmail.set(norm, candidate);
  }
  const entries = [...byEmail.values()].sort((a, b) => compareAdmissionEmails(a.email, b.email));
  return { version: ADMISSION_SNAPSHOT_VERSION, kid: opts.kid, issuedAt, full: opts.full, entries };
}

/**
 * Canonical bytes covered by the signature. Both sides MUST use this exact
 * serialisation: the payload is re-encoded from its parsed fields (fixed key
 * order), so producer and verifier agree byte-for-byte without canonical-JSON
 * machinery.
 */
export function canonicalSnapshotBytes(payload: AdmissionPayload): Buffer {
  const normalised: AdmissionPayload = {
    version: payload.version,
    kid: payload.kid,
    issuedAt: payload.issuedAt,
    full: payload.full,
    entries: [...payload.entries].sort((a, b) => compareAdmissionEmails(a.email, b.email)).map((entry) => ({
      email: entry.email,
      name: entry.name,
      status: entry.status,
      role: entry.role,
      createdAt: entry.createdAt,
      approvedAt: entry.approvedAt,
    })),
  };
  return Buffer.from(
    `${SIGNATURE_CONTEXT}\n${JSON.stringify(normalised)}`,
    "utf8",
  );
}

/** Stable key id: derived from the public key material only. */
export function keyIdForPublicJwk(jwk: { x: string }): string {
  return createHash("sha256")
    .update(`ed25519:${jwk.x}`, "utf8")
    .digest("base64url")
    .slice(0, 16);
}

export interface AdmissionKeypair {
  kid: string;
  /** `kid.base64(jwk-json)` private entry (prod Secret content). */
  privateEntry: string;
  /** `kid.base64(jwk-json)` public entry (preprod config content). */
  publicEntry: string;
}

/** Generate a fresh Ed25519 admission keypair (owner-run, see runbook). */
export function generateAdmissionKeypair(): AdmissionKeypair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicJwk = publicKey.export({ format: "jwk" });
  const privateJwk = privateKey.export({ format: "jwk" });
  const kid = keyIdForPublicJwk(publicJwk as { x: string });
  const encode = (jwk: unknown) => Buffer.from(JSON.stringify(jwk), "utf8").toString("base64");
  return {
    kid,
    privateEntry: `${kid}.${encode(privateJwk)}`,
    publicEntry: `${kid}.${encode(publicJwk)}`,
  };
}

function decodeEntry(entry: string, kind: "private" | "public"): { kid: string; jwk: Record<string, unknown> } {
  const dot = entry.indexOf(".");
  if (dot <= 0) throw new Error(`admission_${kind}_key_malformed`);
  const kid = entry.slice(0, dot);
  let jwk: unknown;
  try {
    jwk = JSON.parse(Buffer.from(entry.slice(dot + 1), "base64").toString("utf8"));
  } catch {
    throw new Error(`admission_${kind}_key_malformed`);
  }
  if (typeof jwk !== "object" || jwk === null) throw new Error(`admission_${kind}_key_malformed`);
  return { kid, jwk: jwk as Record<string, unknown> };
}

/** Parse a `kid.base64(jwk-json)` private key entry (prod only). */
export function parsePrivateKeyEntry(entry: string): { kid: string; key: KeyObject } {
  const { kid, jwk } = decodeEntry(entry, "private");
  if (jwk["kty"] !== "OKP" || jwk["crv"] !== "Ed25519" || typeof jwk["d"] !== "string") {
    throw new Error("admission_private_key_malformed");
  }
  return { kid, key: createPrivateKey({ key: jwk as never, format: "jwk" }) };
}

/** Parse a `kid.base64(jwk-json)` public key entry (preprod config). */
export function parsePublicKeyEntry(entry: string): { kid: string; key: KeyObject } {
  const { kid, jwk } = decodeEntry(entry, "public");
  if (jwk["kty"] !== "OKP" || jwk["crv"] !== "Ed25519" || typeof jwk["x"] !== "string") {
    throw new Error("admission_public_key_malformed");
  }
  const key = createPublicKey({ key: jwk as never, format: "jwk" });
  if (keyIdForPublicJwk(jwk as { x: string }) !== kid) {
    throw new Error("admission_public_key_kid_mismatch");
  }
  return { kid, key };
}

/** Parse the comma-separated preprod public-key list into kid → key. */
export function parsePublicKeyList(list: string): Map<string, KeyObject> {
  const out = new Map<string, KeyObject>();
  for (const raw of list.split(",")) {
    const entry = raw.trim();
    if (entry === "") continue;
    const { kid, key } = parsePublicKeyEntry(entry);
    out.set(kid, key);
  }
  return out;
}

/** Sign a payload, returning the transmittable envelope. */
export function signSnapshot(payload: AdmissionPayload, privateKey: KeyObject): AdmissionEnvelope {
  const signature = sign(null, canonicalSnapshotBytes(payload), privateKey);
  return { payload, signature: signature.toString("base64") };
}

export type SnapshotRejectReason =
  | "envelope_malformed"
  | "payload_malformed"
  | "unsupported_version"
  | "unknown_kid"
  | "invalid_signature";

export class SnapshotRejectedError extends Error {
  readonly reason: SnapshotRejectReason;
  constructor(reason: SnapshotRejectReason) {
    super(`admission_snapshot_rejected:${reason}`);
    this.reason = reason;
  }
}

function reject(reason: SnapshotRejectReason): never {
  throw new SnapshotRejectedError(reason);
}

/**
 * Verify an envelope against the accepted prod public keys. Returns the
 * verified payload. Rejects (throws SnapshotRejectedError) on any malformed,
 * unknown-kid, or invalid-signature input — ingestion must not apply it.
 */
export function verifySnapshot(
  envelope: unknown,
  publicKeys: Map<string, KeyObject>,
): AdmissionPayload {
  const parsed = AdmissionEnvelopeSchema.safeParse(envelope);
  if (!parsed.success) reject("envelope_malformed");
  const { payload } = parsed.data;
  if (payload.version !== ADMISSION_SNAPSHOT_VERSION) reject("unsupported_version");
  const key = publicKeys.get(payload.kid);
  if (!key) reject("unknown_kid");
  let signature: Buffer;
  try {
    signature = Buffer.from(parsed.data.signature, "base64");
  } catch {
    reject("invalid_signature");
  }
  const ok = verify(null, canonicalSnapshotBytes(payload), key!, signature!);
  if (!ok) reject("invalid_signature");
  return payload;
}
