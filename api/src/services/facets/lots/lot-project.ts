/**
 * 6J terminal-head projection.
 *
 * Projects only qualified terminal heads — head-only initialization, never
 * three active facets from one chain. A stream that already carries a head
 * is counted as already projected; anything else unexpected is skipped
 * with an explicit cause instead of inventing a disposition.
 */
import type { Database } from "../../../db/client.js";
import { digest, FacetError } from "../target.js";
import type { ManifestRow } from "../lot-migration-report/manifest.js";
import {
  LOT_IMPORT_UNKNOWN_REASON,
  lotCommandDigest,
  type LotCommand,
  type LotMutation,
} from "./lot-commands.js";
import { resolveLotSource, type LotTarget } from "./lot-target.js";
import { appendLotTransition } from "./lot-apply.js";
import { planLotStreams } from "./lot-transition.js";
import { facetForMutation } from "./lot-plan.js";
import { resolveLotStream } from "./lot-streams.js";
import { assertAskingPrice, assertListingUrl } from "./lot-values.js";
import { lockLotImportTargets } from "./lot-import-locks.js";

type LotTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface ProjectionInput {
  workspaceId: string;
  key: string;
  runId: string;
  actorId: string;
  selectionBasket: string;
}

/** Heads eligible for projection: qualified mapping, terminal, single destination. */
export function isProjectableHead(row: ManifestRow, mappingQualified: boolean): boolean {
  return mappingQualified
    && row.disposition === "mapped"
    && row.destination !== null
    && (row.observed.supersededBy ?? null) === null;
}

export async function projectTerminalHeads(
  tx: LotTx, input: ProjectionInput, ordered: ManifestRow[], mappingQualified: boolean,
): Promise<{ projected: number; alreadyProjected: number; skipped: Array<{ sourceId: string; cause: string }> }> {
  let projected = 0;
  let alreadyProjected = 0;
  const skipped: Array<{ sourceId: string; cause: string }> = [];
  const seenStreams = new Set<string>();
  await lockLotImportTargets(tx, ordered);
  for (const row of ordered) {
    if (!isProjectableHead(row, mappingQualified) || !row.destination) continue;
    const target: LotTarget = {
      type: "Lot", authority: "lot_versions",
      citySlug: row.destination.citySlug, canonicalId: row.destination.canonicalTarget,
    };
    const streamKey = JSON.stringify(
      [target.citySlug, target.canonicalId, row.destination.mode, row.destination.facet]);
    if (seenStreams.has(streamKey)) {
      skipped.push({ sourceId: row.sourceId, cause: "duplicate-destination-head" });
      continue;
    }
    seenStreams.add(streamKey);
    let mutation: LotMutation;
    try {
      mutation = projectionMutation(row, input.selectionBasket);
    } catch {
      skipped.push({ sourceId: row.sourceId, cause: "invalid-projected-value" });
      continue;
    }
    const resolved = await resolveLotSource(tx, target).catch(() => null);
    if (!resolved) {
      skipped.push({ sourceId: row.sourceId, cause: "target-unresolved-at-import" });
      continue;
    }
    const command: LotCommand = {
      contract_version: "lot-facets-v1",
      command_key: input.key,
      mode: row.destination.mode,
      target,
      displayed_version: resolved.displayed,
      expected_head_id: null,
      mutation,
    };
    const { facet, basket } = facetForMutation(mutation);
    const probe = await resolveLotStream(tx, input.workspaceId, "workspace", null,
      row.destination.mode, target, facet, basket);
    if (probe.headEventId) {
      alreadyProjected += 1;
      continue;
    }
    const base = lotCommandDigest("workspace", "single", input.workspaceId,
      { ...command, command_key: input.key });
    const commandDigest = digest({
      scope: "workspace", workspaceId: input.workspaceId.toLowerCase(), command: base,
    });
    const plan = await planLotStreams(tx, input.workspaceId, "workspace", input.actorId,
      command, target).catch(() => null);
    if (!plan) {
      skipped.push({ sourceId: row.sourceId, cause: "destination-head-conflict" });
      continue;
    }
    const outcome = await appendLotTransition(tx, input.workspaceId, "workspace", input.actorId,
      command, target, plan, resolved.fingerprint, commandDigest,
      {
        allowImportProvenance: true,
        provenance: {
          sourceAuthor: row.observed.authorId,
          sourceCreatedAt: row.observed.createdAt,
          importRunId: input.runId,
          sourceRowId: row.sourceId,
          sourceChainId: row.chainId,
        },
      });
    if (outcome.appended.length > 0) projected += 1;
    else alreadyProjected += 1;
  }
  return { projected, alreadyProjected, skipped };
}

function projectionMutation(row: ManifestRow, selectionBasket: string): LotMutation {
  const facet = row.destination?.facet;
  const statut = row.observed.statut;
  switch (facet) {
    case "selection":
      if (statut !== "favori") throw new FacetError(422, "invalid_business_value");
      return { action: "select", basket_id: selectionBasket };
    case "pipeline":
      if (statut !== "sollicite" && statut !== "lettre_envoyee") {
        throw new FacetError(422, "invalid_business_value");
      }
      return { action: "set_pipeline", status: statut };
    case "market": {
      if (statut !== "en_vente") throw new FacetError(422, "invalid_business_value");
      assertAskingPrice(row.observed.prixDemande);
      assertListingUrl(row.observed.lienAnnonce);
      return {
        action: "set_market", status: "en_vente",
        asking_price: row.observed.prixDemande, listing_url: row.observed.lienAnnonce,
      };
    }
    case "archive":
      if (statut !== "ecarte") throw new FacetError(422, "invalid_business_value");
      return { action: "discard", reasonCode: LOT_IMPORT_UNKNOWN_REASON };
    default:
      throw new FacetError(422, "invalid_business_value");
  }
}
