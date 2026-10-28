import type { Context } from "hono";
import type { WriteGrantClaims, WriteGrantIssuer } from "./write-grant.js";
import { mintWriteGrant } from "./write-grant.js";
import { FacetError } from "../services/facets/target.js";
import type { WritePrepareBody } from "./write-intent-schemas.js";
import type { WriteTx } from "../services/facets/signal-write-scope.js";

/** Trusted H5 adapter output, after authenticating P and current write rights.
 * This is a separate write authority contract; A6 read claims remain unchanged.
 * Never populate it from content parameters or a read bootstrap alone.
 */
export interface PageWriteAuthority {
  grant: WriteGrantClaims;
  pageInstanceId: string;
  pageExpiresAtMs: number;
  delegationExpiresAtMs: number;
  authorityReferences: Record<string, string>;
}

export interface PageWriteAuthorityDeps {
  grantIssuer: WriteGrantIssuer & { identityIssuer: string };
  grantKeyId: string;
  resolvePage: (request: Request, scope?: WritePrepareBody, tx?: WriteTx) => Promise<PageWriteAuthority | null>;
  grantSecret: string;
}

function assertPageAuthority(page: PageWriteAuthority | null, deps: PageWriteAuthorityDeps,
  nowMs: number): asserts page is PageWriteAuthority {
  const expected = deps.grantIssuer;
  if (!deps.grantKeyId || !page || page.grant.issuer !== expected.issuer || page.grant.tier !== expected.tier
    || page.grant.audience !== expected.audience || page.grant.identityIssuer !== expected.identityIssuer
    || !page.pageInstanceId || !page.grant.sessionId) {
    throw new FacetError(403, "write_grant_required");
  }
  if (page.pageExpiresAtMs <= nowMs) throw new FacetError(401, "page_session_expired");
  if (page.delegationExpiresAtMs <= nowMs) throw new FacetError(401, "write_grant_expired");
}

export async function resolveWritePage(c: Context, deps: PageWriteAuthorityDeps,
  clock: () => number, scope?: WritePrepareBody, tx?: WriteTx): Promise<PageWriteAuthority> {
  const page = await deps.resolvePage(c.req.raw, scope, tx);
  assertPageAuthority(page, deps, clock());
  return page;
}

/** Demand-only issuer for the fixed H5 adapter; no GET/poll calls this. */
export async function mintPageWriteGrant(page: PageWriteAuthority,
  deps: PageWriteAuthorityDeps, nowMs: number): Promise<string> {
  assertPageAuthority(page, deps, nowMs);
  return mintWriteGrant(page.grant, deps.grantSecret, nowMs,
    Math.min(page.pageExpiresAtMs, page.delegationExpiresAtMs));
}
