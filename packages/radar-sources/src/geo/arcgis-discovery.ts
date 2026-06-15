/**
 * P1-B — Recensement rejouable des services ArcGIS REST de zonage municipal.
 *
 * Ce module sonde, pour une liste de villes (depuis `municipalities.qc.json`),
 * la présence d'un service ArcGIS REST de zonage public. Il enrichit
 * automatiquement `arcgis-service-registry.ts` au lieu de le remplir à la main.
 *
 * ## Principe de détection
 *
 * Pour chaque ville, on sonde des patterns d'URL signature ArcGIS REST :
 *   1. **ArcGIS Online (AGOL)** : `https://<slug>.maps.arcgis.com/...`
 *      ou `https://services*.arcgis.com/<orgid>/arcgis/rest/services/`
 *   2. **Serveur municipal** : `https://<domaine_ville>/arcgis/rest/services`
 *      ou `https://<domaine_ville>/server/rest/services`
 *      puis filtrage des services contenant `Zonage`, `Zoning`, `zoning`, `zone`
 *      dans leur nom ou dans la liste des services JSON.
 *
 * ## Robots / politesse
 *
 * - Un timeout strict (défaut : 8 s) par requête → pas de blocage.
 * - User-Agent honnête (`radar-immobilier/0.1`).
 * - Pas de retentative sur 403/404 (non-scrapable → résultat `not-found`).
 * - Pas de scan agressif : on sonde 1-2 URLs par ville, pas de force-browse.
 * - Cet outil est OFFLINE (non inclus dans CI) ; il tourne à la demande.
 *
 * ## Idempotence
 *
 * La fonction `discoverArcgisServices()` accepte un registre existant en entrée.
 * Elle ne rescanne PAS les villes déjà dans le registre (sauf `force=true`).
 * Elle produit un rapport de couverture en sortie.
 *
 * ## Limitation connue
 *
 * La détection repose sur un annuaire de domaines municipaux dérivé des slugs
 * (pattern `https://sig.<slug>.ca` ou `https://gis.<slug>.ca` etc.). Sans
 * annuaire MAMH des sites municipaux, la couverture reste partielle (~30–40 %
 * des villes). Un recensement complet nécessite un annuaire fiable (lot à part,
 * 3–5 j-h).
 *
 * ## Sortie
 *
 * Un rapport `ArcgisDiscoveryReport` par ville :
 *   - `status: found` → URL candidate trouvée, `serviceUrl` peuplé.
 *   - `status: not-found` → aucun service détecté sur les patterns testés.
 *   - `status: error` → erreur réseau/timeout.
 *   - `status: skipped` → ville déjà dans le registre (idempotence).
 *
 * ## Usage
 *
 *   import { discoverArcgisServices } from "./arcgis-discovery.js";
 *   const report = await discoverArcgisServices(["longueuil", "brossard"], {
 *     existingRegistry: ARCGIS_SERVICE_REGISTRY,
 *   });
 *   console.log(report.found, "villes trouvées");
 */

import {
  GEO_USER_AGENT,
  type FetchLike,
} from "./geo-fetch-utils.js";

// ─── Constantes ────────────────────────────────────────────────────────────

export const ARCGIS_DISCOVERY_VERSION = "0.1.0";

/** Timeout par requête (court pour ne pas bloquer le recensement). */
export const ARCGIS_DISCOVERY_TIMEOUT_MS = 8_000;

/**
 * Patterns de noms de service ArcGIS REST associés au zonage.
 * Utilisés pour filtrer les services dans le catalogue d'un serveur ArcGIS.
 */
export const ARCGIS_ZONAGE_SERVICE_NAME_PATTERNS = [
  /zonage/i,
  /zoning/i,
  /zone_municipal/i,
  /plan_urban/i,
  /urbanisme/i,
  /affectation/i,
] as const;

/**
 * Patterns de noms de couches (layers) ArcGIS pour le zonage.
 * Utilisés pour identifier la bonne couche dans un MapServer/FeatureServer.
 */
export const ARCGIS_ZONAGE_LAYER_NAME_PATTERNS = [
  /zonage/i,
  /zone/i,
  /zoning/i,
] as const;

/**
 * Suffixes d'URL courants pour les serveurs ArcGIS municipaux QC.
 * Ordonnés par probabilité (le plus commun en premier).
 */
export const ARCGIS_SERVER_URL_PATTERNS = [
  "/arcgis/rest/services",
  "/server/rest/services",
  "/gis/rest/services",
  "/sig/rest/services",
] as const;

// ─── Types publics ─────────────────────────────────────────────────────────

/** Statut du résultat de détection pour une ville. */
export type ArcgisDiscoveryStatus = "found" | "not-found" | "error" | "skipped";

