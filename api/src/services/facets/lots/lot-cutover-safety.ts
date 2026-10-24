/**
 * 6K default deployment safety: in-memory delivery retirement plus an
 * authorized collection readback over every ready city and mode. Replica
 * isolation and reconnect-path retirement stay deployment
 * responsibilities and must be positively confirmed before activation.
 */
import type { Database } from "../../../db/client.js";
import { retireLegacyMarkDelivery } from "../../chat/stream-bus.js";
import { readLotCutoverReadback, type CutoverReadbackHead } from "./lot-cutover-readback.js";
import type {
  ActivationGate,
  CutoverSafety,
} from "./lot-cutover-types.js";
import type {
  LotMigrationReport,
} from "../lot-migration-report/manifest.js";
import { checkCutoverReadbackCoverage, expectedCutoverHeadValues, parseReadyTargetKeys } from "./lot-cutover-expectations.js";
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

/** Qualified, evidence-bound 6K persisted readback. */
export function qualifiedLotCutoverSafety(
  db: Database,
  bound: MaintenanceBinding,
  evidence: unknown,
  readyTargets: string[],
  options: MaintenanceEvidenceOptions = {},
): CutoverSafety {
  return qualifiedLotCutoverSafetyFor(bound, evidence, readyTargets, {
    readbackAuthorized: async (workspaceId: string) => {
      const expected = options.expectedCutoverHeads;
      if (!Array.isArray(expected)) {
        throw new ScopeError(503, "lot_cutover_readback_unconfirmed");
      }
      const parsed = parseReadyTargetKeys(readyTargets);
      if (parsed.length === 0) {
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
      const groups = new Map<string, Set<"real" | "simulation">>();
      for (const target of parsed) {
        const modes = groups.get(target.city) ?? new Set<"real" | "simulation">();
        modes.add(target.mode);
        groups.set(target.city, modes);
      }
      const observed = new Map<string, CutoverReadbackHead>();
      for (const [city, modes] of groups) {
        for (const mode of modes) {
          const result = await readLotCutoverReadback(db, bound.actorSub, workspaceId, mode, city);
          for (const head of result.heads) {
            observed.set(`dest:${result.citySlug}::${head.target.canonicalId}::${result.mode}`, head);
          }
        }
      }
      checkCutoverReadbackCoverage(parsed.map((target) => target.key), observed, expected);
    },
  }, options);
}

/** Server-held maintenance evidence; per-request identities are stamped by the entry route. */
export interface CutoverServerEvidence {
  evidence: unknown;
  maintenanceAttemptId: string;
  releaseId: string;
  instanceIds: string[];
  options?: MaintenanceEvidenceOptions;
}

/**
 * Per-request 6K safety factory for the real entry route. Binds the current
 * workspace, actor and qualified manifest (ready targets plus expected head
 * values) around the server-held evidence; any divergence between the
 * proof identity and the calling actor fails closed at drain and readback.
 */
export function qualifiedCutoverSafetyForRequest(
  db: Database,
  server: CutoverServerEvidence,
  request: { workspaceId: string; actorSub: string; report: LotMigrationReport; gate: ActivationGate },
): CutoverSafety {
  return qualifiedLotCutoverSafety(db, {
    workspaceId: request.workspaceId,
    actorSub: request.actorSub,
    maintenanceAttemptId: server.maintenanceAttemptId,
    releaseId: server.releaseId,
    instanceIds: server.instanceIds,
  }, server.evidence, request.gate.ready, {
    ...(server.options ?? {}),
    expectedCutoverHeads: expectedCutoverHeadValues(request.report, request.gate.activatedSourceIds),
  });
}
