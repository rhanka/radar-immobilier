import type { Database } from "../../db/client.js";
import { readScopedReasonCodes } from "./scoped-reveal.js";
import { FACET_PROFILE } from "./codebook.js";
import { ReasonCatalog, type Catalog } from "./classification-context-contract.js";
import { ScopeError } from "./scope.js";
import { WorkspaceError } from "../workspaces/types.js";
import { digest } from "./target.js";

export async function readClassificationCatalog(db: Database, sub: string, workspaceId: string): Promise<Catalog> {
  try {
    const rows = await readScopedReasonCodes(db, sub, workspaceId);
    if (!rows.length) return unavailableCatalog();
    const entries = rows.map((row) => ({ code: row.code, verdict: row.verdict, label: null }));
    return ReasonCatalog.parse({ availability: { state: "open" }, profileId: FACET_PROFILE,
      digest: digest({ profileId: FACET_PROFILE, entries }), entries });
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    if (error instanceof ScopeError) {
      if (!error.message.startsWith("scoped_facet_scope_unavailable:")) throw error;
      return { availability: { state: "closed", reason: "not_activated" }, profileId: null, digest: null, entries: null };
    }
    return unavailableCatalog();
  }
}
export function unavailableCatalog(): Catalog {
  return { availability: { state: "unavailable", reason: "catalog_unavailable" }, profileId: null, digest: null, entries: null };
}
export function catalogVersion(catalog: Catalog): string {
  return catalog.digest ?? `catalog:${catalog.availability.state}:${"reason" in catalog.availability ? catalog.availability.reason : "unknown"}`;
}
