import { timingSafeEqual } from "node:crypto";
import type { PwIntentRow } from "./pw-write-store.js";
import { pwIntentDigest, pwDigest, type PwPrincipal } from "./pw-write-digests.js";
import { PwWriteError } from "./pw-write-errors.js";

/** PW-A supplies these claims only after verifying the application challenge MAC. */
export interface PwConfirmation {
  principal: PwPrincipal;
  challengeId: string;
  intentDigest: string;
  expiresAtMs: number;
  keyId: string;
  /** Authenticated application cookie expiry; independent of the challenge. */
  sessionExpiresAtMs: number;
}

export function assertPwSession(proof: PwConfirmation, nowMs: number): void {
  if (!Number.isSafeInteger(proof.sessionExpiresAtMs) || !Number.isSafeInteger(nowMs)
    || nowMs >= proof.sessionExpiresAtMs) throw new PwWriteError(401, "session_expired");
}

export function assertPwPrincipal(row: PwIntentRow, principal: PwPrincipal): void {
  const owner = row.principal as PwPrincipal;
  if (!principal || owner.issuer !== principal.issuer || owner.sub !== principal.sub
    || owner.tier !== principal.tier) {
    throw new PwWriteError(403, "confirmation_identity_mismatch");
  }
}

export function assertPwConfirmation(row: PwIntentRow, proof: PwConfirmation): void {
  assertPwPrincipal(row, proof?.principal);
  if (!proof || typeof proof.challengeId !== "string"
    || !/^[a-f0-9]{64}$/.test(proof.challengeId)
    || !timingSafeEqual(Buffer.from(proof.challengeId), Buffer.from(row.challengeId))
    || proof.intentDigest !== row.intentDigest || proof.keyId !== row.challengeKeyId
    || proof.expiresAtMs !== row.expiresAt.getTime()) {
    throw new PwWriteError(403, "challenge_invalid");
  }
  const actual = pwIntentDigest({
    principal: row.principal as PwPrincipal, pageSessionId: row.pageSessionId,
    pageInstanceId: row.pageInstanceId, grantReference: row.grantReference,
    intentId: row.intentId, invocationId: row.invocationId,
    operationDigest: row.operationDigest, commandKey: row.commandKey,
    expectedProjectionToken: row.expectedProjectionToken, expiresAtMs: row.expiresAt.getTime(),
    artifactRef: row.artifactRef as Record<string, unknown>, challengeKeyId: row.challengeKeyId,
    authorityReferences: row.authorityReferences as Record<string, string>,
  }, row.command);
  if (actual !== row.intentDigest) throw new PwWriteError(403, "challenge_invalid");
}

export function pwReaderBucket(principal: PwPrincipal, workspaceId: string): string {
  return pwDigest({ principal, workspaceId: workspaceId.toLowerCase() });
}