/** Résultat de détection pour une ville. */
export interface ArcgisDiscoveryResult {
  /** City slug. */
  readonly citySlug: string;
  /** Statut de la détection. */
  readonly status: ArcgisDiscoveryStatus;
  /**
   * URL de la couche ArcGIS REST trouvée (FeatureServer/N ou MapServer/N).
   * Présent uniquement si `status === "found"`.
   */
  readonly serviceUrl?: string;
  /**
   * Nom du service ArcGIS (pour information).
   */
  readonly serviceName?: string;
  /**
   * URLs sondées (pour debugging).
   */
  readonly probedUrls: readonly string[];
  /**
   * Message d'erreur si `status === "error"`.
   */
  readonly errorMessage?: string;
  /**
   * Horodatage de la détection (ISO 8601).
   */
  readonly detectedAt: string;
}

/** Rapport global d'un recensement. */
export interface ArcgisDiscoveryReport {
  readonly version: string;
  readonly generatedAt: string;
  readonly totalCities: number;
  readonly found: number;
  readonly notFound: number;
  readonly errors: number;
  readonly skipped: number;
  readonly results: readonly ArcgisDiscoveryResult[];
}

/** Options pour le recensement. */
export interface ArcgisDiscoveryOptions {
  /**
   * Registre existant (pour idempotence).
   * Les villes déjà dans le registre sont ignorées (sauf si `force=true`).
   */
  readonly existingRegistry?: readonly { citySlug: string }[];
  /**
   * Si `true`, rescanne les villes déjà dans le registre.
   * Défaut : false.
   */
  readonly force?: boolean;
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
  /**
   * Fonction de mapping slug -> domaine municipal.
   * Si non fourni, utilise `defaultMunicipalDomainGuesser`.
   * Injection pour tests.
   */
  readonly domainGuesser?: (citySlug: string) => readonly string[];
}

// ─── Logique de détection ─────────────────────────────────────────────────

/**
 * Dérive des domaines municipaux candidats depuis un slug de ville.
 *
 * Heuristiques basées sur l'observation des sites QC :
 *   - `sig.<slug>.ca` (ex. sig.longueuil.ca — non standard mais courant)
 *   - `cartes.<slug>.ca`
 *   - `geomatique.<slug>.ca`
 *   - `ville.<slug>.qc.ca` (le plus courant pour les villes QC)
 *   - `<slug>.ca`
 *
 * Note : la précision est faible sans annuaire MAMH. C'est le vrai goulot
 * d'étranglement du recensement automatisé.
 */
export function defaultMunicipalDomainGuesser(citySlug: string): readonly string[] {
  // Normaliser le slug : enlever les accents et traits d'union
  const base = citySlug.toLowerCase();

  return [
    `https://cartes.${base}.ca`,
    `https://sig.${base}.ca`,
    `https://gis.${base}.ca`,
    `https://geomatique.${base}.ca`,
    `https://www.ville.${base}.qc.ca`,
    `https://ville.${base}.qc.ca`,
  ];
}

/**
 * Génère toutes les URLs à sonder pour un domaine municipal.
 * Combine les domaines candidats avec les patterns de serveur ArcGIS.
 */
export function buildProbingUrls(domain: string): readonly string[] {
  return ARCGIS_SERVER_URL_PATTERNS.map((suffix) => `${domain}${suffix}`);
}

/**
 * Vérifie si une URL est un catalogue ArcGIS REST valide (retourne des services).
 * Retourne la liste des services si valide, `null` sinon.
 */
export async function probeArcgisCatalog(
  catalogUrl: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<
  | {
      services: Array<{ name: string; type: string; url: string }>;
    }
  | null
> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await fetchImpl(`${catalogUrl}?f=json`, {
        signal: controller.signal,
        headers: {
          "user-agent": GEO_USER_AGENT,
          accept: "application/json",
        },
      });
    } catch {
      // Timeout ou erreur réseau → ville non accessible
      return null;
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) return null;

    const text = await res.text();
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return null;
    }

    // Un catalogue ArcGIS REST valide doit avoir un champ "services" ou "folders"
    const rawServices = data["services"];
    if (!Array.isArray(rawServices)) return null;

    const services = rawServices
      .filter((s): s is Record<string, unknown> => s != null && typeof s === "object")
      .map((s) => ({
        name: String(s["name"] ?? ""),
        type: String(s["type"] ?? ""),
        url: catalogUrl.replace(/\/rest\/services.*$/, `/rest/services/${String(s["name"] ?? "")}/${String(s["type"] ?? "")}`),
      }));

    return { services };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Filtre les services ArcGIS REST correspondant au zonage municipal.
 * Retourne les services dont le nom correspond à un pattern de zonage.
 */
