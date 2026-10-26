import { randomUUID } from "node:crypto";
import type { WorkspaceFixture } from "./workspace-archive-fixture.js";
import { newPwIntentIds } from "./pw-write-digests.js";
import type { PwPrepareParams, PwIntentRow } from "./pw-write-store.js";
import { preparePwWriteIntentGuarded } from "./pw-write-prepare.js";
import { signalWriteOperationDigest, type SignalWriteInput } from "./signal-write-operations.js";
import type { PwConfirmation } from "./pw-write-confirmation.js";

export function pwParams(f: WorkspaceFixture, input: SignalWriteInput): PwPrepareParams {
  const ids = newPwIntentIds();
  const pageSessionId = `page-${randomUUID()}`;
  const grantReference = `grant-${randomUUID()}`;
  const artifactRef = { artifactId: "artifact-1", releaseId: "release-1",
    profileName: "h5-signal-write-v2", policyRevision: "policy-1" };
  return {
    operation: input.operation, workspaceId: input.workspaceId, actorId: f.contributor.id,
    binding: {
      principal: { issuer: "https://auth.example.test", sub: f.contributor.sub, tier: "preprod" },
      pageSessionId, pageInstanceId: `instance-${randomUUID()}`, grantReference,
      intentId: ids.intentId, invocationId: ids.invocationId,
      operationDigest: signalWriteOperationDigest(input), commandKey: input.commandKey,
      expectedProjectionToken: input.expectedProjectionToken, expiresAtMs: input.expiresAtMs,
      artifactRef, challengeKeyId: "synthetic-key-1", authorityReferences: {
        tier: "preprod", policy: "policy-1", release: "release-1", delegation: "delegation-1",
        reader: f.contributor.id, grant: grantReference, page_session: pageSessionId,
      },
    },
    artifactRef, citySlug: input.target.citySlug, target: input.target, command: input,
  };
}

export function pwConfirmation(row: PwIntentRow): PwConfirmation {
  return { principal: row.principal as PwConfirmation["principal"],
    challengeId: row.challengeId, intentDigest: row.intentDigest,
    expiresAtMs: row.expiresAt.getTime(), keyId: row.challengeKeyId,
    sessionExpiresAtMs: row.expiresAt.getTime() + 3600_000 };
}

export async function pwPrepared(f: WorkspaceFixture, input: SignalWriteInput) {
  return preparePwWriteIntentGuarded(f.db, pwParams(f, input));
}
