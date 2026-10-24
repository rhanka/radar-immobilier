/**
 * 6K default deployment safety: in-memory delivery retirement plus an
 * authorized collection readback over every ready city and mode. Replica
 * isolation and reconnect-path retirement stay deployment
 * responsibilities and must be positively confirmed before activation.
 */
import type { Database } from "../../../db/client.js";
import { retireLegacyMarkDelivery } from "../../chat/stream-bus.js";
import { readLotCutoverReadback } from "./lot-cutover-readback.js";
import type { CutoverSafety } from "./lot-cutover-types.js";
import {
  qualifiedLotCutoverSafetyFor,
  type MaintenanceBinding,
  type MaintenanceEvidenceOptions,
} from "../activation-maintenance-safety.js";
import { ScopeError } from "../scope.js";

/** Default safety for the explicit operator cutover. */
export function defaultCutoverSafety(
  db: Database, actorSub: string, readyTargets: string[],
): CutoverSafety {
  return {
    drainDeliveryPaths: async () => {
      retireLegacyMarkDelivery();
      throw new ScopeError(503, "lot_delivery_retirement_unconfirmed");
    },
    readbackAuthorized: async (workspaceId: string) => {
      const cities = new Map<string, Set<string>>();
      for (const key of readyTargets) {
        const parts = key.split("::");
        const city = parts[0]?.startsWith("dest:") === true
          ? parts[0].slice("dest:".length) : undefined;
        const mode = parts[2];
        if (!city || (mode !== "real" && mode !== "simulation")) continue;
        const modes = cities.get(city) ?? new Set<string>();
        modes.add(mode);
        cities.set(city, modes);
      }
      for (const [city, modes] of cities) {
        for (const mode of modes) {
          await readLotCutoverReadback(db, actorSub, workspaceId,
            mode as "real" | "simulation", city);
        }
      }
    },
  };
}

/**
 * Qualified 6K safety bound to the current authorized actor and workspace.
 *
 * Internal only: `bound` and `evidence` are server-supplied, never taken from
 * client input. Drain validates the qualified maintenance evidence for every
 * expected instance. Readback validates the same evidence, rejects an
 * undeclared empty ready-target set, then verifies every ready city and mode
 * with the real internal reader under the closed barrier using the current
 * rights of `bound.actorSub`. A declared qualified empty manifest passes only
 * through a real zero-head proof over `options.emptyReadbackScope`; this
 * preserves the B2 qualified empty opening with no new behavior. 6K keeps its
 * legacy fence; this adapter never clears it. Opening `destinationOpen`
 * stays in `openLotDestination`.
 */
export function qualifiedLotCutoverSafety(
  db: Database,
  bound: MaintenanceBinding,
  evidence: unknown,
  readyTargets: string[],
  options: MaintenanceEvidenceOptions = {},
): CutoverSafety {
  return qualifiedLotCutoverSafetyFor(bound, evidence, readyTargets, {
    readbackAuthorized: async (workspaceId: string) => {
      const cities = new Map<string, Set<string>>();
      for (const key of readyTargets) {
        const parts = key.split("::");
        const city = parts[0]?.startsWith("dest:") === true
          ? parts[0].slice("dest:".length) : undefined;
        const mode = parts[2];
        if (!city || (mode !== "real" && mode !== "simulation")) continue;
        const modes = cities.get(city) ?? new Set<string>();
        modes.add(mode);
        cities.set(city, modes);
      }
      if (cities.size === 0) {
        if (options.qualifiedEmptyManifest !== true) {
          throw new ScopeError(503, "lot_cutover_readback_unconfirmed");
        }
        const scope = options.emptyReadbackScope;
        if (!scope || scope.citySlugs.length === 0 || scope.modes.length === 0) {
          throw new ScopeError(503, "lot_cutover_readback_unconfirmed");
        }
        for (const city of scope.citySlugs) {
          for (const mode of scope.modes) {
            const seen = await readLotCutoverReadback(db, bound.actorSub, workspaceId, mode, city);
            if (seen.heads.length !== 0) throw new ScopeError(503, "lot_cutover_readback_unconfirmed");
          }
        }
        return;
      }
      for (const [city, modes] of cities) {
        for (const mode of modes) {
          await readLotCutoverReadback(db, bound.actorSub, workspaceId,
            mode as "real" | "simulation", city);
        }
      }
    },
  }, options);
}
