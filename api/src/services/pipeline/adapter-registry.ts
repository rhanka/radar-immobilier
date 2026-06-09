import {
  AVIS_PUBLICS_BEAUHARNOIS_CITY,
  AVIS_PUBLICS_BEAUHARNOIS_SOURCE_ID,
  AVIS_PUBLICS_CITY,
  AVIS_PUBLICS_SOURCE_ID,
  REGLEMENTS_URBANISME_CITY,
  REGLEMENTS_URBANISME_SOURCE_ID,
  adressesSourceId,
  createAdressesQuebecAdapter,
  createAvisPublicsBeauharnoisAdapter,
  createAvisPublicsValleyfieldAdapter,
  createReglementsUrbanismeValleyfieldAdapter,
  createRoleEvaluationMamhAdapter,
  roleSourceId,
  type SourceAdapter,
} from "@radar/sources";

/**
 * PIPELINE adapter registry — the single seam mapping a REAL `prioritySources`
 * binding id to a live `SourceAdapter` factory + the city slug its output lands
 * in. The pipeline executor consumes this to drive recueil → exploitation per
 * (citySlug × sourceBinding) declared by a `CiblagePlan`.
 *
 * Tests inject a *fixture* registry of the SAME shape (adapters whose `fetchImpl`
 * is wired to committed fixtures) so a plan executes end-to-end with NO network.
 * Production uses `defaultAdapterRegistry()` whose factories hit public endpoints.
 */

/** Pilot-city MAMH rôle codes (Valleyfield 70052, Beauharnois 70022). */
export const ROLE_MAMH_VALLEYFIELD = "70052";
export const ROLE_MAMH_BEAUHARNOIS = "70022";

/** One resolvable collectible source: how to build its adapter + its city. */
export interface AdapterEntry {
  /** Concrete, collectible source id used as the RawDocument `source`. */
  readonly sourceId: string;
  /** City slug the collected docs are exploited under (per-city project). */
  readonly city: string;
  /** Build a fresh, stateless adapter (J0 contract). */
  readonly build: () => SourceAdapter;
}

/** A registry resolving a (possibly abstract) binding id → an AdapterEntry. */
export interface AdapterRegistry {
  /**
   * Resolve a CiblagePlan `sourceBindingId` to a concrete collectible entry,
   * optionally constrained to a target city (for abstract bindings that fan out
   * per city). Returns `undefined` when no adapter is registered for the binding
   * (the executor records an honest `skipped` step — never a fabricated one).
   */
  resolve(bindingId: string, city?: string): AdapterEntry | undefined;
}

/**
 * Build a registry from a flat list of concrete entries plus an alias table that
 * maps ABSTRACT catalogue binding ids (e.g. `roles-evaluation-fonciere-mamh`) to
 * the concrete collectible ids (e.g. `role-evaluation-mamh-70052`). A plan may
 * select either the abstract product or a concrete per-municipality binding; both
 * resolve here. When an abstract id maps to several concrete ids, the optional
 * `city` filter picks the right one.
 */
export function buildAdapterRegistry(
  entries: readonly AdapterEntry[],
  aliases: Readonly<Record<string, readonly string[]>> = {},
): AdapterRegistry {
  const byId = new Map<string, AdapterEntry>();
  for (const e of entries) byId.set(e.sourceId, e);

  function pick(
    candidateIds: readonly string[],
    city?: string,
  ): AdapterEntry | undefined {
    const resolved = candidateIds
      .map((id) => byId.get(id))
      .filter((e): e is AdapterEntry => e !== undefined);
    if (resolved.length === 0) return undefined;
    if (city !== undefined) {
      return resolved.find((e) => e.city === city) ?? undefined;
    }
    return resolved[0];
  }

  return {
    resolve(bindingId, city) {
      // 1) Direct concrete binding (also honour a city filter if it mismatches).
      const direct = byId.get(bindingId);
      if (direct) {
        if (city !== undefined && direct.city !== city) {
          // Plan targets a city this concrete binding doesn't serve → skip.
          return undefined;
        }
        return direct;
      }
      // 2) Abstract catalogue id → one-or-more concrete ids (city-disambiguated).
      const alias = aliases[bindingId];
      if (alias) return pick(alias, city);
      return undefined;
    },
  };
}

