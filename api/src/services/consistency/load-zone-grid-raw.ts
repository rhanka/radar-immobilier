/**
 * WP3 LOT2 — Chargement LIVE (API geo OGC) des comptes bruts E2 zone↔grille,
 * PAR VILLE CIBLÉE par le job batch (focus-30 par défaut, extensible
 * `SCOPE=province` — cf. `run-consistency-snapshot.ts`). JAMAIS 1104
 * requêtes à chaque affichage : ce module tourne UNE FOIS par exécution du
 * job nightly, borné au scope choisi.
 *
 * Reprend EXACTEMENT la méthode du rapport
 * `docs/reports/coherence-zones-normes-focus30_2026-07.md` :
 *   - Z = codes de zone DISTINCTS de `qc-zonage-<slug>` (zonage servi).
 *   - G = codes de zone DISTINCTS de `qc-zonage-norms-<slug>` (grille de
 *     normes parsée — collection SÉPARÉE de `qc-zonage-<slug>`, PAS les
 *     properties `grillePdfUrl`/`zoneNormes` embarquées dans le zonage
 *     utilisées par `source-coverage.ts` /grilles — deux mesures distinctes,
 *     voir la divergence documentée dans le design doc).
 *   - `qc-zonage-norms-<slug>` en 404 -> grille absente (honnête, pas une erreur).
 *
 * Détection `staleZoningSource` : EMPIRIQUE, sur les properties de la
 * PREMIÈRE feature zonage retournée (`source`/`confidence`) — confirmé en
 * sondage live (2026-07-10) : les zonages "Ancien_zonage" ArcGIS portent
 * `source: ".../Ancien_zonage/FeatureServer/..."` et
 * `confidence: "arcgis-zone-vector-ancien"`. Aucune métadonnée de collection
 * OGC ne porte cette information (vérifié : `title` = id répété, pas de
 * `description`) — c'est un signal PAR FEATURE, pas par collection.
 *
 * Anti-rafale OGC (l'API rate-limite les sweeps non throttled — cf. le
 * rapport : sweep brut 1102 collections -> 914 timeouts) : espacement fixe
 * entre requêtes + retries avec backoff sur échec réseau/5xx. Le "bornage"
 * est le scope du job (30 villes * 2 requêtes par défaut, jamais la
 * province entière sans org délibéré via `SCOPE=province`) ; une exécution
 * batch nightly ne bénéficie pas d'un cache mémoire inter-run (process
 * courte durée) — la protection anti-rafale est l'espacement/retry, pas un
 * cache.
 */
import { normalizeZoneCode } from "../geo/extract-refs.js";
import { extractZoneCode, DEFAULT_OGC_BASE_URL } from "../geo/ogc-pull.js";
import type { ZoneGridRawInput } from "./consistency-calc.js";

const STALE_SOURCE_PATTERN = /ancien|former/i;
const ITEMS_LIMIT = 10_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 800;
const DEFAULT_REQUEST_SPACING_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface OgcFeatureLike {
  id?: string | number;
  properties?: Record<string, unknown>;
}

interface CollectionCodesResult {
  /** false = collection absente du catalogue (HTTP 404) — honnête, pas une erreur. */
  found: boolean;
  /** Codes de zone DISTINCTS normalisés (majuscules) portés par la collection. */
  codes: Set<string>;
  /** true si au moins une feature porte une source "ancien"/"former". */
  staleSource: boolean;
}

/**
 * Récupère les codes de zone distincts d'une collection OGC, avec retries +
 * backoff sur erreur réseau/5xx. Un 404 est un résultat HONNÊTE (`found:
 * false`), PAS une erreur retryée — la collection n'existe simplement pas.
 */