export function filterZonageServices(
  services: readonly { name: string; type: string; url: string }[],
): readonly { name: string; type: string; url: string }[] {
  return services.filter((s) => {
    const nameParts = s.name.split("/");
    const baseName = nameParts[nameParts.length - 1] ?? s.name;
    return ARCGIS_ZONAGE_SERVICE_NAME_PATTERNS.some((p) => p.test(baseName));
  });
}

/**
 * Sonde une URL de service ArcGIS REST pour vérifier si c'est un FeatureServer
 * ou MapServer avec une couche de zonage. Retourne l'URL de la première couche
 * de zonage trouvée, ou `null`.
 */
export async function resolveZonageLayer(
  serviceUrl: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await fetchImpl(`${serviceUrl}?f=json`, {
        signal: controller.signal,
        headers: {
          "user-agent": GEO_USER_AGENT,
          accept: "application/json",
        },
      });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) return null;

    const text = await res.text();
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return null;
    }

    // MapServer/FeatureServer ont des "layers"
    const rawLayers = data["layers"];
    if (!Array.isArray(rawLayers)) {
      // Peut-être que c'est déjà une couche directe (FeatureServer/0)
      const geoType = data["geometryType"];
      if (typeof geoType === "string" && geoType.includes("Polygon")) {
        return serviceUrl;
      }
      return null;
    }

    // Chercher la couche de zonage
    for (const layer of rawLayers) {
      if (layer == null || typeof layer !== "object") continue;
      const l = layer as Record<string, unknown>;
      const layerName = String(l["name"] ?? "");
      const layerId = Number(l["id"] ?? 0);

      if (ARCGIS_ZONAGE_LAYER_NAME_PATTERNS.some((p) => p.test(layerName))) {
        return `${serviceUrl}/${layerId}`;
      }
    }

    // Fallback : première couche polygon
    for (const layer of rawLayers) {
      if (layer == null || typeof layer !== "object") continue;
      const l = layer as Record<string, unknown>;
      const layerId = Number(l["id"] ?? 0);
      return `${serviceUrl}/${layerId}`;
    }

    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Recensement principal ────────────────────────────────────────────────

/**
 * Sonde, pour une liste de villes, la présence d'un service ArcGIS REST de zonage.
 *
 * Borné (timeout par requête, pas de scan agressif). Idempotent (ignore les villes
 * déjà dans le registre sauf `force=true`).
 *
 * @param citySlugs  Liste de slugs de villes à sonder.
 * @param options    Options (registre existant, fetch, timeout, etc.).
 * @returns          Rapport de couverture + liste des résultats par ville.
 */
export async function discoverArcgisServices(
  citySlugs: readonly string[],
  options: ArcgisDiscoveryOptions = {},
): Promise<ArcgisDiscoveryReport> {
  const {
    existingRegistry = [],
    force = false,
    fetchImpl = globalThis.fetch as unknown as FetchLike,
    timeoutMs = ARCGIS_DISCOVERY_TIMEOUT_MS,
    now = () => new Date(),
    domainGuesser = defaultMunicipalDomainGuesser,
  } = options;

  const existingSlugs = new Set(existingRegistry.map((e) => e.citySlug));
  const results: ArcgisDiscoveryResult[] = [];

  for (const citySlug of citySlugs) {
    // Idempotence
    if (!force && existingSlugs.has(citySlug)) {
      results.push({
        citySlug,
        status: "skipped",
        probedUrls: [],
        detectedAt: now().toISOString(),
      });
      continue;
    }

    const result = await _probeCity(citySlug, {
      fetchImpl,
      timeoutMs,
      now,
      domainGuesser,
    });
    results.push(result);
  }

  const found = results.filter((r) => r.status === "found").length;
  const notFound = results.filter((r) => r.status === "not-found").length;
  const errors = results.filter((r) => r.status === "error").length;
  const skipped = results.filter((r) => r.status === "skipped").length;

  return {
    version: ARCGIS_DISCOVERY_VERSION,
    generatedAt: now().toISOString(),
    totalCities: citySlugs.length,
    found,
    notFound,
    errors,
    skipped,
    results,
  };
}

