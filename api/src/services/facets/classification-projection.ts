import type { Database } from "../../db/client.js";
import { readCoherentProjection, readProjectionScope } from "./projection-revisions.js";
import { readClassificationCatalog, catalogVersion } from "./classification-catalog.js";
import { ClassificationError } from "./classification-errors.js";
import { Snapshot } from "./classification-contracts.js";
import { QUERY_PROFILE } from "./classification-query.js";
import { POPULATION } from "./classification-population.js";
import { ScopeError } from "./scope.js";
import { digest } from "./target.js";

export const PROJECTION_VERSION = "signal-classifications-v1:canonical-a2base-v1:bounded-card-v1";
export function classificationQueryDigest(query: object, catalog: string) {
  return digest({ population: POPULATION, queryProfile: QUERY_PROFILE, projectionVersion: PROJECTION_VERSION,
    semanticContractVersion: "base-classification-v1", catalogVersion: catalog, query });
}
/** Three total attempts, including catalog drift; BASE remains the scope authority. */
export async function readClassificationProjection<T>(db: Database, sub: string, workspaceId: string,
  citySlug: string, query: object, readPayload: () => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const before = catalogVersion(await readClassificationCatalog(db, sub, workspaceId));
      const result = await readCoherentProjection(db, sub, workspaceId, citySlug, "signal", readPayload, 1);
      const after = catalogVersion(await readClassificationCatalog(db, sub, workspaceId));
      const final = await readProjectionScope(db, sub, workspaceId, citySlug, "signal");
      if (before !== after || result.scope.token !== final.token) continue;
      const queryDigest = classificationQueryDigest(query, after);
      const snapshot = Snapshot.parse({ kind: "signal-projection-v1", baseToken: final.token,
        queryToken: digest({ baseToken: final.token, queryDigest }), queryDigest,
        projectionVersion: PROJECTION_VERSION, catalogVersion: after });
      return { scope: final, snapshot, payload: result.payload };
    } catch (error) {
      if (!(error instanceof ScopeError) || error.message !== "projection_revision_unstable") throw error;
    }
  }
  throw new ClassificationError("projection_revision_unstable");
}
