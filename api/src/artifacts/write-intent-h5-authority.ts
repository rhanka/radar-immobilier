import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { pwWriteIntents } from "../db/schema-pw-write.js";
import { assertPwAuthorityOpen } from "../services/facets/pw-write-fences.js";
import { assertPwPrincipal } from "../services/facets/pw-write-confirmation.js";
import { loadPwIntentForShare } from "../services/facets/pw-write-store.js";
import { FacetError } from "../services/facets/target.js";
import { canonicalWritePrincipal } from "./write-intent-principal.js";
import { resolveWritePage } from "./write-intent-page-authority.js";
import type { H5WriteDeps } from "./write-intent-h5-route.js";
import { writeIntentTransaction } from "./write-intent-transaction.js";
import { canReadWriteIntentSummaryInTx } from "./write-intent-app-authority.js";

/** Reusable disclosure fence, including a fresh authenticated P after SQL waits. */
export async function readPageBoundWriteIntent(c: Context, deps: H5WriteDeps, id: string) {
  await resolveWritePage(c, deps, deps.nowMs ?? Date.now);
  return writeIntentTransaction(deps.db, async (tx) => {
    const [observed] = await tx.select().from(pwWriteIntents).where(eq(pwWriteIntents.intentId, id));
    if (!observed) throw new FacetError(404, "write_intent_not_found");
    await assertPwAuthorityOpen(tx, observed.authorityReferences as Record<string, string>);
    const row = await loadPwIntentForShare(tx, id);
    const page = await resolveWritePage(c, deps, deps.nowMs ?? Date.now, undefined, tx);
    const artifact = row.artifactRef as Record<string, unknown>;
    if (row.pageSessionId !== page.grant.sessionId || row.pageInstanceId !== page.pageInstanceId
      || artifact.artifactId !== page.grant.artifactId || artifact.releaseId !== page.grant.releaseId
      || artifact.host !== page.grant.host || artifact.profileName !== page.grant.profileName
      || artifact.profileFingerprint !== page.grant.profileFingerprint
      || artifact.policyRevision !== page.grant.policyRevision) throw new FacetError(403, "write_grant_required");
    assertPwPrincipal(row, canonicalWritePrincipal(page.grant));
    // Run after the final P resolution. Retain the workspace/approval locks
    // through disclosure; workspace operations also require current moderation.
    if (!await canReadWriteIntentSummaryInTx(tx, row, { principal: canonicalWritePrincipal(page.grant) })) {
      throw new FacetError(403, "write_authority_unavailable");
    }
    return { row, page };
  });
}
