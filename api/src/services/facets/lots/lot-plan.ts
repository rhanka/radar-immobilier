/**
 * 6J lot stream plan model.
 *
 * One command targets one facet stream plus, for workspace composite
 * discard/deselect, the named selection streams. Desired values derive
 * from the mutation alone; planning and comparison live in
 * `lot-transition.ts`, atomic application in `lot-apply.ts`.
 */
import { FACET_PROFILE } from "../codebook.js";
import type { LotMutation } from "./lot-commands.js";
import { normalizeAskingPrice } from "./lot-values.js";
import type { LotFacet, LotStreamRef } from "./lot-streams.js";
import type { facetEvents } from "../../../db/schema.js";

export interface PlannedStream {
  facet: LotFacet;
  basket: string | null;
  ref: LotStreamRef;
  current: typeof facetEvents.$inferSelect | null;
}

export interface LotPlan {
  facet: LotFacet;
  basket: string | null;
  ownerId: string | null;
  main: PlannedStream;
  removals: PlannedStream[];
  desired: {
    state: "active" | "inactive";
    reasonCode: string | null;
    profileId: string | null;
    verdict: string | null;
    pipelineStatus: string | null;
    askingPrice: string | null;
    listingUrl: string | null;
  };
}

export function facetForMutation(mutation: LotMutation): { facet: LotFacet; basket: string | null } {
  switch (mutation.action) {
    case "select":
    case "deselect":
      return { facet: "selection", basket: mutation.basket_id };
    case "discard":
    case "restore":
      return { facet: "archive", basket: null };
    case "set_pipeline":
    case "clear_pipeline":
      return { facet: "pipeline", basket: null };
    case "set_market":
    case "clear_market":
      return { facet: "market", basket: null };
  }
}

export function desiredFor(mutation: LotMutation): LotPlan["desired"] {
  switch (mutation.action) {
    case "select":
      return { state: "active", reasonCode: null, profileId: null, verdict: null,
        pipelineStatus: null, askingPrice: null, listingUrl: null };
    case "deselect":
      return { state: "inactive", reasonCode: null, profileId: null, verdict: null,
        pipelineStatus: null, askingPrice: null, listingUrl: null };
    case "discard":
      return { state: "active", reasonCode: mutation.reasonCode ?? null, profileId: FACET_PROFILE,
        verdict: "non_pertinent", pipelineStatus: null, askingPrice: null, listingUrl: null };
    case "restore":
      return { state: "inactive", reasonCode: null, profileId: null, verdict: null,
        pipelineStatus: null, askingPrice: null, listingUrl: null };
    case "set_pipeline":
      return { state: "active", reasonCode: null, profileId: null, verdict: null,
        pipelineStatus: mutation.status, askingPrice: null, listingUrl: null };
    case "clear_pipeline":
      return { state: "inactive", reasonCode: null, profileId: null, verdict: null,
        pipelineStatus: null, askingPrice: null, listingUrl: null };
    case "set_market":
      return { state: "active", reasonCode: null, profileId: null, verdict: null,
        pipelineStatus: null, askingPrice: normalizeAskingPrice(mutation.asking_price),
        listingUrl: mutation.listing_url };
    case "clear_market":
      return { state: "inactive", reasonCode: null, profileId: null, verdict: null,
        pipelineStatus: null, askingPrice: null, listingUrl: null };
  }
}
