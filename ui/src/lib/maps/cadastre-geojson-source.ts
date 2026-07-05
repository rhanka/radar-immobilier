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
 * `NO_LOT` est un numéro cadastral public (MERN) — conservé. `adresse` et
 * `code_postal` sont des données PUBLIQUES du rôle d'évaluation : elles
 * identifient la propriété, jamais une personne (décision : servies par geo,
 * consommées telles quelles). Aucun nom de personne, aucun propriétaire —
 * un champ `proprietaire` présent dans l'input n'est JAMAIS mappé.
 *
 * ── Mode:carte-steve ──────────────────────────────────────────────────────────
 * Les villes de la carte Steve sont rendues en `mode:"carte-steve"` : ce sont
 * des données réelles de la plateforme Netlify de Steve, distinctes du pipeline
 * MRNF. Le drapeau est porté par chaque jeu de couches (`mode`) pour que l'UI
 * badge « Données carte Steve ».
 */

// ── Schéma source brut (GeoJSON cadastral) ────────────────────────────────────
// On type uniquement les champs qu'on lit. Tout le reste est ignoré.

/** Propriétés d'un lot dans le GeoJSON cadastral (sous-ensemble lu). */
export interface CadastreRawLotProps {
  NO_LOT?: string;
  /**
   * Superficie RÉELLE du lot servie par geo (aire du polygone, m²) — prime
   * sur la calculée. Nom de champ geo : `surface_m2` (l'ancien nom
   * `superficie_m2` n'a JAMAIS été servi — bug de mapping #350).
   */
  surface_m2?: number;
  superficie_m2_calculee?: number;
  zone?: string;
  categorie?: string;
  multifamilial_4plus?: boolean;
  tod?: boolean;
  /** Flag TOD servi par geo (`in_tod`) — foldé sur le même badge que `tod`. */
  in_tod?: boolean;
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
  /** Façade CANONIQUE du lot servie par geo (m) — prime sur facade_m. */
  frontage_m?: number;
  facade_m?: number;
  profondeur_m?: number;
  is_rue?: boolean;
  /** Adresse civique du LOT (donnée publique du rôle — jamais une personne). */
  adresse?: string;
  /**
   * Code postal du lot servi par geo en FSA 3 caractères (ex. « J3Y » —
   * secteur postal, PAS le code 6 caractères licencié Postes Canada).
   */
  code_postal?: string;
  // Normes de zonage foldées par lot (servies par geo via zone_code) :
  // paires `<norme>_value` / `<norme>_unit`, verbatim-or-null.
  hauteur_max_value?: number | string;
  hauteur_max_unit?: string;
  densite_value?: number | string;
  densite_unit?: string;
  /** Façade MIN normée — DISTINCTE de la façade réelle `frontage_m`. */
  frontage_min_value?: number | string;
  frontage_min_unit?: string;
  /** Superficie MIN normée — DISTINCTE de l'aire réelle `surface_m2`. */
  superficie_min_value?: number | string;
  superficie_min_unit?: string;
  marge_avant_min_value?: number | string;
  marge_avant_min_unit?: string;
  marge_laterale_min_value?: number | string;
  marge_laterale_min_unit?: string;
  marge_arriere_min_value?: number | string;
  marge_arriere_min_unit?: string;
  // Tout champ nominatif (ex. `proprietaire`) N'EST JAMAIS lu (anti-PII).
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
  /**
   * Superficie RÉELLE du lot (m²) : `surface_m2` servie par geo (aire du
   * polygone), sinon `superficie_m2_calculee` de la source. null quand
   * aucune n'est servie — la fiche affiche « — » (AUCUN calcul immo,
   * aucune invention).
   */
  superficieM2: number | null;
  /** Façade CANONIQUE geo (`frontage_m`), null quand non servie. */
  frontageM: number | null;
  /** Façade mesurée par la source (`facade_m`), null quand non servie. */
  facadeM: number | null;
  /** Adresse civique du lot (donnée publique du rôle), null quand non servie. */
  adresse: string | null;
  /** Code postal servi par geo (FSA 3 caractères, ex. « J3Y »), null sinon. */
  codePostal: string | null;
  /**
   * Normes de zonage foldées par lot (servies par geo via `zone_code`),
   * verbatim-or-null — « valeur unité » quand l'unité est servie, la valeur
   * seule sinon. null quand aucune norme n'est servie (fiche « — »).
   * `superficieMin`/`frontageMin` sont des NORMES de grille — distinctes de
   * l'aire réelle `superficieM2` et de la façade réelle `frontageM`.
   */
  normes: {
    hauteur: string | null;
    densite: string | null;
    frontageMin: string | null;
    superficieMin: string | null;
    margeAvant: string | null;
    margeLaterale: string | null;
    margeArriere: string | null;
  } | null;
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
/** Nombre servi, ou null honnête quand absent/invalide — aucune invention. */
function asNumberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
/** Chaîne non vide servie, ou null honnête quand absente. */
function asStringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}
/** Valeur verbatim : chaîne non vide telle quelle, nombre fini rendu en chaîne. */
function asVerbatimOrNull(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return asStringOrNull(v);
}
/**
 * Norme geo « valeur + unité » (verbatim-or-null) : compose la paire
 * `<norme>_value`/`<norme>_unit` quand les deux sont servies, la valeur seule
 * sinon — aucune unité inventée. null quand la valeur n'est pas servie.
 */
function normeWithUnit(value: unknown, unit: unknown): string | null {
  const v = asVerbatimOrNull(value);
  if (v === null) return null;
  const u = asStringOrNull(unit);
  return u ? `${v} ${u}` : v;
}
/**
 * Normes de zonage foldées d'un lot (contrat geo via `zone_code`) → bloc
 * `normes` de nos props. null quand AUCUNE norme n'est servie.
 */
function mapLotNormes(p: CadastreRawLotProps): LotLayerProps["normes"] {
  const normes = {
    hauteur: normeWithUnit(p.hauteur_max_value, p.hauteur_max_unit),
    densite: normeWithUnit(p.densite_value, p.densite_unit),
    frontageMin: normeWithUnit(p.frontage_min_value, p.frontage_min_unit),
    superficieMin: normeWithUnit(p.superficie_min_value, p.superficie_min_unit),
    margeAvant: normeWithUnit(p.marge_avant_min_value, p.marge_avant_min_unit),
    margeLaterale: normeWithUnit(p.marge_laterale_min_value, p.marge_laterale_min_unit),
    margeArriere: normeWithUnit(p.marge_arriere_min_value, p.marge_arriere_min_unit),
  };
  return Object.values(normes).some((v) => v !== null) ? normes : null;
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
    // Flag TOD : `tod` de la source OU `in_tod` servi par geo (même sémantique).
    const tod = asBool(p.tod) || asBool(p.in_tod);
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
        // Superficie RÉELLE geo (`surface_m2`) prioritaire ; null honnête
        // quand rien n'est servi.
        superficieM2: asNumberOrNull(p.surface_m2) ?? asNumberOrNull(p.superficie_m2_calculee),
        frontageM: asNumberOrNull(p.frontage_m),
        facadeM: asNumberOrNull(p.facade_m),
        adresse: asStringOrNull(p.adresse),
        codePostal: asStringOrNull(p.code_postal),
        normes: mapLotNormes(p),
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
