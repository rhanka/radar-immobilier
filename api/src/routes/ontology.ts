import { Hono } from "hono";

import type { ObjectStore } from "../storage/object-store.js";
import {
  parseProjectState,
  projectStateKey,
  type OntologyProjectState,
} from "../services/exploitation/project-state.js";
import {
  seedCityOntology,
  SEED_CITY_SLUGS,
} from "../services/sources/seed-ontology.js";
import {
  seedPvCity,
  PV_SEED_CITY_SLUGS,
  ALL_SIGNALS_CITY_SLUGS,
} from "../services/sources/pv-seed.js";
import { ontologyPatchSchema } from "../services/exploitation/patches.js";
import {
  applyPatch,
  deriveAppliedState,
  DecisionError,
} from "../services/exploitation/decisions.js";

export interface OntologyDeps {
  store: ObjectStore;
  /**
   * Shared secret that gates the reconciliation WRITE route. Injected from
   * `RADAR_ONTOLOGY_WRITE_TOKEN`; when unset (no token configured), the write
   * route is disabled and every patch is refused with 401 (fail-closed).
   */
  ontologyWriteToken?: string | undefined;
}

/** Header the studio sends its write token in (no Authorization reuse). */
export const WRITE_TOKEN_HEADER = "x-radar-write-token";

/**
 * Read-only ontology project-state API (EXPLOITATION output → reconciliation
 * studio). Serves the per-city graphify project state persisted by the
 * exploitation service (D1): canonical entities, reconciliation candidates, and
 * raw mentions — the exact data a reconciliation screen renders. Mutation
 * (accept/reject patches) is deferred to the studio's write-guarded core.
 */
async function loadState(
  store: ObjectStore,
  citySlug: string,
): Promise<OntologyProjectState | null> {
  const key = projectStateKey(citySlug);
  const head = await store.head(key);
  if (!head) return null;
  const bytes = await store.get(key);
  return parseProjectState(bytes);
}

/**
 * Aggregate signal count by city, derived from persisted DesignationEvent
 * canonicals in the ontology project state.
 *
 * Anti-invention: only cities that have a persisted project state contribute a
 * non-zero count. Cities without a state are returned with count=0 (honest
 * placeholder). The 6-month window applies to `generatedAt` — a state older
 * than 6 months is treated as stale and returns 0.
 */
export interface SignalCityItem {
  citySlug: string;
  /** Number of DesignationEvent canonicals in the current project state. */
  designationEventCount: number;
  /** ISO timestamp when the project state was generated; null when no state. */
  generatedAt: string | null;
}

const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000;

