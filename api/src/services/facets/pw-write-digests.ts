import { createHash, randomUUID, randomBytes } from "node:crypto";
import { FacetError } from "./target.js";

/** Canonical JSON: recursive key sort, array order kept, no Unicode rewrite. */
export function pwCanonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(pwCanonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).sort().map((key) =>
      `${JSON.stringify(key)}:${pwCanonicalJson(row[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function pwDigest(value: unknown): string {
  return createHash("sha256").update(pwCanonicalJson(value), "utf8").digest("hex");
}

export interface PwPrincipal {
  issuer: string;
  sub: string;
  tier: string;
}

export interface PwIntentBinding {
  principal: PwPrincipal;
  pageSessionId: string;
  pageInstanceId: string;
  grantReference: string;
  intentId: string;
  invocationId: string;
  operationDigest: string;
  commandKey: string;
  expectedProjectionToken: string;
  expiresAtMs: number;
  artifactRef: Record<string, unknown>;
  challengeKeyId: string;
  authorityReferences: Record<string, string>;
}

const HEX64 = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(): never {
  throw new FacetError(400, "invalid_facet_command");
}

/** Closed validation of the immutable intent binding; digests stay server-computed. */
export function assertPwIntentBinding(value: unknown): asserts value is PwIntentBinding {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail();
  const row = value as Record<string, unknown>;
  const principal = row.principal as Record<string, unknown> | undefined;
  if (!principal || typeof principal.issuer !== "string" || principal.issuer.length === 0) fail();
  if (typeof principal.sub !== "string" || principal.sub.length === 0) fail();
  if (typeof principal.tier !== "string" || principal.tier.length === 0) fail();
  if (Object.keys(principal).sort().join(",") !== "issuer,sub,tier") fail();
  for (const key of ["pageSessionId", "pageInstanceId", "grantReference", "challengeKeyId"] as const) {
    if (typeof row[key] !== "string" || (row[key] as string).length === 0) fail();
  }
  for (const key of ["intentId", "invocationId", "commandKey"] as const) {
    if (typeof row[key] !== "string" || !UUID.test(row[key] as string)) fail();
  }
  if (typeof row.operationDigest !== "string" || !HEX64.test(row.operationDigest)) fail();
  if (typeof row.expectedProjectionToken !== "string" || !HEX64.test(row.expectedProjectionToken)) fail();
  if (typeof row.expiresAtMs !== "number" || !Number.isSafeInteger(row.expiresAtMs)) fail();
  if (row.artifactRef === undefined || row.artifactRef === null
    || typeof row.artifactRef !== "object" || Array.isArray(row.artifactRef)) fail();
  const refs = row.authorityReferences as Record<string, unknown> | undefined;
  for (const kind of ["tier", "policy", "release", "delegation", "reader", "grant", "page_session"]) {
    if (!refs || typeof refs[kind] !== "string" || (refs[kind] as string).length === 0) fail();
  }
  if (refs!.tier !== principal.tier || refs!.grant !== row.grantReference
    || refs!.page_session !== row.pageSessionId) fail();
}

/** Intent digest over the immutable H5 context; the page never supplies it. */
export function pwIntentDigest(binding: PwIntentBinding, command: unknown): string {
  assertPwIntentBinding(binding);
  return pwDigest({
    version: "pw-intent-v1",
    principal: binding.principal,
    pageSessionId: binding.pageSessionId,
    pageInstanceId: binding.pageInstanceId,
    artifactRef: binding.artifactRef,
    grantReference: binding.grantReference,
    intentId: binding.intentId.toLowerCase(),
    invocationId: binding.invocationId.toLowerCase(),
    operationDigest: binding.operationDigest,
    commandKey: (binding.commandKey as string).toLowerCase(),
    expectedProjectionToken: binding.expectedProjectionToken,
    expiresAtMs: binding.expiresAtMs,
    challengeKeyId: binding.challengeKeyId,
    authorityReferences: binding.authorityReferences,
    command,
  });
}

/** Fresh intent identifiers; the caller persists them with the binding. */
export function newPwIntentIds(): { intentId: string; invocationId: string; challengeId: string } {
  return { intentId: randomUUID(), invocationId: randomUUID(), challengeId: randomBytes(32).toString("hex") };
}
