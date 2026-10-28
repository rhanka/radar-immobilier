/**
 * PW-A binding helpers: build the immutable intent binding from a verified
 * write grant and a strict prepare body. Digests stay server-computed;
 * the page never supplies operation, intent, or projection digests.
 */
import type { PwIntentBinding } from "../services/facets/pw-write-digests.js";
import { signalWriteOperationDigest } from "../services/facets/signal-write-operations.js";
import type { SignalTarget } from "../services/facets/target.js";
import type { VerifiedWriteGrant } from "./write-grant.js";
import type { WritePrepareBody } from "./write-intent-schemas.js";

export interface BindingInputs {
  grant: VerifiedWriteGrant;
  body: WritePrepareBody;
  commandKey: string;
  intentId: string;
  invocationId: string;
  pageInstanceId: string;
  expiresAtMs: number;
  challengeKeyId: string;
  authorityReferences: Record<string, string>;
}

/** Reject duplicated JSON object keys before JSON.parse adopts last-wins. */
export function hasDuplicateJsonKeys(text: string): boolean {
  const stack: Set<string>[] = [];
  // Strings are lexical tokens; punctuation inside a value is harmless.
  const tokens = text.match(/"(?:[^"\\]|\\.)*"|[{}:[\],]/gs) ?? [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token === "{") stack.push(new Set());
    else if (token === "}") stack.pop();
    else if (token.startsWith('"') && tokens[i + 1] === ":") {
      let key: string;
      try { key = JSON.parse(token) as string; } catch { continue; }
      const keys = stack.at(-1);
      if (keys?.has(key)) return true;
      keys?.add(key);
    }
  }
  return false;
}

function artifactRefOf(grant: VerifiedWriteGrant): Record<string, unknown> {
  return {
    artifactId: grant.artifactId,
    host: grant.host,
    releaseId: grant.releaseId,
    profileName: grant.profileName,
    policyRevision: grant.policyRevision,
    profileFingerprint: grant.profileFingerprint,
  };
}

/** Assemble the binding; callers persist it through PW-D without edits. */
export function buildWriteIntentBinding(inputs: BindingInputs): PwIntentBinding {
  const normalized = {
    operation: inputs.body.operation,
    workspaceId: inputs.body.workspaceId,
    target: inputs.body.target,
    basket: inputs.body.basket,
    reasonCode: inputs.body.reasonCode,
    deselect: inputs.body.deselect === undefined ? undefined : [...inputs.body.deselect].sort(),
    expectedSelectionHeads: inputs.body.expectedSelectionHeads,
    expectedHeadId: inputs.body.expectedHeadId,
    displayedFingerprint: inputs.body.displayedFingerprint,
    expectedProjectionToken: inputs.body.expectedProjectionToken,
    commandKey: inputs.commandKey,
    expiresAtMs: inputs.expiresAtMs,
  };
  const operationDigest = signalWriteOperationDigest({
    ...normalized,
    target: normalized.target as SignalTarget,
    basket: normalized.basket as "pertinent" | "a_surveiller" | undefined,
    deselect: normalized.deselect as ("pertinent" | "a_surveiller")[] | undefined,
    expectedSelectionHeads: normalized.expectedSelectionHeads as Partial<Record<"pertinent" | "a_surveiller", string | null>> | undefined,
  });
  return {
    principal: { issuer: inputs.grant.identityIssuer, sub: inputs.grant.readerSub, tier: inputs.grant.tier },
    pageSessionId: inputs.grant.sessionId,
    pageInstanceId: inputs.pageInstanceId,
    grantReference: inputs.grant.jti,
    intentId: inputs.intentId.toLowerCase(),
    invocationId: inputs.invocationId.toLowerCase(),
    operationDigest,
    commandKey: inputs.commandKey.toLowerCase(),
    expectedProjectionToken: inputs.body.expectedProjectionToken,
    expiresAtMs: inputs.expiresAtMs,
    artifactRef: artifactRefOf(inputs.grant),
    challengeKeyId: inputs.challengeKeyId,
    authorityReferences: inputs.authorityReferences,
  };
}
