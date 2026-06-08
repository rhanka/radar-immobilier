/**
 * WP4 source-investigation fixtures — REAL fetched samples (2026-06-08).
 *
 * Every value below was captured by a real server-side HTTP fetch against a
 * PUBLIC / open-data endpoint (no login, no paywall bypass, robots.txt-allowed).
 * Raw excerpts live next to the spike READMEs under `<spike>/samples/`. This
 * module is the typed, typecheck-clean index of those samples so the structure
 * is documented in code (anti-invention: nothing here is fabricated).
 *
 * Spike-only: NOT shipped into production (stays under `_spikes/`).
 */
import type { SourceKind } from "@radar/domain";

export type Reachability = "reachable" | "unreachable" | "login-gated";

export interface InvestigatedSource {
  /** stable spike id (matches the `_spikes/<id>/` directory) */
  readonly sourceId: string;
  readonly kind: SourceKind;
  /** province-wide (parametrized by geo code) vs municipal (per-CMS) */
  readonly scope: "province-wide" | "municipal" | "regional";
  /** the exact URL fetched */
  readonly url: string;
  readonly format: "html" | "pdf" | "xml" | "csv" | "json" | "shp" | "wms" | "geojson";
  readonly reachable: Reachability;
  /** observed HTTP status of the real probe */
  readonly httpStatus: number;
  /** ontology entities this source feeds (SPEC_ONTOLOGY_DATA_MODEL) */
  readonly feeds: readonly string[];
  /** city slugs covered by a real sample, when municipal/parametrized */
  readonly citiesCovered: readonly string[];
  readonly requiresLogin: boolean;
  readonly note: string;
}

/** code MAMH (géo) per pilot city — confirmed in the role index CSV. */
export const CITY_GEO_CODES = {
  "salaberry-de-valleyfield": "70052",
  beauharnois: "70022",
} as const satisfies Record<string, string>;

/**
 * Role d'évaluation foncière (MAMH open data) — REAL first record, Valleyfield.
 * Source: https://donneesouvertes.affmunqc.net/role/RL70052_2026.xml (27.5 MB).
 * XSD-coded fields (RL.xsd, VERSION 2.9). Feeds Lot (RL0103Ax = NO_LOT) and
 * Valuation (RL0402A land / RL0404A total / RL0405A building value).
 */
export const ROLE_MAMH_SAMPLE_VALLEYFIELD = {
  geoCode: "70052",
  year: "2026",
  street: "MGR-LANGLOIS", // RL0101Gx
  noLots: ["4193751", "4193752", "5559304", "5650993", "5650994"], // RL0103Ax
  landAreaM2: 659.1, // RL0301A
  valuationDate: "2024-07-01", // RL0401A
  landValue: 332955.7, // RL0302A (terrain) — note: RL0402A=2748500 value at role
  totalValue: 2748500, // RL0404A
  buildingValue: 1331800, // RL0405A
} as const;

/** Role d'évaluation — REAL first record, Beauharnois (70022, 9.06 MB XML). */
export const ROLE_MAMH_SAMPLE_BEAUHARNOIS = {
  geoCode: "70022",
  year: "2026",
  civicNumber: "20", // RL0101Ax
  street: "1RE AVENUE", // RL0101Gx
  noLots: ["4716029"], // RL0103Ax
  landAreaM2: 22.86, // RL0301A
  yearBuilt: 2004, // RL0307A
  valuationDate: "2024-07-01", // RL0401A
  landValue: 136000, // RL0402A
  buildingValue: 308000, // RL0403A
  totalValue: 444000, // RL0404A
} as const;

/**
 * Adresses Québec via IGO terrapi geocoder — REAL responses.
 * Base: https://geoegl.msp.gouv.qc.ca/apis/terrapi/<type>?q=<text>&limit=<n>
 * 50+ types (adresses, municipalites, mrc, codes-postaux, intersections…).
 * `adresses` returns a provincial key in `code` (id_adresse), feeding Adresse.
 */
export const TERRAPI_GEOCODER_SAMPLE = {
  // /apis/terrapi/adresses?q=Salaberry-de-Valleyfield&limit=3 (first feature).
  // NOTE: the `adresses` endpoint matches on a leading token, so a free-form
  // "civic + street + city" string returns []; querying by the municipality
  // name (or postal prefix like "J6T") returns real Valleyfield addresses.
  adresse: {
    code: "000464c34bfd4f25862f208af2e3dbf5J6S6A5", // provincial id_adresse
    nom: "24 rue Paquette, Salaberry-de-Valleyfield J6S6A5",
    nbUnite: "1",
  },
  // /apis/terrapi/municipalites?q=Beauharnois
  municipalite: {
    code: "70022",
    nom: "Beauharnois",
    designation: "V",
    population: 15313,
    mrcCode: "700",
    regAdminCode: "16",
  },
} as const;

