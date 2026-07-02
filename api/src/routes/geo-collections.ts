/**
 * Route GET /api/geo/collections/:id/items — passthrough OGC avec priorité store local.
 *
 * Aligne l'architecture « immo = frontend, geo = data » : la carte immo consomme
 * les couches zonage/lots via le client OGC (`zones-client` / `lots-client`) qui
 * appelle `/api/geo/collections/<id>/items`. Deux sources possibles, dans cet ordre :
 *
 *  1. STORE LOCAL (priorité) — quand la collection a déjà été tirée dans Postgres
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
 *                     string|null }. Présent si et seulement si la zone est jointe.
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

  app.get("/api/geo/collections/:id/items", async (c) => {
    const id = c.req.param("id");
    const parsed = parseCollectionId(id);
    if (!parsed) {
      return c.json(
        { ok: false, error: "collection_not_handled", collectionId: id },
        404,
      );
    }

    // ── 1. Store local (priorité) ─────────────────────────────────────────────
    try {
      const local = await localResolver(parsed);
      if (local && local.features.length > 0) {
        const limited = applyLimit(local, c.req.query("limit"));
        const enriched = await enrichIfLots(parsed, {
          features: limited.features,
        });
        return c.json({
          type: "FeatureCollection",
          features: enriched.features,
          numberMatched: local.features.length,
          numberReturned: limited.features.length,
        });
      }
    } catch (err) {
      // Store local indisponible (ex. PG down) : on n'échoue pas, on proxifie.
      const detail = err instanceof Error ? err.message : String(err);
      c.header("x-geo-local-error", detail.slice(0, 120));
    }

    // ── 2. Fallback proxy server-side vers l'API geo OGC ───────────────────────
    const base = resolveBase();
    const qs = buildPassthroughQuery(c);
    const url = `${base}/collections/${encodeURIComponent(id)}/items?${qs}`;

    let res: Response;
    try {
      res = await fetchImpl(url);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return c.json(
        { ok: false, error: "geo_proxy_unreachable", collectionId: id, detail },
        502,
      );
    }

    if (res.status === 404) {
      // Collection réellement absente côté geo : 404 honnête (le client le gère).
      return c.json(
        { ok: false, error: "collection_not_found", collectionId: id },
        404,
      );
    }
    if (!res.ok) {
      return c.json(
        { ok: false, error: "geo_proxy_error", collectionId: id, status: res.status },
        502,
      );
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return c.json(
        { ok: false, error: "geo_proxy_bad_payload", collectionId: id, detail },
        502,
      );
    }

    // FeatureCollection OGC : lots enrichis (zone + flags), zonage tel quel.
    const fc = body as Record<string, unknown> & { features: unknown };
    const enriched = await enrichIfLots(parsed, fc);
    return c.json(enriched);
  });

  return app;
}
