/**
 * Provider simulation CS-L6 — données Netlify Steve pour les 4 villes.
 *
 * ## Mode simulation (SPEC §2.7)
 * Ces données sont marquées mode:"simulation" et NE franchissent JAMAIS
 * la frontière réel. Isolation totale du store opérationnel.
 *
 * ## Source de données
 * Fixtures JSON téléchargées le 2026-06-12 depuis :
 *   https://thriving-kleicha-89b7ef.netlify.app/data/<slug>.json
 * Stockées dans api/src/services/geo/fixtures/simulation/<slug>.json.
 * Données cadastrales publiques (NO_LOT, rôle 2022, zonage municipal).
 * Aucun nom de propriétaire / PII.
 *
 * ## Champs extraits (anti-invention)
 * Seuls les champs présents dans le JSON Steve sont mappés :
 *   NO_LOT, zone, superficie_m2_calculee, categorie, cubf, utilisation,
 *   annee_construction, nb_logements_role, nb_etages, val_totale,
 *   val_terrain, val_batiment, facade_m, profondeur_m, adresse, is_rue,
 *   tod, multifamilial_4plus, geom.
 * Les zones portent : zone (code), nom, geom.
 *
 * ## Couverture par ville
 *   - delson         : 500 lots / 3213, 101 zones, 4 TOD  — complet
 *   - sainte-catherine: 500 lots / 5615, 193 zones dessinées, 0 TOD
 *   - saint-constant : 500 lots / 11261, 265 zones, 1 TOD
 *   - candiac        : 500 lots / 7190,  0 zones, 0 TOD   — score partiel
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  zoneKindFromCode,
  densiteLogHaFromKind,
  usagesFromKind,
} from "./zone-kind.js";
import { lotPotentialScore } from "./lot-potential.js";
import type {
  SimulationLotProperties,
  SimulationZone,
  SimulationCityFixture,
  GeoJsonGeometry,
} from "./types.js";

// ─── Villes supportées en mode simulation ─────────────────────────────────────

export const SIMULATION_CITIES = [
  "delson",
  "sainte-catherine",
  "saint-constant",
  "candiac",
] as const;

export type SimulationCitySlug = (typeof SIMULATION_CITIES)[number];

/** Retourne true si le slug est une ville simulation. */
export function isSimulationCity(slug: string): slug is SimulationCitySlug {
  return (SIMULATION_CITIES as readonly string[]).includes(slug);
}

// ─── Lecture des fixtures ──────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "../fixtures/simulation");

/** Cache mémoire des fixtures parsées (chargées une fois). */
const fixtureCache = new Map<string, FixtureData>();

interface SteveLotProperties {
  NO_LOT?: unknown;
  zona?: unknown;
  zone?: unknown;
  superficie_m2_calculee?: unknown;
  categorie?: unknown;
  cubf?: unknown;
  utilisation?: unknown;
  annee_construction?: unknown;
  nb_logements_role?: unknown;
  nb_etages?: unknown;
  val_totale?: unknown;
  val_terrain?: unknown;
  val_batiment?: unknown;
  facade_m?: unknown;
  profondeur_m?: unknown;
  adresse?: unknown;
  is_rue?: unknown;
  tod?: unknown;
  multifamilial_4plus?: unknown;
}

interface SteveFeature {
  type: string;
  geometry?: GeoJsonGeometry | null;
  properties?: SteveLotProperties | null;
}

interface SteveZoneProperties {
  zone?: unknown;
  nom?: unknown;
}

interface SteveZoneFeature {
  type: string;
  geometry?: GeoJsonGeometry | null;
  properties?: SteveZoneProperties | null;
}

interface FixtureData {
  meta: Record<string, unknown>;
  lots: { type: string; features: SteveFeature[] };
  zones: { type: string; features: SteveZoneFeature[] };
  tod: { type: string; features: unknown[] };
}

function loadFixture(citySlug: string): FixtureData {
  const cached = fixtureCache.get(citySlug);
  if (cached) return cached;

  const fixturePath = join(FIXTURES_DIR, `${citySlug}.json`);
  const raw = readFileSync(fixturePath, "utf-8");
  const data = JSON.parse(raw) as Record<string, unknown>;

  const fixture: FixtureData = {
    meta: (data["meta"] as Record<string, unknown>) ?? {},
    lots: (data["lots"] as FixtureData["lots"]) ?? { type: "FeatureCollection", features: [] },
    zones: (data["zones"] as FixtureData["zones"]) ?? { type: "FeatureCollection", features: [] },
    tod: (data["tod"] as FixtureData["tod"]) ?? { type: "FeatureCollection", features: [] },
  };

  fixtureCache.set(citySlug, fixture);
  return fixture;
}

// ─── Zones ────────────────────────────────────────────────────────────────────

/**
 * Retourne les zones de la ville en mode simulation.
 * Chaque zone a : codeAffiche, nom, kind, densiteLogHa, usages, geom.
 */
export function getSimulationZones(citySlug: SimulationCitySlug): SimulationZone[] {
  const fixture = loadFixture(citySlug);
  const zonesFeatures = fixture.zones.features;

  return zonesFeatures
    .map((f): SimulationZone | null => {
      const props = f.properties;
      if (!props) return null;

      const codeAffiche = String(props["zone"] ?? "").trim();
      if (!codeAffiche) return null;

      const nom = String(props["nom"] ?? "");
      const kind = zoneKindFromCode(codeAffiche);
      const densiteLogHa = densiteLogHaFromKind(kind);
      const usages = usagesFromKind(kind);

      const geom = f.geometry ?? null;

      return {
        codeAffiche,
        nom,
        kind,
        densiteLogHa,
        usages,
        geom,
      };
    })
    .filter((z): z is SimulationZone => z !== null);
}

