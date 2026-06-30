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

export function geoCollectionsRoute(deps: GeoCollectionsDeps = {}): Hono {
  const app = new Hono();
  const localResolver = deps.localResolver ?? makeDbLocalResolver(deps.db);
  const fetchImpl = deps.fetchImpl ?? fetch;

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
        return c.json({
          type: "FeatureCollection",
          features: limited.features,
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
    const base = (
      deps.baseUrl ??
      process.env["GEO_OGC_BASE_URL"] ??
      DEFAULT_OGC_BASE_URL
    ).replace(/\/$/, "");
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

    // FeatureCollection OGC renvoyée telle quelle.
    return c.json(body as Record<string, unknown>);
  });

  return app;
}
