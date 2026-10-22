/**
 * 6J lot event response: explicit public fields for command snapshots,
 * current heads, and authorized conflict disclosure.
 *
 * Private owners, actor IDs, and command digests never appear here.
 */
import type { facetEvents } from "../../../db/schema.js";
import type { DisplayedLotVersion, LotTarget } from "./lot-target.js";
import type { LotMode } from "./lot-target.js";

type LotEventRow = Pick<typeof facetEvents.$inferSelect,
  | "id" | "citySlug" | "nodeType" | "nodeId" | "facet" | "basket" | "state"
  | "reasonCode" | "verdict" | "mode" | "observedLotVersion" | "askingPrice"
  | "listingUrl" | "pipelineStatus" | "observedFingerprint" | "supersedes"
  | "supersededBy"> & { createdAt: Date | string };

export interface LotEventSnapshot {
  id: string;
  target: LotTarget;
  mode: LotMode;
  facet: string;
  basket: string | null;
  state: string;
  reasonCode: string | null;
  verdict: string | null;
  pipelineStatus: string | null;
  askingPrice: string | null;
  listingUrl: string | null;
  displayedVersion: DisplayedLotVersion;
  createdAt: string;
}

export function lotEventResponse(event: LotEventRow): LotEventSnapshot {
  return {
    id: event.id,
    target: {
      type: "Lot",
      authority: "lot_versions",
      citySlug: event.citySlug,
      canonicalId: event.nodeId,
    },
    mode: (event.mode ?? "real") as LotMode,
    facet: event.facet,
    basket: event.basket,
    state: event.state,
    reasonCode: event.reasonCode,
    verdict: event.verdict,
    pipelineStatus: event.pipelineStatus,
    askingPrice: event.askingPrice,
    listingUrl: event.listingUrl,
    displayedVersion: {
      lot_version_id: event.observedLotVersion ?? "",
      fingerprint: event.observedFingerprint,
    },
    createdAt: typeof event.createdAt === "string" ? event.createdAt : event.createdAt.toISOString(),
  };
}
