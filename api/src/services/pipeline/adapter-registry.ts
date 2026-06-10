import {
  AVIS_PUBLICS_BEAUHARNOIS_CITY,
  AVIS_PUBLICS_BEAUHARNOIS_SOURCE_ID,
  AVIS_PUBLICS_CITY,
  AVIS_PUBLICS_SOURCE_ID,
  BEAUHARNOIS_AVIS_CONFIG,
  CHATEAUGUAY_PV_CONFIG,
  DELSON_PV_CONFIG,
  LAPRAIRIE_PV_CONFIG,
  REGLEMENTS_URBANISME_CITY,
  REGLEMENTS_URBANISME_SOURCE_ID,
  SAINT_DAMASE_PV_CONFIG,
  SAINTE_CATHERINE_PV_CONFIG,
  SAINT_CONSTANT_PV_CONFIG,
  SAINTE_MARTINE_PV_CONFIG,
  SAINT_REMI_PV_CONFIG,
  VALLEYFIELD_AVIS_CONFIG,
  VALLEYFIELD_YOUTUBE_CONFIG,
  VAUDREUIL_DORION_PV_CONFIG,
  adressesSourceId,
  createAdressesQuebecAdapter,
  createAvisPublicsAdapter,
  createAvisPublicsBeauharnoisAdapter,
  createAvisPublicsValleyfieldAdapter,
  createProcesVerbauxAdapter,
  createReglementsUrbanismeValleyfieldAdapter,
  createRoleEvaluationMamhAdapter,
  createYouTubeSeancesAdapter,
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

/** Generic source IDs for config-driven adapters (procès-verbaux, avis, youtube). */
export const PV_SAINT_DAMASE_SOURCE_ID = SAINT_DAMASE_PV_CONFIG.sourceId;
export const PV_SAINTE_CATHERINE_SOURCE_ID = SAINTE_CATHERINE_PV_CONFIG.sourceId;
export const PV_SAINT_CONSTANT_SOURCE_ID = SAINT_CONSTANT_PV_CONFIG.sourceId;
export const PV_LAPRAIRIE_SOURCE_ID = LAPRAIRIE_PV_CONFIG.sourceId;
export const PV_CHATEAUGUAY_SOURCE_ID = CHATEAUGUAY_PV_CONFIG.sourceId;
export const PV_DELSON_SOURCE_ID = DELSON_PV_CONFIG.sourceId;
export const PV_VAUDREUIL_DORION_SOURCE_ID = VAUDREUIL_DORION_PV_CONFIG.sourceId;
export const PV_SAINTE_MARTINE_SOURCE_ID = SAINTE_MARTINE_PV_CONFIG.sourceId;
export const PV_SAINT_REMI_SOURCE_ID = SAINT_REMI_PV_CONFIG.sourceId;
export const AVIS_PUBLICS_VALLEYFIELD_GENERIC_SOURCE_ID =
  VALLEYFIELD_AVIS_CONFIG.sourceId;
export const AVIS_PUBLICS_BEAUHARNOIS_GENERIC_SOURCE_ID =
  BEAUHARNOIS_AVIS_CONFIG.sourceId;
export const YOUTUBE_SEANCES_VALLEYFIELD_SOURCE_ID = "youtube-seances-salaberry-de-valleyfield";

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
    // ── Generic config-driven adapters ──────────────────────────────────────
    // procès-verbaux: Saint-Damase (WordPress, simple, easy-first target)
    {
      sourceId: PV_SAINT_DAMASE_SOURCE_ID,
      city: SAINT_DAMASE_PV_CONFIG.citySlug,
      build: () => createProcesVerbauxAdapter(SAINT_DAMASE_PV_CONFIG),
    },
    // procès-verbaux: Sainte-Catherine (Rive-Sud, MRC Roussillon, ~25 km SW Montréal)
    {
      sourceId: PV_SAINTE_CATHERINE_SOURCE_ID,
      city: SAINTE_CATHERINE_PV_CONFIG.citySlug,
      build: () => createProcesVerbauxAdapter(SAINTE_CATHERINE_PV_CONFIG),
    },
    // procès-verbaux: Saint-Constant (Rive-Sud, MRC Roussillon, ~30 km SW Montréal)
    // Zonage réel détecté : règlements 1926-26/1927-26, zone H-431 (PV mai 2026)
    {
      sourceId: PV_SAINT_CONSTANT_SOURCE_ID,
      city: SAINT_CONSTANT_PV_CONFIG.citySlug,
      build: () => createProcesVerbauxAdapter(SAINT_CONSTANT_PV_CONFIG),
    },
    // procès-verbaux: La Prairie (Rive-Sud, MRC Roussillon, ~25 km SW Montréal)
    // PV mai 2026 : 0 DesignationEvent zonage (règlements taxes/patrimoine/circulation)
    {
      sourceId: PV_LAPRAIRIE_SOURCE_ID,
      city: LAPRAIRIE_PV_CONFIG.citySlug,
      build: () => createProcesVerbauxAdapter(LAPRAIRIE_PV_CONFIG),
    },
    // procès-verbaux: Châteauguay (MRC Roussillon, ~35 km SW Montréal)
    // PV fév. 2026 : 1 DesignationEvent zonage — règlement Z-3001 (zones C-754/C-810)
    {
      sourceId: PV_CHATEAUGUAY_SOURCE_ID,
      city: CHATEAUGUAY_PV_CONFIG.citySlug,
      build: () => createProcesVerbauxAdapter(CHATEAUGUAY_PV_CONFIG),
    },
    // procès-verbaux: Delson (MRC Roussillon, ~35 km SW Montréal)
    // PV mai 2026 : 0 DesignationEvent zonage (référence passée sans avis de motion actif)
    {
      sourceId: PV_DELSON_SOURCE_ID,
      city: DELSON_PV_CONFIG.citySlug,
      build: () => createProcesVerbauxAdapter(DELSON_PV_CONFIG),
    },
    // procès-verbaux: Vaudreuil-Dorion (MRC Vaudreuil-Soulanges, ~40 km W Montréal)
    // PV mai 2026 : 0 DesignationEvent zonage (faux-positif écarté en amont)
    {
      sourceId: PV_VAUDREUIL_DORION_SOURCE_ID,
      city: VAUDREUIL_DORION_PV_CONFIG.citySlug,
      build: () => createProcesVerbauxAdapter(VAUDREUIL_DORION_PV_CONFIG),
    },
    // procès-verbaux: Sainte-Martine (MRC Beauharnois-Salaberry, ~55 km SW Montréal)
    // PV avr. 2026 : 1 DesignationEvent zonage — règlement 2026-510 (zone MxtV-2)
    {
      sourceId: PV_SAINTE_MARTINE_SOURCE_ID,
      city: SAINTE_MARTINE_PV_CONFIG.citySlug,
      build: () => createProcesVerbauxAdapter(SAINTE_MARTINE_PV_CONFIG),
    },
    // procès-verbaux: Saint-Rémi (MRC Les Jardins-de-Napierville, ~50 km S Montréal)
    // PV avr. 2026 : 1 DesignationEvent zonage — règlement V654-2026-33 (modifie V654-2017-00)
    {
      sourceId: PV_SAINT_REMI_SOURCE_ID,
      city: SAINT_REMI_PV_CONFIG.citySlug,
      build: () => createProcesVerbauxAdapter(SAINT_REMI_PV_CONFIG),
    },
    // avis-publics generic: Valleyfield (Craft CMS)
    {
      sourceId: AVIS_PUBLICS_VALLEYFIELD_GENERIC_SOURCE_ID,
      city: VALLEYFIELD_AVIS_CONFIG.citySlug,
      build: () => createAvisPublicsAdapter(VALLEYFIELD_AVIS_CONFIG),
    },
    // avis-publics generic: Beauharnois (WordPress)
    {
      sourceId: AVIS_PUBLICS_BEAUHARNOIS_GENERIC_SOURCE_ID,
      city: BEAUHARNOIS_AVIS_CONFIG.citySlug,
      build: () => createAvisPublicsAdapter(BEAUHARNOIS_AVIS_CONFIG),
    },
    // YouTube séances: Valleyfield (off by default — missing API key → skipped)
    {
      sourceId: YOUTUBE_SEANCES_VALLEYFIELD_SOURCE_ID,
      city: VALLEYFIELD_YOUTUBE_CONFIG.citySlug,
      build: () => createYouTubeSeancesAdapter(VALLEYFIELD_YOUTUBE_CONFIG),
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
    // Generic avis-publics: abstract catalogue id fans out to all cities.
    "avis-publics-generic": [
      AVIS_PUBLICS_VALLEYFIELD_GENERIC_SOURCE_ID,
      AVIS_PUBLICS_BEAUHARNOIS_GENERIC_SOURCE_ID,
    ],
    // procès-verbaux-generic: abstract id fans out to all configured PV cities.
    "proces-verbaux-generic": [
      PV_SAINT_DAMASE_SOURCE_ID,
      PV_SAINTE_CATHERINE_SOURCE_ID,
      PV_SAINT_CONSTANT_SOURCE_ID,
      PV_LAPRAIRIE_SOURCE_ID,
      PV_CHATEAUGUAY_SOURCE_ID,
      PV_DELSON_SOURCE_ID,
      PV_VAUDREUIL_DORION_SOURCE_ID,
      PV_SAINTE_MARTINE_SOURCE_ID,
      PV_SAINT_REMI_SOURCE_ID,
    ],
    // youtube-seances: abstract id fans out to all configured YouTube cities.
    "youtube-seances": [YOUTUBE_SEANCES_VALLEYFIELD_SOURCE_ID],
  };

  return buildAdapterRegistry(entries, aliases);
}