/**
 * The production registry: every concrete collectible source wired to its REAL
 * network adapter. Abstract catalogue bindings are aliased to the per-city
 * concrete ids so a plan that selected the abstract product still runs.
 *
 * Network note: these factories collect PUBLIC / open data only (avis publics
 * indexes, MAMH rôle XML, terrAPI addresses, urbanisme bylaw PDFs). No login,
 * paywall, or CAPTCHA. A live run on radar-dev fetches the real endpoints; CI
 * tests inject a fixture registry instead and never touch the network.
 */
export function defaultAdapterRegistry(): AdapterRegistry {
  const entries: AdapterEntry[] = [
    {
      sourceId: AVIS_PUBLICS_SOURCE_ID,
      city: AVIS_PUBLICS_CITY,
      build: () => createAvisPublicsValleyfieldAdapter(),
    },
    {
      sourceId: AVIS_PUBLICS_BEAUHARNOIS_SOURCE_ID,
      city: AVIS_PUBLICS_BEAUHARNOIS_CITY,
      build: () => createAvisPublicsBeauharnoisAdapter(),
    },
    {
      sourceId: REGLEMENTS_URBANISME_SOURCE_ID,
      city: REGLEMENTS_URBANISME_CITY,
      build: () => createReglementsUrbanismeValleyfieldAdapter(),
    },
    {
      sourceId: roleSourceId(ROLE_MAMH_VALLEYFIELD),
      city: AVIS_PUBLICS_CITY,
      build: () =>
        createRoleEvaluationMamhAdapter({
          codeMamh: ROLE_MAMH_VALLEYFIELD,
          city: AVIS_PUBLICS_CITY,
        }),
    },
    {
      sourceId: roleSourceId(ROLE_MAMH_BEAUHARNOIS),
      city: AVIS_PUBLICS_BEAUHARNOIS_CITY,
      build: () =>
        createRoleEvaluationMamhAdapter({
          codeMamh: ROLE_MAMH_BEAUHARNOIS,
          city: AVIS_PUBLICS_BEAUHARNOIS_CITY,
        }),
    },
    {
      sourceId: adressesSourceId(ROLE_MAMH_VALLEYFIELD),
      city: AVIS_PUBLICS_CITY,
      build: () =>
        createAdressesQuebecAdapter({
          codeMamh: ROLE_MAMH_VALLEYFIELD,
          city: AVIS_PUBLICS_CITY,
        }),
    },
    {
      sourceId: adressesSourceId(ROLE_MAMH_BEAUHARNOIS),
      city: AVIS_PUBLICS_BEAUHARNOIS_CITY,
      build: () =>
        createAdressesQuebecAdapter({
          codeMamh: ROLE_MAMH_BEAUHARNOIS,
          city: AVIS_PUBLICS_BEAUHARNOIS_CITY,
        }),
    },
  ];

  // Abstract catalogue bindings → concrete collectible ids (city-disambiguated).
  const aliases: Record<string, readonly string[]> = {
    "roles-evaluation-fonciere-mamh": [
      roleSourceId(ROLE_MAMH_VALLEYFIELD),
      roleSourceId(ROLE_MAMH_BEAUHARNOIS),
    ],
    "roles-evaluation-fonciere-mamh-beauharnois": [
      roleSourceId(ROLE_MAMH_BEAUHARNOIS),
    ],
    "adresses-quebec-igo-geocoder": [
      adressesSourceId(ROLE_MAMH_VALLEYFIELD),
      adressesSourceId(ROLE_MAMH_BEAUHARNOIS),
    ],
  };

  return buildAdapterRegistry(entries, aliases);
}
