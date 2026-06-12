/**
 * cadastre-geojson-source — Loader « mode:simulation » qui mappe un GeoJSON
 * cadastral municipal (lots / zones / TOD / boundary) vers les couches de
 * NOTRE carte carto.
 *
 * Nommage par DOMAINE : ce module modélise un *cadastre municipal GeoJSON*, pas
 * un client particulier. Les jeux de données de référence (provenant de la
 * plateforme d'un client tiers — voir `reference-cities.ts`) ne sont qu'un
 * INPUT/substrat de maquette ; ils n'imposent aucun nom d'architecture.
 *
 * L'adaptateur central est une fonction pure `mapCadastreCityToLayers(raw)` :
 * GeoJSON cadastral brut → `CadastreCityLayers`. Le `load*` n'est qu'une coquille
 * fetch/fixture autour de cet adaptateur, de sorte que le mapping est testable
 * offline (snapshot fixture).
 *
 * ── Provenance des champs (anti-invention) ───────────────────────────────────
 * Top-level : { meta, lots, zones, tod, boundary } — `lots`/`zones`/`tod`/
 * `boundary` sont des FeatureCollection GeoJSON WGS84. On ne mappe QUE des champs
 * présents dans l'input. Les propriétés de lot lues sont déclarées dans
 * `CadastreRawLotProps` ci-dessous.
 *
 * ── Anti-PII (Loi 25) ─────────────────────────────────────────────────────────
 * Le GeoJSON peut porter un champ `adresse` (adressage civique). On NE le mappe
 * PAS et le snapshot fixture committé ne le contient pas. `NO_LOT` est un numéro
 * cadastral public (MERN) — conservé. Aucun nom de personne, aucun propriétaire.
 *
 * ── Mode:carte-steve ──────────────────────────────────────────────────────────
 * Les villes de la carte Steve sont rendues en `mode:"carte-steve"` : ce sont
 * des données réelles de la plateforme Netlify de Steve, distinctes du pipeline
 * MRNF. Le drapeau est porté par chaque jeu de couches (`mode`) pour que l'UI
 * badge « Données carte Steve ».
 */

// ── Schéma source brut (GeoJSON cadastral) ────────────────────────────────────
// On type uniquement les champs qu'on lit. Tout le reste est ignoré.

/** Propriétés d'un lot dans le GeoJSON cadastral (sous-ensemble lu — sans `adresse`). */
export interface CadastreRawLotProps {
  NO_LOT?: string;
  superficie_m2_calculee?: number;
  zone?: string;
  categorie?: string;
  multifamilial_4plus?: boolean;
  tod?: boolean;
  priorite?: boolean;
  zone_desc?: string;
  cubf?: string;
  utilisation?: string;
  annee_construction?: string;
  nb_logements_role?: number;
  val_totale?: number;
  val_terrain?: number;
  val_batiment?: number;
  nb_etages?: string;
  facade_m?: number;
  profondeur_m?: number;
  is_rue?: boolean;
  // `adresse` peut exister dans l'input mais N'EST PAS lue (anti-PII).
}

export interface GeoJsonGeometry {
  type: string;
  coordinates: unknown;
}

export interface CadastreRawFeature<P> {
  type: "Feature";
  properties: P;
  geometry: GeoJsonGeometry | null;
}

export interface CadastreRawFC<P> {
  type: "FeatureCollection";
  features: Array<CadastreRawFeature<P>>;
}

export interface CadastreRawMeta {
  nom?: string;
  slug?: string;
  region?: string;
  population?: number;
  /** bbox au format input = [latMin, lonMin, latMax, lonMax]. */
  bbox?: [number, number, number, number];
  /** centre au format input = [lat, lon]. */
  centre?: [number, number];
  zoom_initial?: number;
  reglements?: string;
  postal_prefix?: string;
}

export interface CadastreRawCity {
  meta?: CadastreRawMeta;
  lots?: CadastreRawFC<CadastreRawLotProps>;
  zones?: CadastreRawFC<{ zone?: string; nom?: string }>;
  tod?: CadastreRawFC<{ nom?: string; id?: string }>;
  boundary?: CadastreRawFC<{ name?: string; CSDUID?: string }>;
}

// ── Modèle interne / couches GeoJSON de NOTRE carte ───────────────────────────

/**
 * Propriétés normalisées d'un lot dans NOS couches.
 *
 * `potentialScore` ∈ [0,1] : score de potentiel PAR LOT (dérivé placeholder
 * local — voir `deriveLotPotentialScore`). Ce n'est PAS le `scoreGlobal` /100
 * des opportunités (banni, cf. SPEC §S-1) : c'est une grandeur par-lot
 * normalisée, data-driven, qui pilote le coloriage de la couche.
 */
