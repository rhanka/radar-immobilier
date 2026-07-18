/**
 * Route GET /api/geo/collections/:id/items — passthrough OGC live geo / store local.
 *
 * Aligne l'architecture « immo = frontend, geo = data » : la carte immo consomme
 * les couches zonage/lots via le client OGC (`zones-client` / `lots-client`) qui
 * appelle `/api/geo/collections/<id>/items`.
 *
 * ## Aiguillage de la source (zero-copy géo #73 lot 1)
 *
 * Le ZONAGE et les LOTS n'ont PAS le même ordre de priorité :
 *
 *  - ZONAGE, `GEO_ZONES_SOURCE=live` (DÉFAUT) — le rendu vient du LIVE GEO en
 *    priorité (proxy OGC), le store-local PG n'étant plus qu'un FALLBACK sur
 *    404/429/échec geo. Correctif de fraîcheur : on cesse de rendre la géométrie
 *    de zonage périmée du PG (ex. Sutton `P-1/939 arcgis`) quand geo sert déjà la
 *    cohorte à jour (95 zones `RUR-*, CONS-*, H-* geopdf-esri`). Un cache TTL borne
 *    la charge sur geo. `GEO_ZONES_SOURCE=pg` restaure le store-local-first.
 *  - LOTS (et ZONAGE sous `pg`) — inchangés, STORE-LOCAL-first (blast radius
 *    borné), avec le fallback proxy ci-dessous.
 *
 * Deux sources, dans l'ordre du mode store-local-first :
 *
 *  1. STORE LOCAL — quand la collection a déjà été tirée dans Postgres
 *     (`zone_versions` / `lot_versions`, via `pull-geo-ogc`), on sert ces features
 *     telles quelles. Aucun appel réseau.
 *
 *  2. FALLBACK PROXY — quand la collection est absente/vide du store local
 *     (ex. `qc-zonage-rosemere`, servie par api.geo.sent-tech.ca mais jamais
 *     pullée), on proxifie server-side le GET vers
 *     `${GEO_OGC_BASE_URL}/collections/<id>/items?<limit,bbox,offset,f=json>`
 *     et on renvoie la FeatureCollection OGC telle quelle. Server-side => CORS-safe,
 *     pas de ré-ingestion, pas de Postgres requis.
 *
 * Seules les collections `qc-zonage-*` et `qc-lots-*` sont gérées (anti-SSRF :
 * le proxy ne sert que ce préfixe). Toute autre collection => 404 honnête.
 *
 * Erreurs réseau / geo indisponible => 502 honnête (jamais de crash).
 *
 * ## Contrat d'enrichissement des items LOTS (P0 parité carte Steve)
 *
 * Pour les collections `qc-lots-<city>`, chaque feature.properties est enrichie
 * server-side par jointure avec la collection zonage de la même ville
 * (`qc-zonage-<city>`, store local puis proxy, index caché 5 min). Les
 * propriétés BRUTES de la source sont toujours conservées ; les champs suivants
 * sont AJOUTÉS uniquement quand ils sont dérivables (anti-invention — jamais de
 * valeur fabriquée, champ ABSENT sinon) :
 *
 *   - `zone`        — { code: string, kind: ZoneKind canonique ("H"|"MIXTE"|"C"|
 *                     "I"|"P"|"A"|"CONS"|"REC"|"U"|"AUTRE"), densiteLogHa:
 *                     number|null (RÉELLE, null si la source zonage ne la porte
 *                     pas), usages: string[] (RÉELS, [] sinon), grillePdfUrl:
 *                     string|null, reglementNumero: string|null,
 *                     reglementMillesime: number|null, reglementPageSource:
 *                     string|null, reglementUrl: string|null (provenance RÉELLE
 *                     du règlement porteur — zone de norme qc-zonage-norms-<slug> ;
 *                     jamais devinée) }. Présent si et seulement si la zone est jointe.
 *   - `zoneCode`    — code de zone affiché de la zone jointe (ex. "H-241").
 *   - `zoneJoin`    — provenance de la jointure : "code" (code de zone explicite
 *                     porté par le lot) | "centroid" (centroïde du lot dans le
 *                     polygone de zone). Présent si zone jointe.
 *   - `multifamilial4plus` — boolean, dérivé de la zone jointe
 *                     (scoring/zone-allows-4plus.ts : densité réelle > 20 log/ha
 *                     ou usages multi → grille ; sinon heuristique par kind,
 *                     MIXTE → true). Présent si zone jointe.
 *   - `multifamilial4plusSource` — "grille" | "heuristique" (source honnête de
 *                     la dérivation). Présent si `multifamilial4plus` présent.
 *   - `tod`         — boolean, UNIQUEMENT si la source lots porte déjà la donnée
 *                     (tod/inTod/in_tod). Jamais fabriqué : les collections live
 *                     n'ont pas de périmètre TOD aujourd'hui → champ absent.
 *   - `priorite`    — boolean = multifamilial4plus ∧ tod. Présent UNIQUEMENT si
 *                     les deux existent.
 *   - `superficieM2`— m² : valeur de la source si présente, sinon calculée depuis
 *                     la géométrie publique (services/geo/superficie.ts).
 *
 * Zonage de la ville indisponible (404/erreur) → items lots servis SANS champs
 * zone/flags (jamais d'échec de la requête lots pour autant).
 * L'UI consomme ces champs tels quels via LotProperties
 * (ui/src/lib/maps/lots-client.ts) — ne pas renommer sans synchroniser.
 *
 * Loi 25 : zonage/lots publics, aucune PII propriétaire.
 */

