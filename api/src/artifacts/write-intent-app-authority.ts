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

export interface WriteAppDeps extends AppGuardDeps {
  db: Database;
  challengeKeys: ReadonlyMap<string, Uint8Array>;
  /** PW-C supplies rendering and command dispatch after its own qualification. */
  renderSummary?: (c: Context, row: PwIntentRow, bootstrap: { csrf: string; challengeToken: string }) => Response;
  confirm?: (row: PwIntentRow, proof: PwConfirmation, sessionExpiresAtMs: number) => Promise<unknown>;
  revoke?: (row: PwIntentRow, principal: AppGuardPass["principal"]) => Promise<unknown>;
}

export async function ownedWriteIntent(c: Context, deps: WriteAppDeps, pass: AppGuardPass) {
  const id = c.req.param("intentId");
  assertIdempotencyKey(id);
  return deps.db.transaction(async (tx) => {
    const row = await loadPwIntentForShare(tx, id!);
    assertPwPrincipal(row, pass.principal);
    return row;
  });
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
    sessionSecret: deps.sessionSecret })) return c.json({ error: "csrf_refused" }, 403);
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