export interface LotLayerProps {
  noLot: string;
  zone: string;
  categorie: string;
  fourPlus: boolean;
  tod: boolean;
  priorite: boolean;
  zoneDesc: string;
  superficieM2: number;
  nbLogementsRole: number;
  potentialScore: number; // [0,1]
  /** `true` quand le score vient du placeholder local (pas de l'API canonique). */
  scorePlaceholder: boolean;
}

export type LotFC = CadastreRawFC<LotLayerProps>;
export type ZoneFC = CadastreRawFC<{ zone: string; nom: string }>;
export type TodFC = CadastreRawFC<{ nom: string }>;
export type BoundaryFC = CadastreRawFC<{ name: string; csduid: string }>;

export type LayerMode = "carte-steve" | "simulation" | "real";

export interface CadastreCityLayers {
  slug: string;
  name: string;
  region: string;
  /** bbox réordonnée → [lonMin, latMin, lonMax, latMax]. */
  bounds: [number, number, number, number];
  center: [number, number]; // [lon, lat]
  zoom: number;
  reglements: string;
  mode: LayerMode;
  counts: {
    lots: number;
    fourPlus: number;
    tod: number;
    priorite: number;
    zones: number;
  };
  lots: LotFC;
  zones: ZoneFC;
  tod: TodFC;
  boundary: BoundaryFC;
}

// ── Dérivé de score placeholder (PAR LOT) ─────────────────────────────────────

/**
 * Dérive un score de potentiel par lot ∈ [0,1].
 *
 * TODO: brancher GET /api/.../score (score-de-potentiel-par-lot canonique, livré
 * par un autre lot backend, dérivé `ZoneVersion.densiteLogHa`/usages ∩ TOD ∩
 * pré-filtres — cf. SPEC §S-1). Tant que cette API n'existe pas, on calcule un
 * proxy LOCAL, transparent et clairement marqué `scorePlaceholder: true`.
 *
 * Heuristique (uniquement des champs présents dans l'input, aucune invention) :
 *   priorite (4+ ∩ TOD)         → 1.0
 *   multifamilial_4plus seul    → 0.7
 *   tod seul                    → 0.45
 *   ni l'un ni l'autre          → 0.15
 * Les lots `is_rue` (emprises de rue) renvoient 0 (exclus du potentiel).
 */
export function deriveLotPotentialScore(p: CadastreRawLotProps): number {
  if (p.is_rue) return 0;
  if (p.priorite) return 1;
  if (p.multifamilial_4plus) return 0.7;
  if (p.tod) return 0.45;
  return 0.15;
}

