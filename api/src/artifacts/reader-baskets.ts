/**
 * L3 basket bridge (ARTEFACTS A6/H5 -> paniers).
 *
 * Frozen mapping onto the existing classification services (no new basket
 * storage, same schemas, limits and errors as the workspace routes):
 * - baskets.context.v1 -> readFacetContext
 * - baskets.search.v1 -> searchSignalClassifications
 * - baskets.state.v1 -> readSignalClassification
 *
 * The caller (content-serve) supplies the verified H5 reader context. The
 * workspace id is always explicit in the operation params: no default is
 * ever inferred. Zero membership, foreign or revoked workspaces are refused
 * inside the services (workspace_not_authorized). Several memberships
 * require the caller to pick one workspace id explicitly.
 */
import type { Database } from "../db/client.js";
import type { ObjectStore } from "../storage/object-store.js";
import { readFacetContext } from "../services/facets/classification-context.js";
import {
  searchSignalClassifications,
  type ClassificationOptions,
} from "../services/facets/classification-search.js";
import { readSignalClassification } from "../services/facets/classification-state.js";
import type { ApiReaderContext } from "./reader-context.js";
import { isBasketOperation, type ReaderOperationName } from "./reader-operations.js";

export interface BasketReadDeps {
  readonly db: Database;
  readonly store: ObjectStore;
  readonly classification?: ClassificationOptions | undefined;
}

export function createBasketReadOperation(deps: BasketReadDeps): (
  op: ReaderOperationName,
  params: unknown,
  context: ApiReaderContext,
) => Promise<unknown> {
  return async (op, params, context) => {
    if (!isBasketOperation(op)) throw new Error("Capability unavailable");
    const input = params as Record<string, unknown>;
    const workspaceId = input.workspaceId as string;
    if (op === "baskets.context.v1") {
      const contextResult = await readFacetContext(deps.db, context.readerSub, workspaceId);
      if (contextResult.workspaceId !== workspaceId) throw new Error("Workspace mismatch");
      return { ok: true as const, context: contextResult };
    }
    if (op === "baskets.search.v1") {
      const { workspaceId: ws, ...query } = input;
      void ws;
      const result = await searchSignalClassifications(
        { db: deps.db, store: deps.store, ...(deps.classification ? { classification: deps.classification } : {}) },
        context.readerSub,
        workspaceId,
        query as Parameters<typeof searchSignalClassifications>[3],
      );
      if (result.workspaceId !== workspaceId) throw new Error("Workspace mismatch");
      return result;
    }
    const { workspaceId: ws, ...query } = input;
    void ws;
    const result = await readSignalClassification(
      { db: deps.db, store: deps.store, ...(deps.classification ? { classification: deps.classification } : {}) },
      context.readerSub,
      workspaceId,
      query as Parameters<typeof readSignalClassification>[3],
    );
    if (result.workspaceId !== workspaceId) throw new Error("Workspace mismatch");
    return result;
  };
}