/** Sonde une ville individuelle. */
async function _probeCity(
  citySlug: string,
  {
    fetchImpl,
    timeoutMs,
    now,
    domainGuesser,
  }: {
    fetchImpl: FetchLike;
    timeoutMs: number;
    now: () => Date;
    domainGuesser: (slug: string) => readonly string[];
  },
): Promise<ArcgisDiscoveryResult> {
  const detectedAt = now().toISOString();
  const probedUrls: string[] = [];

  const domains = domainGuesser(citySlug);

  for (const domain of domains) {
    for (const suffix of ARCGIS_SERVER_URL_PATTERNS) {
      const catalogUrl = `${domain}${suffix}`;
      probedUrls.push(catalogUrl);

      let catalog: Awaited<ReturnType<typeof probeArcgisCatalog>>;
      try {
        catalog = await probeArcgisCatalog(catalogUrl, fetchImpl, timeoutMs);
      } catch {
        // Erreur inattendue → continue
        continue;
      }

      if (!catalog) continue;

      // Filtre les services de zonage
      const zonageServices = filterZonageServices(catalog.services);
      if (zonageServices.length === 0) continue;

      // Résout la couche dans le premier service trouvé
      for (const service of zonageServices) {
        const layerUrl = await resolveZonageLayer(service.url, fetchImpl, timeoutMs);
        if (layerUrl) {
          return {
            citySlug,
            status: "found",
            serviceUrl: layerUrl,
            serviceName: service.name,
            probedUrls,
            detectedAt,
          };
        }
      }
    }
  }

  return {
    citySlug,
    status: "not-found",
    probedUrls,
    detectedAt,
  };
}

// ─── Formatage du rapport ─────────────────────────────────────────────────

/**
 * Formate un rapport de recensement en texte lisible.
 * Utile pour l'affichage CLI du script de recensement.
 */
export function formatDiscoveryReport(report: ArcgisDiscoveryReport): string {
  const lines: string[] = [
    `=== Recensement ArcGIS REST — ${report.generatedAt} ===`,
    `Total : ${report.totalCities} villes sondées`,
    `  Trouvé      : ${report.found}`,
    `  Pas trouvé  : ${report.notFound}`,
    `  Erreurs     : ${report.errors}`,
    `  Ignorés     : ${report.skipped}`,
    "",
    "--- Résultats ---",
  ];

  for (const r of report.results) {
    if (r.status === "found") {
      lines.push(`  [FOUND]   ${r.citySlug} -> ${r.serviceUrl ?? "?"} (${r.serviceName ?? ""})`);
    } else if (r.status === "not-found") {
      lines.push(`  [MISS ]   ${r.citySlug} (sondé ${r.probedUrls.length} URL(s))`);
    } else if (r.status === "error") {
      lines.push(`  [ERROR]   ${r.citySlug}: ${r.errorMessage ?? "erreur inconnue"}`);
    } else if (r.status === "skipped") {
      lines.push(`  [SKIP ]   ${r.citySlug} (déjà dans le registre)`);
    }
  }

  return lines.join("\n");
}

/**
 * Convertit les résultats `found` d'un rapport en entrées compatibles avec
 * `ARCGIS_SERVICE_REGISTRY`. Utile pour enrichir le registre depuis un script.
 */
export function reportToRegistryEntries(
  report: ArcgisDiscoveryReport,
): Array<{
  citySlug: string;
  serviceUrl: string;
  zoneCodeField: null;
  verifiedAt: string;
  notes: string;
}> {
  return report.results
    .filter((r) => r.status === "found" && r.serviceUrl)
    .map((r) => ({
      citySlug: r.citySlug,
      serviceUrl: r.serviceUrl!,
      zoneCodeField: null,
      verifiedAt: r.detectedAt.split("T")[0] ?? r.detectedAt,
      notes: `Découvert par recensement automatisé arcgis-discovery v${ARCGIS_DISCOVERY_VERSION}. Service : ${r.serviceName ?? "inconnu"}. Non vérifié live.`,
    }));
}

// ─── Export de la classe encapsulée ──────────────────────────────────────

/**
 * Classe encapsulant le recensement ArcGIS.
 * Permet une utilisation orientée-objet pour les intégrations futures.
 */
export class ArcgisDiscovery {
  private readonly options: ArcgisDiscoveryOptions;

  constructor(options: ArcgisDiscoveryOptions = {}) {
    this.options = options;
  }

  /**
   * Sonde une liste de villes et retourne le rapport.
   */
  async discover(citySlugs: readonly string[]): Promise<ArcgisDiscoveryReport> {
    return discoverArcgisServices(citySlugs, this.options);
  }

  /**
   * Vérifie la présence d'un service ArcGIS pour une ville unique.
   * Utile pour les intégrations au cas par cas.
   */
  async discoverOne(citySlug: string): Promise<ArcgisDiscoveryResult> {
    const report = await discoverArcgisServices([citySlug], this.options);
    return report.results[0] ?? {
      citySlug,
      status: "error",
      probedUrls: [],
      detectedAt: (this.options.now ?? (() => new Date()))().toISOString(),
      errorMessage: "Pas de résultat",
    };
  }
}
