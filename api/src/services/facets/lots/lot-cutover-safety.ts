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
