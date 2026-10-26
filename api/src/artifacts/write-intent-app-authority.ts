import type { Context } from "hono";
import type { Database } from "../db/client.js";
import { assertPwPrincipal, type PwConfirmation } from "../services/facets/pw-write-confirmation.js";
import { loadPwIntentForShare, type PwIntentRow } from "../services/facets/pw-write-store.js";
import { issueWriteIntentCsrf, verifyWriteIntentCsrf } from "./write-intent-csrf.js";
import { issueWriteChallengeToken, verifyWriteChallengeToken } from "./write-intent-challenge.js";
import { assertAppMutationHeaders, type AppGuardDeps, type AppGuardPass } from "./write-intent-app-guard.js";
import { assertIdempotencyKey } from "./write-intent-schemas.js";
import { FacetError } from "../services/facets/target.js";
import { PwWriteError } from "../services/facets/pw-write-errors.js";
import { writeRefusal } from "./write-intent-refusal.js";
import { sql } from "drizzle-orm";
import { approvedAccountId, resolveWorkspaceAccess } from "../services/workspaces/store.js";
import { lockWorkspace } from "../services/workspaces/mutations.js";
import { WorkspaceError } from "../services/workspaces/types.js";
import { isPersonalOperation } from "../services/facets/signal-write-operations.js";

export interface WriteAppDeps extends AppGuardDeps {
  db: Database;
  challengeKeys: ReadonlyMap<string, Uint8Array>;
  /** PW-C supplies rendering and command dispatch after its own qualification. */
  renderSummary?: (c: Context, row: PwIntentRow, bootstrap: { csrf: string; challengeToken: string }) => Response;
  confirm?: (row: PwIntentRow, proof: PwConfirmation, sessionExpiresAtMs: number) => Promise<unknown>;
  revoke?: (row: PwIntentRow, principal: AppGuardPass["principal"]) => Promise<unknown>;
}

export async function ownedWriteIntent(c: Context, deps: WriteAppDeps, pass: AppGuardPass,
  management = false) {
  const id = c.req.param("intentId");
  assertIdempotencyKey(id);
  return deps.db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '1s'`);
    await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
    const row = await loadPwIntentForShare(tx, id!);
    try { assertPwPrincipal(row, pass.principal); }
    catch (error) {
      if (management && error instanceof PwWriteError && error.message === "confirmation_identity_mismatch") {
        throw new FacetError(404, "write_intent_not_found");
      }
      throw error;
    }
    return row;
  });
}

/** Rights loss keeps owner revocation available without releasing business data. */
export async function canReadWriteIntentSummary(deps: WriteAppDeps, row: PwIntentRow,
  pass: AppGuardPass): Promise<boolean> {
  try {
    return await deps.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '1s'`);
      await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
      await lockWorkspace(tx, row.workspaceId);
      await approvedAccountId(tx, pass.principal.sub, true);
      const access = await resolveWorkspaceAccess(tx, row.workspaceId, pass.principal.sub);
      return isPersonalOperation(row.operation) || access.moderateArchive;
    });
  } catch (error) {
    if (error instanceof WorkspaceError && ["account_not_approved", "workspace_membership_required",
      "workspace_not_found"].includes(error.message)) return false;
    throw error;
  }
}

export function writeCsrf(deps: WriteAppDeps, pass: AppGuardPass, intentId: string): string {
  return issueWriteIntentCsrf({ domain: deps.domain, principal: pass.principal,
    rawCookie: pass.rawCookie, intentId, issuedAtMs: (deps.nowMs ?? Date.now)(),
    sessionExpSec: pass.session.exp, sessionSecret: deps.sessionSecret });
}

export function guardWriteIntentAppMutation(c: Context, deps: WriteAppDeps,
  pass: AppGuardPass): Response | null {
  const refused = assertAppMutationHeaders(c, deps.domain.appOrigin);
  if (refused) return refused;
  if (!verifyWriteIntentCsrf({ token: c.req.header("x-artifact-write-csrf") ?? "",
    domain: deps.domain, principal: pass.principal, rawCookie: pass.rawCookie,
    intentId: c.req.param("intentId") ?? "", nowMs: (deps.nowMs ?? Date.now)(),
    sessionSecret: deps.sessionSecret })) return writeRefusal(c, "csrf_refused", 403);
  return null;
}

export function writeChallenge(row: PwIntentRow, deps: WriteAppDeps) {
  const key = deps.challengeKeys.get(row.challengeKeyId);
  if (!key) throw new PwWriteError(503, "write_authority_unavailable");
  return { material: { challengeId: row.challengeId, intentDigest: row.intentDigest,
    expiresAtMs: row.expiresAt.getTime(), keyId: row.challengeKeyId }, key };
}

export function challengeBootstrap(row: PwIntentRow, deps: WriteAppDeps, pass: AppGuardPass) {
  const { material, key } = writeChallenge(row, deps);
  return { csrf: writeCsrf(deps, pass, row.intentId),
    challengeToken: issueWriteChallengeToken(material, key) };
}

export function verifyAppChallenge(token: unknown, row: PwIntentRow, deps: WriteAppDeps,
  pass: AppGuardPass): PwConfirmation {
  const { material, key } = writeChallenge(row, deps);
  if (typeof token !== "string" || !verifyWriteChallengeToken(token, material, key)) {
    throw new FacetError(403, "challenge_invalid");
  }
  return { ...material, principal: pass.principal };
}