/** The investigated sources with real reachability verdicts. */
export const WP4_INVESTIGATED_SOURCES: readonly InvestigatedSource[] = [
  {
    sourceId: "avis-publics-valleyfield",
    kind: "avis-publics",
    scope: "municipal",
    url: "https://www.ville.valleyfield.qc.ca/avis-publics",
    format: "html",
    reachable: "reachable",
    httpStatus: 200,
    feeds: ["DesignationEvent", "Bylaw", "Signal"],
    citiesCovered: ["salaberry-de-valleyfield"],
    requiresLogin: false,
    note:
      "Craft CMS; anchors `icon-block--is-link` -> CloudFront PDFs " +
      "(dua3m7xvptjbw.cloudfront.net). ~608 PDFs listed; dérogation/PPCMOI/" +
      "consultation/registre/EEV live. PDF fetch HTTP 200 application/pdf.",
  },
  {
    sourceId: "avis-publics-beauharnois",
    kind: "avis-publics",
    scope: "municipal",
    url: "https://ville.beauharnois.qc.ca/la-ville/administration-et-vie-democratique/avis-publics",
    format: "html",
    reachable: "reachable",
    httpStatus: 200,
    feeds: ["DesignationEvent", "Bylaw", "Signal"],
    citiesCovered: ["beauharnois"],
    requiresLogin: false,
    note:
      "WordPress (distinct CMS from Valleyfield/Craft). PDFs under " +
      "/wp-content/uploads/ (AP_DM-2026-0037 dérogation, AP-assemblee-" +
      "consultation_701-102, AEV_REG entrée-en-vigueur). PDF HTTP 200.",
  },
  {
    sourceId: "reglements-urbanisme-valleyfield",
    kind: "reglement",
    scope: "municipal",
    url:
      "https://www.ville.valleyfield.qc.ca/reglements-municipaux?cat=reglement-durbanisme&terme=",
    format: "html",
    reachable: "reachable",
    httpStatus: 200,
    feeds: ["Bylaw", "Zone", "DesignationEvent"],
    citiesCovered: ["salaberry-de-valleyfield"],
    requiresLogin: false,
    note:
      "Craft listing (171 KB) -> bylaw detail pages -> CloudFront PDFs under " +
      "/documents/reglements/ (same CDN as avis, different collection). " +
      "Reglement-450-02.pdf fetch HTTP 200 application/pdf 446881 bytes. 25 " +
      "real bylaw slugs captured (149/150/151/152/153/154/250/402/432/450).",
  },
  {
    sourceId: "roles-evaluation-fonciere-mamh",
    kind: "role-evaluation",
    scope: "province-wide",
    url: "https://donneesouvertes.affmunqc.net/role/indexRole2026.csv",
    format: "xml",
    reachable: "reachable",
    httpStatus: 200,
    feeds: ["Lot", "Valuation", "Adresse"],
    citiesCovered: ["salaberry-de-valleyfield", "beauharnois"],
    requiresLogin: false,
    note:
      "Index CSV maps geo code -> per-municipality XML. RL70052 27.5 MB, " +
      "RL70022 9.06 MB. XSD-coded (RL.xsd v2.9). HTTP supports Range requests " +
      "(206) for streaming.",
  },
  {
    sourceId: "donnees-quebec-catalog",
    kind: "donnees-quebec",
    scope: "province-wide",
    url: "https://www.donneesquebec.ca/recherche/api/3/action/package_search",
    format: "json",
    reachable: "reachable",
    httpStatus: 200,
    feeds: ["(infra: resolves resource URLs for other sources)"],
    citiesCovered: [],
    requiresLogin: false,
    note:
      "Standard CKAN API. package_search 'rôle évaluation' -> 46 datasets; " +
      "package_show resolves real download URLs (adresses-quebec, CPTAQ). " +
      "robots.txt allows /recherche/api/.",
  },
  {
    sourceId: "adresses-quebec-igo-geocoder",
    kind: "adresses-quebec",
    scope: "province-wide",
    url: "https://geoegl.msp.gouv.qc.ca/apis/terrapi/adresses",
    format: "geojson",
    reachable: "reachable",
    httpStatus: 200,
    feeds: ["Adresse", "Lot (geocode/normalize)", "Signal"],
    citiesCovered: ["salaberry-de-valleyfield", "beauharnois"],
    requiresLogin: false,
    note:
      "IGO terrapi geocoder, GeoJSON FeatureCollection. `adresses` returns a " +
      "provincial id (code field). `municipalites` returns code MAMH + " +
      "population + mrcCode. Bulk vector also via MRNF AQréseau SHP/GPKG.",
  },
  {
    sourceId: "cptaq-zone-agricole",
    kind: "cptaq",
    scope: "province-wide",
    url: "https://carto.cptaq.gouv.qc.ca/data/shapefiles/demandes.zip",
    format: "shp",
    reachable: "reachable",
    httpStatus: 200,
    feeds: ["Constraint", "DesignationEvent (cptaq subtype)", "Signal"],
    citiesCovered: [],
    requiresLogin: false,
    note:
      "Decisions shapefile 88 MB (HEAD 200 application/zip) + WMS at " +
      "carto.cptaq.gouv.qc.ca (MapServer 6.4.1). Also via Données Québec: " +
      "decisions-de-la-cptaq, zones-agricoles-permanentes (vque_58).",
  },
];
