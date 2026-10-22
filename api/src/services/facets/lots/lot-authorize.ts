/**
 * 6J lot command shape validation and D4 authorization.
 *
 * Shared by the single writer, the atomic batch, and the route schemas:
 * one rule set, no divergent enforcement. Client-supplied actor, owner,
 * tenant, or scope fields are rejected; personal scope supports archive
 * and restoration only and can never remove a workspace basket
 * membership; workspace composite discard/deselect requires moderation
 * plus the selection right; pipeline and market require their distinct
 * rights.
 */
import { FacetError } from "../target.js";
import {
  LOT_IMPORT_UNKNOWN_REASON,
  type LotMutation,
  type LotScope,
} from "./lot-commands.js";
import type { LotRights } from "./lot-capabilities.js";
import { assertAskingPrice, assertListingUrl, assertPipelineStatus } from "./lot-values.js";

export function validateLotMutationShape(scope: LotScope, mutation: LotMutation): void {
  if ((mutation as { actor?: unknown }).actor !== undefined
    || (mutation as { owner?: unknown }).owner !== undefined
    || (mutation as { tenant?: unknown }).tenant !== undefined
    || (mutation as { scope?: unknown }).scope !== undefined) {
    throw new FacetError(400, "invalid_facet_command");
  }
  if (scope === "personal" && mutation.action !== "discard" && mutation.action !== "restore") {
    throw new FacetError(400, "invalid_facet_command");
  }
  if (scope === "personal" && mutation.action === "discard" && mutation.deselect !== undefined) {
    throw new FacetError(400, "invalid_facet_command");
  }
  if (mutation.action === "discard" && mutation.reasonCode === LOT_IMPORT_UNKNOWN_REASON) {
    throw new FacetError(422, "invalid_reason_code");
  }
  if (mutation.action === "set_market") {
    assertAskingPrice(mutation.asking_price);
    assertListingUrl(mutation.listing_url);
  }
  if (mutation.action === "set_pipeline") assertPipelineStatus(mutation.status);
}

export function authorizeLotMutation(
  rights: LotRights, scope: LotScope, mutation: LotMutation, selectionBasket: string,
): void {
  switch (mutation.action) {
    case "select":
    case "deselect":
      if (mutation.basket_id !== selectionBasket) throw new FacetError(400, "invalid_facet_command");
      if (!rights.select) throw new FacetError(403, "workspace_capability_required");
      return;
    case "discard":
      if (scope === "workspace" && !rights.moderateArchive) {
        throw new FacetError(403, "workspace_capability_required");
      }
      for (const entry of mutation.deselect ?? []) {
        if (entry.basket_id !== selectionBasket) throw new FacetError(400, "invalid_facet_command");
      }
      if ((mutation.deselect ?? []).length > 0 && scope === "workspace" && !rights.select) {
        throw new FacetError(403, "workspace_capability_required");
      }
      return;
    case "restore":
      if (scope === "workspace" && !rights.moderateArchive) {
        throw new FacetError(403, "workspace_capability_required");
      }
      return;
    case "set_pipeline":
    case "clear_pipeline":
      if (!rights.changePipeline) throw new FacetError(403, "workspace_capability_required");
      return;
    case "set_market":
    case "clear_market":
      if (!rights.changeMarket) throw new FacetError(403, "workspace_capability_required");
      return;
  }
}