import { Hono } from "hono";
import type { Database } from "../db/client.js";
import {
  getZoneFeatures,
  getLotFeatures,
  type GeoFeatureCollection,
} from "../services/geo/geo-features.js";
import { DEFAULT_OGC_BASE_URL } from "../services/geo/ogc-pull.js";
import {
  buildZoneIndex,
  enrichLotFeatures,
  type EnrichFeature,
  type ZoneIndex,
} from "../services/geo/lot-zone-enrichment.js";
import { resolveZonesSource, type ZonesSource } from "../services/geo/zones-source.js";

/** Collection OGC parsée : nature (zonage|lots) + ville. */
interface ParsedCollection {
  collectionId: string;
  kind: "zonage" | "lots";
  citySlug: string;
}

/**
 * Résout une collection depuis le store local. Retourne null quand la collection
 * n'a pas (encore) de features locales — ce qui déclenche le fallback proxy.
 */
export type LocalCollectionResolver = (
  parsed: ParsedCollection,
) => Promise<GeoFeatureCollection | null>;

export interface GeoCollectionsDeps {
  /** Base de données. Quand absente, on saute directement au proxy. */
  db?: Database;
  /** fetchImpl injectable pour les tests (défaut = global fetch). */
  fetchImpl?: typeof fetch;
  /** Override de la base OGC geo (défaut = GEO_OGC_BASE_URL ?? DEFAULT_OGC_BASE_URL). */
  baseUrl?: string;
  /** Résolveur du store local injectable (défaut = lecture Postgres). */
  localResolver?: LocalCollectionResolver;
  /**
   * Source de géométrie du ZONAGE (zero-copy géo #73 lot 1). Défaut = env
   * `GEO_ZONES_SOURCE` (`live` par défaut). En `live`, le zonage vient du live
   * geo (proxy OGC) en priorité, PG store-local en fallback ; en `pg`, PG
   * store-local reste primaire (rollback). N'affecte PAS les lots.
   */
  zonesSource?: ZonesSource;
}

/** Parse un collection-id `qc-zonage-<city>` ou `qc-lots-<city>`. null sinon. */
export function parseCollectionId(id: string): ParsedCollection | null {
  if (id.startsWith("qc-zonage-")) {
    const citySlug = id.slice("qc-zonage-".length);
    if (!citySlug) return null;
    return { collectionId: id, kind: "zonage", citySlug };
  }
  if (id.startsWith("qc-lots-")) {
    const citySlug = id.slice("qc-lots-".length);
    if (!citySlug) return null;
    return { collectionId: id, kind: "lots", citySlug };
  }
  return null;
}

/** Résolveur local par défaut, adossé au store Postgres (geo-features). */
function makeDbLocalResolver(db?: Database): LocalCollectionResolver {
  return async (parsed) => {
    if (!db) return null;
    const fc =
      parsed.kind === "zonage"
        ? await getZoneFeatures(db, parsed.citySlug)
        : await getLotFeatures(db, parsed.citySlug);
    return fc.features.length > 0 ? fc : null;
  };
}

/** Construit la query passthrough OGC : conserve limit/bbox/offset, force f=json. */
function buildPassthroughQuery(c: {
  req: { query(name: string): string | undefined };
}): string {
  const params = new URLSearchParams();
  for (const name of ["limit", "bbox", "offset"]) {
    const value = c.req.query(name);
    if (value !== undefined && value !== "") params.set(name, value);
  }
  params.set("f", "json");
  return params.toString();
}

/** Limite optionnelle appliquée aux features servies depuis le store local. */
function applyLimit(fc: GeoFeatureCollection, rawLimit: string | undefined): GeoFeatureCollection {
  if (!rawLimit) return fc;
  const limit = parseInt(rawLimit, 10);
  if (!Number.isFinite(limit) || limit <= 0 || fc.features.length <= limit) return fc;
  return { type: "FeatureCollection", features: fc.features.slice(0, limit) };
}