// ─── Lots enrichis ────────────────────────────────────────────────────────────

/**
 * Retourne les lots enrichis de la ville en mode simulation.
 *
 * Chaque lot est mappé depuis le JSON Steve vers SimulationLotProperties,
 * et reçoit un potentialScore calculé par lotPotentialScore().
 *
 * Les lots is_rue sont inclus mais marqués (potentialScore = 0).
 */
export function getSimulationLots(
  citySlug: SimulationCitySlug,
): Array<{ geometry: GeoJsonGeometry | null; properties: SimulationLotProperties }> {
  const fixture = loadFixture(citySlug);
  const lotsFeatures = fixture.lots.features;

  return lotsFeatures.map((f) => {
    const p = f.properties ?? {};

    // NO_LOT : normaliser espaces (ex. "2 427 992" → "2 427 992" préservé comme Steve)
    const noLot = String(p["NO_LOT"] ?? "").trim();
    const zone = String(p["zone"] ?? "").trim();
    const superficieM2 = Number(p["superficie_m2_calculee"] ?? 0);
    const tod = Boolean(p["tod"] ?? false);
    const isRue = Boolean(p["is_rue"] ?? false);

    const { score, detail } = lotPotentialScore(zone, superficieM2, tod, isRue);

    const properties: SimulationLotProperties = {
      noLot,
      citySlug,
      mode: "simulation",
      zone,
      superficieM2,
      categorie: String(p["categorie"] ?? ""),
      cubf: String(p["cubf"] ?? ""),
      utilisation: String(p["utilisation"] ?? ""),
      anneeConstruction: String(p["annee_construction"] ?? ""),
      nbLogementsRole: Number(p["nb_logements_role"] ?? 0),
      nbEtages: String(p["nb_etages"] ?? ""),
      valTotale: Number(p["val_totale"] ?? 0),
      valTerrain: Number(p["val_terrain"] ?? 0),
      valBatiment: Number(p["val_batiment"] ?? 0),
      facadeM: Number(p["facade_m"] ?? 0),
      profondeurM: Number(p["profondeur_m"] ?? 0),
      adresse: String(p["adresse"] ?? ""),
      isRue,
      tod,
      multifamilial4plus: Boolean(p["multifamilial_4plus"] ?? false),
      potentialScore: score,
      scoreDetail: detail,
    };

    // Géométrie : GeoJSON WGS84 (Polygon/MultiPolygon)
    const geom = f.geometry ?? null;

    return { geometry: geom, properties };
  });
}

// ─── Résumé (fixture info) ─────────────────────────────────────────────────────

/**
 * Retourne un résumé de la fixture pour une ville simulation.
 * Utile pour les tests et le monitoring.
 */
export function getSimulationCityFixture(
  citySlug: SimulationCitySlug,
): SimulationCityFixture {
  const fixture = loadFixture(citySlug);
  const lots = getSimulationLots(citySlug);

  const nLotsWithZone = lots.filter((l) => l.properties.zone !== "").length;
  const nLotsScored = lots.filter(
    (l) => l.properties.potentialScore !== null && l.properties.potentialScore > 0,
  ).length;

  return {
    citySlug,
    mode: "simulation",
    meta: fixture.meta,
    nLots: lots.length,
    nZones: fixture.zones.features.length,
    nTod: fixture.tod.features.length,
    nLotsWithZone,
    nLotsScored,
  };
}

// ─── FeatureCollection GeoJSON (pour l'endpoint /api/geo/:city/lots) ──────────

/**
 * Retourne un FeatureCollection GeoJSON des lots simulation.
 *
 * Compatible avec l'endpoint /api/geo/:city/lots enrichi (route geo-lots.ts).
 * Chaque feature.properties est un SimulationLotProperties complet
 * (zone, score, rôle, etc.) — plus riche que le mode "donnees-quebec"
 * qui ne retourne que noLot + citySlug.
 */
export function getSimulationLotsFeatureCollection(
  citySlug: SimulationCitySlug,
  opts: { limit?: number; bbox?: [number, number, number, number] } = {},
): {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: GeoJsonGeometry | null;
    properties: SimulationLotProperties;
  }>;
} {
  let lots = getSimulationLots(citySlug);

  // Filtre bbox si fourni (lon/lat WGS84 : minX,minY,maxX,maxY)
  if (opts.bbox) {
    const [minX, minY, maxX, maxY] = opts.bbox;
    lots = lots.filter((l) => {
      if (!l.geometry) return true; // pas de géométrie → inclus
      const coords = extractFirstCoordinate(l.geometry);
      if (!coords) return true;
      const [lon, lat] = coords;
      return lon >= minX && lon <= maxX && lat >= minY && lat <= maxY;
    });
  }

  // Limite
  if (opts.limit && opts.limit > 0) {
    lots = lots.slice(0, opts.limit);
  }

  return {
    type: "FeatureCollection",
    features: lots.map((l) => ({
      type: "Feature" as const,
      geometry: l.geometry,
      properties: l.properties,
    })),
  };
}

/** Extrait les premières coordonnées [lon, lat] d'une géométrie. */
function extractFirstCoordinate(
  geom: GeoJsonGeometry,
): [number, number] | null {
  try {
    if (geom.type === "Polygon") {
      const rings = geom.coordinates as number[][][];
      const first = rings[0]?.[0];
      if (first && first.length >= 2) {
        return [first[0]!, first[1]!];
      }
    }
    if (geom.type === "MultiPolygon") {
      const polys = geom.coordinates as number[][][][];
      const first = polys[0]?.[0]?.[0];
      if (first && first.length >= 2) {
        return [first[0]!, first[1]!];
      }
    }
  } catch {
    // Géométrie malformée → inclure le lot
  }
  return null;
}