export function ontologyRoute(deps: OntologyDeps): Hono {
  const app = new Hono();

  /**
   * GET /api/signals/by-city — aggregate DesignationEvent counts per city.
   *
   * Iterates over all cities that have a committed ontology seed (SEED_CITY_SLUGS),
   * loads their project state from object storage, and counts DesignationEvent
   * canonicals whose project state was generated within the last 6 months.
   *
   * Anti-invention policy: cities without a project state or with a stale state
   * (> 6 months old) return designationEventCount=0. No signal is fabricated.
   */
  app.get("/api/signals/by-city", async (c) => {
    const now = Date.now();
    const items: SignalCityItem[] = await Promise.all(
      ALL_SIGNALS_CITY_SLUGS.map(async (citySlug): Promise<SignalCityItem> => {
        const state = await loadState(deps.store, citySlug);
        if (!state) {
          return { citySlug, designationEventCount: 0, generatedAt: null };
        }
        const stateAgeMs = now - Date.parse(state.generatedAt);
        if (stateAgeMs > SIX_MONTHS_MS) {
          return { citySlug, designationEventCount: 0, generatedAt: state.generatedAt };
        }
        const designationEventCount = state.canonicals.filter(
          (c) => c.type === "DesignationEvent",
        ).length;
        return { citySlug, designationEventCount, generatedAt: state.generatedAt };
      }),
    );
    return c.json({ ok: true, items });
  });

  /**
   * Canonical entities for the reconciliation screen — re-derived with any
   * persisted human decisions applied (so a refetch after a patch reflects the
   * new clustering / status), falling back to the persisted canonicals when no
   * decision log exists.
   */
  app.get("/api/ontology/:city/entities", async (c) => {
    const city = c.req.param("city");
    const state = await loadState(deps.store, city);
    if (!state) {
      return c.json({ ok: false, error: "no-project-state", city }, 404);
    }
    const applied = await deriveAppliedState(deps.store, city);
    return c.json({
      ok: true,
      citySlug: state.citySlug,
      profileHash: state.profileHash,
      generatedAt: state.generatedAt,
      entities: applied.entities,
    });
  });

  /** Reconciliation candidates (entity_match queue) — minus human-rejected pairs. */
  app.get("/api/ontology/:city/candidates", async (c) => {
    const city = c.req.param("city");
    const state = await loadState(deps.store, city);
    if (!state) {
      return c.json({ ok: false, error: "no-project-state", city }, 404);
    }
    const applied = await deriveAppliedState(deps.store, city);
    return c.json({
      ok: true,
      citySlug: state.citySlug,
      profileHash: state.profileHash,
      generatedAt: state.generatedAt,
      candidates: applied.candidates,
    });
  });

  /** Raw modeled-entity mentions. */
  app.get("/api/ontology/:city/mentions", async (c) => {
    const city = c.req.param("city");
    const state = await loadState(deps.store, city);
    if (!state) {
      return c.json({ ok: false, error: "no-project-state", city }, 404);
    }
    return c.json({
      ok: true,
      citySlug: state.citySlug,
      profileHash: state.profileHash,
      generatedAt: state.generatedAt,
      rawRefs: state.rawRefs,
      mentions: state.mentions,
    });
  });

  /**
   * POST /api/ontology/:city/exploit-samples — NETWORK-FREE real-data seed
   * (SPEC_ONTOLOGY §0.2). Wraps the city's REAL committed MAMH role sample bytes
   * as a RawDocument in S3 (reusing the RECUEIL substrate), runs EXPLOITATION +
   * the radar validators (D3), and persists the per-city project state so the
   * reconciliation studio is populated with REAL entities on a fresh stack.
   * No fabrication: every entity comes from `parseRoleEvaluation` on real bytes.
   */
  app.post("/api/ontology/:city/exploit-samples", async (c) => {
    const city = c.req.param("city");
    if (!SEED_CITY_SLUGS.includes(city)) {
      return c.json(
        {
          ok: false,
          error: "unknown-city",
          detail: `No committed role sample for "${city}"`,
          available: SEED_CITY_SLUGS,
        },
        404,
      );
    }
    const result = await seedCityOntology(deps.store, city);
    return c.json(
      {
        ok: result.ok,
        citySlug: result.citySlug,
        rawRef: result.rawRef,
        avisRawRef: result.avisRawRef,
        adresseRawRef: result.adresseRawRef,
        reglementRawRefs: result.reglementRawRefs,
        mentionCount: result.mentionCount,
        candidateCount: result.candidateCount,
        canonicalCount: result.canonicalCount,
        signalCount: result.signalCount,
        realEntities: result.realEntities,
        realAvis: result.realAvis,
        realAdresses: result.realAdresses,
        realReglements: result.realReglements,
        stateKey: result.stateKey,
        validation: result.validation,
      },
      200,
    );
  });

  /**
   * POST /api/ontology/:city/exploit-pv-samples — NETWORK-FREE seed PV Rive-Sud.
   *
   * Sème la fixture PV réelle (extrait pdftotext) dans l'objet-store puis lance
   * EXPLOITATION pour produire les mentions/canoniques Bylaw + DesignationEvent.
   * Disponible pour les villes PV Rive-Sud (saint-constant, sainte-catherine).
   * Anti-invention : un DesignationEvent n'est émis que si detectZonageChange()
   * retourne changementZonage:true sur le texte brut réel.
   *
   * Usage démo (sans réseau) :
   *   curl -X POST http://localhost:5301/api/ontology/saint-constant/exploit-pv-samples
   *   curl -X POST http://localhost:5301/api/ontology/sainte-catherine/exploit-pv-samples
   */
  app.post("/api/ontology/:city/exploit-pv-samples", async (c) => {
    const city = c.req.param("city");
    if (!PV_SEED_CITY_SLUGS.includes(city)) {
      return c.json(
        {
          ok: false,
          error: "unknown-city",
          detail: `No committed PV sample for "${city}"`,
          available: PV_SEED_CITY_SLUGS,
        },
        404,
      );
    }
    const result = await seedPvCity(deps.store, city);
    return c.json(
      {
        ok: result.ok,
        citySlug: result.citySlug,
        pvRawRef: result.pvRawRef,
        mentionCount: result.mentionCount,
        candidateCount: result.candidateCount,
        canonicalCount: result.canonicalCount,
        designationEventCount: result.designationEventCount,
        stateKey: result.stateKey,
      },
      200,
    );
  });

  /**
   * POST /api/ontology/:city/patch — the WRITE-CORE mutation (token-gated). Body
   * is ONE `graphify_ontology_patch_v1` op (accept_match / reject_match /
   * set_status). The op is persisted to the city's append-only patch log and
   * re-applied, returning the updated read-model `{ entities, candidates }`.
   *
   * Auth: a shared secret in the `x-radar-write-token` header must equal the
   * configured `RADAR_ONTOLOGY_WRITE_TOKEN`. A missing token config, a missing
   * header, or a mismatch → 401 (fail-closed; the screen stays read-only).
   */
  app.post("/api/ontology/:city/patch", async (c) => {
    const expected = deps.ontologyWriteToken;
    const provided = c.req.header(WRITE_TOKEN_HEADER);
    if (!expected || !provided || provided !== expected) {
      return c.json(
        {
          ok: false,
          error: "unauthorized",
          detail: "Missing or invalid write token.",
        },
        401,
      );
    }

    const city = c.req.param("city");
    const parsed = ontologyPatchSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return c.json(
        { ok: false, error: "invalid-patch", details: parsed.error.issues },
        400,
      );
    }

    try {
      const applied = await applyPatch(deps.store, city, parsed.data);
      return c.json(
        {
          ok: true,
          citySlug: city,
          op: parsed.data.op,
          entities: applied.entities,
          candidates: applied.candidates,
        },
        200,
      );
    } catch (e) {
      if (e instanceof DecisionError) {
        const status = e.code === "no-project-state" ? 404 : 422;
        return c.json({ ok: false, error: e.code, detail: e.message }, status);
      }
      throw e;
    }
  });

  return app;
}