/** TTL du cache d'index zonage par ville (jointure lots↔zones). */
const ZONE_INDEX_TTL_MS = 5 * 60_000;
/** Borne du cache d'index zonage (villes). Au-delà : purge complète (simple). */
const ZONE_INDEX_CACHE_MAX = 32;

export function geoCollectionsRoute(deps: GeoCollectionsDeps = {}): Hono {
  const app = new Hono();
  const localResolver = deps.localResolver ?? makeDbLocalResolver(deps.db);
  const fetchImpl = deps.fetchImpl ?? fetch;

  const resolveBase = (): string =>
    (
      deps.baseUrl ??
      process.env["GEO_OGC_BASE_URL"] ??
      DEFAULT_OGC_BASE_URL
    ).replace(/\/$/, "");

  const proxyUrlFor = (
    id: string,
    c: { req: { query(name: string): string | undefined } },
  ): string =>
    `${resolveBase()}/collections/${encodeURIComponent(id)}/items?${buildPassthroughQuery(c)}`;

  // ── Fetch proxy server-side (résultat typé, ne jette jamais) ───────────────
  type ProxyResult =
    | { kind: "ok"; body: Record<string, unknown> & { features: unknown } }
    | { kind: "notfound" }
    | { kind: "unreachable"; detail: string }
    | { kind: "error"; status: number }
    | { kind: "bad_payload"; detail: string };

  async function runProxyFetch(url: string): Promise<ProxyResult> {
    let res: Response;
    try {
      res = await fetchImpl(url);
    } catch (err) {
      return { kind: "unreachable", detail: err instanceof Error ? err.message : String(err) };
    }
    if (res.status === 404) return { kind: "notfound" };
    if (!res.ok) return { kind: "error", status: res.status };
    try {
      const body = (await res.json()) as Record<string, unknown> & { features: unknown };
      return { kind: "ok", body };
    } catch (err) {
      return { kind: "bad_payload", detail: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Mappe un échec proxy vers la réponse honnête (codes/statuts historiques). */
  function proxyFailureResponse(
    id: string,
    result: ProxyResult,
  ): { body: Record<string, unknown>; status: 404 | 502 } {
    if (result.kind === "notfound")
      return { body: { ok: false, error: "collection_not_found", collectionId: id }, status: 404 };
    if (result.kind === "unreachable")
      return {
        body: { ok: false, error: "geo_proxy_unreachable", collectionId: id, detail: result.detail },
        status: 502,
      };
    if (result.kind === "error")
      return {
        body: { ok: false, error: "geo_proxy_error", collectionId: id, status: result.status },
        status: 502,
      };
    if (result.kind === "bad_payload")
      return {
        body: { ok: false, error: "geo_proxy_bad_payload", collectionId: id, detail: result.detail },
        status: 502,
      };
    return { body: { ok: false, error: "geo_proxy_error", collectionId: id }, status: 502 };
  }

  // ── Cache TTL du zonage live (borne la charge sur geo, live-first) ──────────
  // Ne met en cache QUE les réponses `ok` (jamais un échec transitoire), pour
  // que le fallback PG reste réévalué à chaque indispo geo. Clé = URL complète.
  const zonageLiveCache = new Map<
    string,
    { expiresAt: number; value: Promise<ProxyResult> }
  >();

  function proxyZonageLive(url: string): Promise<ProxyResult> {
    const now = Date.now();
    const cached = zonageLiveCache.get(url);
    if (cached && cached.expiresAt > now) return cached.value;
    if (zonageLiveCache.size >= ZONE_INDEX_CACHE_MAX) zonageLiveCache.clear();
    const value = runProxyFetch(url);
    zonageLiveCache.set(url, { expiresAt: now + ZONE_INDEX_TTL_MS, value });
    void value
      .then((r) => {
        if (r.kind !== "ok") zonageLiveCache.delete(url);
      })
      .catch(() => zonageLiveCache.delete(url));
    return value;
  }

  // ── Index zonage par ville (cache TTL, promesse partagée anti-doublon) ─────
  const zoneIndexCache = new Map<
    string,
    { expiresAt: number; value: Promise<ZoneIndex | null> }
  >();

  async function loadZoneIndex(citySlug: string): Promise<ZoneIndex | null> {
    const collectionId = `qc-zonage-${citySlug}`;
    // 1. Store local (même priorité que la route elle-même)
    try {
      const local = await localResolver({
        collectionId,
        kind: "zonage",
        citySlug,
      });
      if (local && local.features.length > 0) {
        return buildZoneIndex({ features: local.features as EnrichFeature[] });
      }
    } catch {
      // PG indisponible → on tente le proxy.
    }
    // 2. Proxy vers l'API geo (zonage complet : ~100-300 zones par ville)
    const url =
      `${resolveBase()}/collections/${encodeURIComponent(collectionId)}` +
      `/items?limit=10000&f=json`;
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    const body = (await res.json()) as { features?: unknown };
    if (!body || !Array.isArray(body.features)) return null;
    return buildZoneIndex({ features: body.features as EnrichFeature[] });
  }

  function getZoneIndex(citySlug: string): Promise<ZoneIndex | null> {
    const now = Date.now();
    const cached = zoneIndexCache.get(citySlug);
    if (cached && cached.expiresAt > now) return cached.value;
    if (zoneIndexCache.size >= ZONE_INDEX_CACHE_MAX) zoneIndexCache.clear();
    const value = loadZoneIndex(citySlug).catch(() => null);
    zoneIndexCache.set(citySlug, { expiresAt: now + ZONE_INDEX_TTL_MS, value });
    return value;
  }

  /**
   * Enrichit les features lots avec la zone jointe + flags dérivés.
   * Ne jette JAMAIS : en cas d'erreur, les features brutes sont servies.
   */
  async function enrichIfLots<T extends { features: unknown }>(
    parsed: ParsedCollection,
    fc: T,
  ): Promise<T> {
    if (parsed.kind !== "lots" || !Array.isArray(fc.features)) return fc;
    try {
      const index = await getZoneIndex(parsed.citySlug);
      const { features } = enrichLotFeatures(
        fc.features as EnrichFeature[],
        index,
      );
      return { ...fc, features };
    } catch {
      return fc; // Enrichissement en échec → passthrough brut (jamais de 5xx).
    }
  }

  /** Sert une FeatureCollection store-local (limitée), zonage tel quel / lots enrichis. */
  async function serveLocal(
    parsed: ParsedCollection,
    local: GeoFeatureCollection,
    rawLimit: string | undefined,
  ) {
    const limited = applyLimit(local, rawLimit);
    const enriched = await enrichIfLots(parsed, { features: limited.features });
    return {
      type: "FeatureCollection" as const,
      features: enriched.features,
      numberMatched: local.features.length,
      numberReturned: limited.features.length,
    };
  }

  app.get("/api/geo/collections/:id/items", async (c) => {
    const id = c.req.param("id");
    const parsed = parseCollectionId(id);
    if (!parsed) {
      return c.json(
        { ok: false, error: "collection_not_handled", collectionId: id },
        404,
      );
    }

    const url = proxyUrlFor(id, c);

    // ── ZONAGE live-first (GEO_ZONES_SOURCE=live, défaut) ─────────────────────
    // Le rendu du zonage vient du LIVE GEO en priorité (correctif de fraîcheur
    // #73 : plus jamais la géométrie zonage périmée du PG store-local quand geo
    // sert la cohorte à jour). PG store-local reste un FALLBACK propre sur
    // 404/429/échec. Cache TTL partagé pour borner la charge sur geo. Les LOTS
    // et le mode `pg` gardent l'ordre historique (store-local d'abord) plus bas.
    if (parsed.kind === "zonage" && resolveZonesSource(deps.zonesSource) === "live") {
      const live = await proxyZonageLive(url);
      if (live.kind === "ok") {
        // Zonage servi tel quel — porte reglement_millesime/reglement_numero du
        // live geo (bénéfice de bord m6-immo, absents du PG store-local).
        return c.json(live.body);
      }
      // Live geo indisponible (404/429/5xx/réseau) → fallback store-local PG.
      try {
        const local = await localResolver(parsed);
        if (local && local.features.length > 0) {
          return c.json(await serveLocal(parsed, local, c.req.query("limit")));
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        c.header("x-geo-local-error", detail.slice(0, 120));
      }
      // Ni live geo ni PG → réponse honnête, alignée sur les codes/statuts existants.
      const failure = proxyFailureResponse(id, live);
      return c.json(failure.body, failure.status);
    }

    // ── 1. Store local (priorité) — lots, et zonage sous `pg` ─────────────────
    try {
      const local = await localResolver(parsed);
      if (local && local.features.length > 0) {
        return c.json(await serveLocal(parsed, local, c.req.query("limit")));
      }
    } catch (err) {
      // Store local indisponible (ex. PG down) : on n'échoue pas, on proxifie.
      const detail = err instanceof Error ? err.message : String(err);
      c.header("x-geo-local-error", detail.slice(0, 120));
    }

    // ── 2. Fallback proxy server-side vers l'API geo OGC ───────────────────────
    const result = await runProxyFetch(url);
    if (result.kind !== "ok") {
      const failure = proxyFailureResponse(id, result);
      return c.json(failure.body, failure.status);
    }

    // FeatureCollection OGC : lots enrichis (zone + flags), zonage tel quel.
    const enriched = await enrichIfLots(parsed, result.body);
    return c.json(enriched);
  });

  return app;
}