// ── Adaptateur cadastre → couches (PUR, testable offline) ─────────────────────

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function asNumber(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function asBool(v: unknown): boolean {
  return v === true;
}

export interface MapCadastreOptions {
  mode?: LayerMode;
  /** Injecte le score canonique quand l'API existera ; défaut = placeholder local. */
  scoreFn?: (p: CadastreRawLotProps) => number;
  /** Exclut les lots `is_rue` (emprises de rue) du rendu. */
  excludeRue?: boolean;
}

/**
 * Mappe une ville cadastrale brute (GeoJSON) vers nos couches.
 */
export function mapCadastreCityToLayers(
  raw: CadastreRawCity,
  opts: MapCadastreOptions = {},
): CadastreCityLayers {
  const mode = opts.mode ?? "carte-steve";
  const scoreFn = opts.scoreFn ?? deriveLotPotentialScore;
  const usingPlaceholder = opts.scoreFn === undefined;
  const excludeRue = opts.excludeRue ?? true;

  const meta = raw.meta ?? {};
  const slug = asString(meta.slug, "unknown");
  const name = asString(meta.nom, slug);

  // bbox input = [latMin, lonMin, latMax, lonMax] → bounds [lonMin,latMin,lonMax,latMax]
  const b = meta.bbox;
  const bounds: [number, number, number, number] =
    b && b.length === 4 ? [b[1], b[0], b[3], b[2]] : [-73.6, 45.34, -73.5, 45.41];
  // centre input = [lat, lon] → center [lon, lat]
  const c = meta.centre;
  const center: [number, number] = c && c.length === 2 ? [c[1], c[0]] : [bounds[0], bounds[1]];

  // ── Lots ──────────────────────────────────────────────────────────────────
  const rawLots = raw.lots?.features ?? [];
  const lotFeatures: LotFC["features"] = [];
  let nFourPlus = 0;
  let nTod = 0;
  let nPriorite = 0;
  for (const f of rawLots) {
    const p = f.properties ?? {};
    if (excludeRue && asBool(p.is_rue)) continue;
    if (!f.geometry) continue;
    const fourPlus = asBool(p.multifamilial_4plus);
    const tod = asBool(p.tod);
    const priorite = asBool(p.priorite);
    if (fourPlus) nFourPlus++;
    if (tod) nTod++;
    if (priorite) nPriorite++;
    lotFeatures.push({
      type: "Feature",
      geometry: f.geometry,
      properties: {
        noLot: asString(p.NO_LOT),
        zone: asString(p.zone),
        categorie: asString(p.categorie),
        fourPlus,
        tod,
        priorite,
        zoneDesc: asString(p.zone_desc),
        superficieM2: asNumber(p.superficie_m2_calculee),
        nbLogementsRole: asNumber(p.nb_logements_role),
        potentialScore: clamp01(scoreFn(p)),
        scorePlaceholder: usingPlaceholder,
      },
    });
  }

  // ── Zones ─────────────────────────────────────────────────────────────────
  const zoneFeatures: ZoneFC["features"] = (raw.zones?.features ?? [])
    .filter((f) => !!f.geometry)
    .map((f) => ({
      type: "Feature",
      geometry: f.geometry,
      properties: {
        zone: asString(f.properties?.zone),
        nom: asString(f.properties?.nom),
      },
    }));

  // ── TOD ───────────────────────────────────────────────────────────────────
  const todFeatures: TodFC["features"] = (raw.tod?.features ?? [])
    .filter((f) => !!f.geometry)
    .map((f) => ({
      type: "Feature",
      geometry: f.geometry,
      properties: { nom: asString(f.properties?.nom) },
    }));

  // ── Boundary ──────────────────────────────────────────────────────────────
  const boundaryFeatures: BoundaryFC["features"] = (raw.boundary?.features ?? [])
    .filter((f) => !!f.geometry)
    .map((f) => ({
      type: "Feature",
      geometry: f.geometry,
      properties: {
        name: asString(f.properties?.name),
        csduid: asString(f.properties?.CSDUID),
      },
    }));

  return {
    slug,
    name,
    region: asString(meta.region),
    bounds,
    center,
    zoom: asNumber(meta.zoom_initial, 14),
    reglements: asString(meta.reglements),
    mode,
    counts: {
      lots: lotFeatures.length,
      fourPlus: nFourPlus,
      tod: nTod,
      priorite: nPriorite,
      zones: zoneFeatures.length,
    },
    lots: { type: "FeatureCollection", features: lotFeatures },
    zones: { type: "FeatureCollection", features: zoneFeatures },
    tod: { type: "FeatureCollection", features: todFeatures },
    boundary: { type: "FeatureCollection", features: boundaryFeatures },
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

// ── Loader (fixture offline OU fetch live) ────────────────────────────────────

export interface LoadCadastreCityOptions {
  /** JSON brut déjà chargé (fixture/test) — court-circuite tout réseau. */
  raw?: CadastreRawCity;
  /** Base HTTP du substrat de référence (défaut : `reference-cities.ts`). */
  base?: string;
  fetchImpl?: typeof fetch;
  scoreFn?: (p: CadastreRawLotProps) => number;
  mode?: LayerMode;
}

/**
 * Charge une ville cadastrale et retourne nos couches.
 *
 * - Si `opts.raw` est fourni (fixture), aucun réseau : mapping direct.
 * - Sinon fetch live le JSON de référence (mode:carte-steve) puis mappe.
 */
export async function loadCadastreCity(
  slug: string,
  opts: LoadCadastreCityOptions = {},
): Promise<CadastreCityLayers> {
  if (opts.raw) {
    return mapCadastreCityToLayers(opts.raw, { mode: opts.mode, scoreFn: opts.scoreFn });
  }
  const { resolveReferenceCityUrl } = await import("./reference-cities.js");
  const f = opts.fetchImpl ?? fetch;
  const url = resolveReferenceCityUrl(slug, opts.base);
  const res = await f(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`cadastre city HTTP ${res.status} for ${slug}`);
  }
  const raw = (await res.json()) as CadastreRawCity;
  return mapCadastreCityToLayers(raw, { mode: opts.mode, scoreFn: opts.scoreFn });
}