async function fetchCollectionCodes(
  baseUrl: string,
  collectionId: string,
  fetchImpl: typeof fetch,
  maxAttempts: number,
  retryBaseDelayMs: number,
): Promise<CollectionCodesResult> {
  const url =
    `${baseUrl}/collections/${encodeURIComponent(collectionId)}/items` +
    `?limit=${ITEMS_LIMIT}&f=json`;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetchImpl(url);
      if (res.status === 404) {
        return { found: false, codes: new Set(), staleSource: false };
      }
      if (!res.ok) {
        throw new Error(`GET ${url} → HTTP ${res.status}`);
      }
      const body = (await res.json()) as { features?: OgcFeatureLike[] };
      const features = body.features ?? [];
      const codes = new Set<string>();
      let staleSource = false;
      for (const feature of features) {
        const props = feature.properties ?? {};
        const rawCode = extractZoneCode(props, feature.id);
        const norm = normalizeZoneCode(rawCode);
        if (norm) codes.add(norm);
        if (!staleSource) {
          const source = String(props["source"] ?? "");
          const confidence = String(props["confidence"] ?? "");
          if (STALE_SOURCE_PATTERN.test(source) || STALE_SOURCE_PATTERN.test(confidence)) {
            staleSource = true;
          }
        }
      }
      return { found: true, codes, staleSource };
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        await sleep(retryBaseDelayMs * attempt);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export interface LoadZoneGridRawOptions {
  /** OGC API base URL (défaut : https://api.geo.sent-tech.ca). */
  baseUrl?: string;
  /** fetch injectable (tests). */
  fetchImpl?: typeof fetch;
  /** Espacement entre requêtes OGC, anti-rafale (défaut 250 ms). */
  requestSpacingMs?: number;
  /** Tentatives max par requête avant d'abandonner la ville (défaut 3). */
  maxAttempts?: number;
  /** Délai de base du backoff entre tentatives (défaut 800 ms, x tentative). */
  retryBaseDelayMs?: number;
  logger?: {
    info(obj: unknown, msg?: string): void;
    warn(obj: unknown, msg?: string): void;
  };
}

const silentLogger: Required<LoadZoneGridRawOptions>["logger"] = {
  info: () => {},
  warn: () => {},
};

/**
 * Charge les comptes bruts E2 (zone↔grille) pour les villes ciblées — DEUX
 * requêtes OGC par ville (`qc-zonage-<slug>` puis `qc-zonage-norms-<slug>`),
 * espacées pour éviter le rate-limit. Une ville dont la mesure échoue après
 * retries reste `measured: false` (honnête `non_mesure` en aval), jamais un
 * chiffre fabriqué — l'échec est loggé et n'interrompt pas les autres villes.
 */
export async function loadZoneGridRawInputs(
  citySlugs: readonly string[],
  opts: LoadZoneGridRawOptions = {},
): Promise<Map<string, ZoneGridRawInput>> {
  const {
    baseUrl = DEFAULT_OGC_BASE_URL,
    fetchImpl = fetch,
    requestSpacingMs = DEFAULT_REQUEST_SPACING_MS,
    maxAttempts = MAX_ATTEMPTS,
    retryBaseDelayMs = RETRY_BASE_DELAY_MS,
    logger = silentLogger,
  } = opts;

  const results = new Map<string, ZoneGridRawInput>();

  for (const citySlug of citySlugs) {
    try {
      const zonage = await fetchCollectionCodes(
        baseUrl,
        `qc-zonage-${citySlug}`,
        fetchImpl,
        maxAttempts,
        retryBaseDelayMs,
      );
      await sleep(requestSpacingMs);
      const norms = await fetchCollectionCodes(
        baseUrl,
        `qc-zonage-norms-${citySlug}`,
        fetchImpl,
        maxAttempts,
        retryBaseDelayMs,
      );
      await sleep(requestSpacingMs);

      let matchedCodeCount = 0;
      for (const code of zonage.codes) {
        if (norms.codes.has(code)) matchedCodeCount += 1;
      }

      results.set(citySlug, {
        citySlug,
        measured: true,
        zoneCodeCount: zonage.found ? zonage.codes.size : 0,
        gridCollectionFound: norms.found,
        gridCodeCount: norms.codes.size,
        matchedCodeCount,
        staleZoningSource: zonage.staleSource,
      });

      logger.info(
        {
          citySlug,
          zoneCodeCount: zonage.codes.size,
          gridFound: norms.found,
          gridCodeCount: norms.codes.size,
          matchedCodeCount,
          staleZoningSource: zonage.staleSource,
        },
        "load-zone-grid-raw: ville mesurée",
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        { citySlug, err: msg },
        "load-zone-grid-raw: échec mesure OGC après retries — ville laissée non_mesure (aucun chiffre fabriqué)",
      );
      results.set(citySlug, {
        citySlug,
        measured: false,
        zoneCodeCount: 0,
        gridCollectionFound: false,
        gridCodeCount: 0,
        matchedCodeCount: 0,
        staleZoningSource: false,
      });
    }
  }

  return results;
}
