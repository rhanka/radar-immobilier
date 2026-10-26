import { eq } from "drizzle-orm";
import type { z } from "zod";
import type { Database } from "../../db/client.js";
import { facetActivationState } from "../../db/schema.js";
import { lockWorkspace } from "../workspaces/mutations.js";
import { approvedAccountId, resolveWorkspaceAccess } from "../workspaces/store.js";
import { readProjectionScope } from "./projection-revisions.js";
import { resolveLotRights } from "./lots/lot-capabilities.js";
import { requireOpenLotDestination } from "./lots/lot-gate.js";
import { readLotCutover } from "./lots/lot-cutover-status.js";
import { ScopeError } from "./scope.js";
import { ClassificationError } from "./classification-errors.js";
import { Availability, WorkspaceFacetContext } from "./classification-context-contract.js";
import { digest } from "./target.js";
import { readClassificationCatalog } from "./classification-catalog.js";

function durableAvailabilityOf(state: { maintenanceBarrier: boolean | null; writerEpoch: string | null } | undefined) {
  const availability: z.infer<typeof Availability> = state?.maintenanceBarrier
    ? { state: "closed", reason: "maintenance" } : state?.writerEpoch === "scoped"
      ? { state: "open" } : { state: "closed", reason: "not_activated" };
  return availability;
}

async function readDurableAvailability(db: Database, sub: string, workspaceId: string) {
  return db.transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    await approvedAccountId(tx, sub, true);
    await resolveWorkspaceAccess(tx, workspaceId, sub);
    const [state] = await tx.select().from(facetActivationState).where(eq(facetActivationState.workspaceId, workspaceId));
    const availability = durableAvailabilityOf(state);
    let lotAvailability = availability;
    let selectionBasket: string | null = null;
    if (availability.state === "open") {
      const cutover = await readLotCutover(tx, workspaceId);
      if (cutover.maintenanceBarrier) lotAvailability = { state: "closed", reason: "maintenance" };
      else try { selectionBasket = (await requireOpenLotDestination(tx, workspaceId)).selectionBasket; }
      catch (error) {
        if (!(error instanceof ScopeError) || !error.message.startsWith("lot_destination_disabled:")) throw error;
        lotAvailability = { state: "closed", reason: "not_configured" };
      }
    }
    return { availability: Availability.parse(availability), lotAvailability: Availability.parse(lotAvailability), selectionBasket };
  });
}

async function revalidateContextAuthority(db: Database, sub: string, workspaceId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    await approvedAccountId(tx, sub, true);
    await resolveWorkspaceAccess(tx, workspaceId, sub);
  });
}

async function contextSample(db: Database, sub: string, workspaceId: string) {
  const sample = await db.transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    const access = await resolveWorkspaceAccess(tx, workspaceId, sub);
    const rights = await resolveLotRights(tx, workspaceId, sub);
    const [state] = await tx.select().from(facetActivationState).where(eq(facetActivationState.workspaceId, workspaceId));
    const availability = durableAvailabilityOf(state);
    let lotAvailability = availability;
    let selectionBasket: string | null = null;
    if (availability.state === "open") {
      const cutover = await readLotCutover(tx, workspaceId);
      if (cutover.maintenanceBarrier) lotAvailability = { state: "closed", reason: "maintenance" };
      else try { selectionBasket = (await requireOpenLotDestination(tx, workspaceId)).selectionBasket; }
      catch (error) {
        if (!(error instanceof ScopeError) || !error.message.startsWith("lot_destination_disabled:")) throw error;
        lotAvailability = { state: "closed", reason: "not_configured" };
      }
    }
    return { access, rights, availability: Availability.parse(availability), lotAvailability: Availability.parse(lotAvailability), selectionBasket };
  });
  if (sample.availability.state === "open") {
    try { await readProjectionScope(db, sub, workspaceId, "facet-context", "signal"); }
    catch (error) {
      if (error instanceof ScopeError && error.message === "personal_history_unresolved") {
        sample.availability = { state: "unavailable", reason: "unresolved_history" };
        sample.lotAvailability = sample.availability;
      } else if (error instanceof ScopeError && error.message.startsWith("scoped_facet_scope_unavailable:")) {
        const fresh = await readDurableAvailability(db, sub, workspaceId);
        sample.availability = fresh.availability;
        sample.lotAvailability = fresh.lotAvailability;
        sample.selectionBasket = fresh.selectionBasket;
      } else throw error;
    }
  }
  const catalog = sample.availability.state === "closed"
    ? { availability: sample.availability, profileId: null, digest: null, entries: null }
    : await readClassificationCatalog(db, sub, workspaceId);
  await revalidateContextAuthority(db, sub, workspaceId);
  return WorkspaceFacetContext.parse({ contractVersion: "facet-context-v2", workspaceId,
    semanticProfile: { lotReason: "required", correspondence: "sent", signalClassification: "separate_action",
      semanticContractVersion: "base-classification-v1" },
    signals: { availability: sample.availability, baskets: ["pertinent", "a_surveiller"].map((id) => ({ id, scope: "personal" })),
      canSelectPersonally: true, canDiscardPersonally: true, canModerateArchive: sample.access.moderateArchive,
      queryProfile: "signal-query-basic-v1" },
    lots: { availability: sample.lotAvailability, selectionBasket: sample.selectionBasket,
      modes: sample.lotAvailability.state === "open" ? ["real", "simulation"] : [],
      canSelect: sample.rights.select, canChangePipeline: sample.rights.changePipeline,
      canChangeMarket: sample.rights.changeMarket, canDiscardPersonally: true, canModerateArchive: sample.rights.moderateArchive },
    reasonCatalog: catalog,
  });
}
export async function readFacetContext(db: Database, sub: string, workspaceId: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await contextSample(db, sub, workspaceId);
    const after = await contextSample(db, sub, workspaceId);
    if (digest(before) === digest(after)) return after;
  }
  throw new ClassificationError("projection_revision_unstable");
}
