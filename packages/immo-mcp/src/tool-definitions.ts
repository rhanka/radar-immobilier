import { z } from "zod";
import { mcpFinitePositiveField, mcpIntegerField, mcpString, mcpNonEmptyString, mcpBoolean, mcpBbox } from "./zod4-shapes.js";
import { IMMO_SCOPES } from "./auth-context.js";
import {
  RAW_GEOJSON_DEFAULT_LIMIT,
  RAW_GEOJSON_MAX_LIMIT,
} from "./raw-data.js";

/**
 * Single source of the twelve tool contracts consumed by the SDK registrar
 * and, later, the cluster-mesh bridge. Schemas, titles, descriptions, bounds
 * and defaults are byte-identical to the pre-extraction registrar: any drift
 * breaks the deployed-baseline fixture comparison.
 */
export interface ToolDefinition {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Record<string, z.ZodTypeAny>;
  readonly scope: string;
}

export type McpToolShape = Record<string, z.ZodTypeAny>;

const bboxSchema = mcpBbox()
  .optional()
  .describe(
    "Emprise [minLon, minLat, maxLon, maxLat] en WGS84 (ex: [-73.53, 45.52, -73.5, 45.55]). " +
      "Obligatoire quand limit > 500.",
  );

const limitSchema = mcpIntegerField({
  min: 1,
  max: RAW_GEOJSON_MAX_LIMIT,
  default: RAW_GEOJSON_DEFAULT_LIMIT,
  description:
    `Nombre max de features retournées (défaut ${RAW_GEOJSON_DEFAULT_LIMIT}, ` +
    `max ${RAW_GEOJSON_MAX_LIMIT} — bbox obligatoire au-delà de ${RAW_GEOJSON_DEFAULT_LIMIT}).`,
});

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: "search_lots",
    title: "Search lots",
    description:
      "Recherche de lots par ville et critères (zone, no_lot, superficie min). Read-only.",
    inputSchema: {
      city: mcpNonEmptyString().describe("Ville (ex: longueuil, valleyfield)"),
      zone: mcpString().optional().describe("Code de zonage (ex: H-203)"),
      no_lot: mcpString().optional().describe("Numéro de lot cadastral exact"),
      minArea: mcpFinitePositiveField({ optional: true, description: "Superficie minimale en m²" }),
      limit: mcpIntegerField({ min: 1, max: 100, default: 20 }),
    },
    scope: IMMO_SCOPES.search,
  },
  {
    name: "get_lot_card",
    title: "Get lot card",
    description: "Fiche détaillée d'un lot (zonage, superficie, signaux liés). Read-only.",
    inputSchema: {
      city: mcpNonEmptyString(),
      no_lot: mcpNonEmptyString().describe("Numéro de lot cadastral exact"),
    },
    scope: IMMO_SCOPES.read,
  },
  {
    name: "search_signals",
    title: "Search signals",
    description:
      "Recherche de signaux réglementaires par ville (étape, mot-clé). Read-only.",
    inputSchema: {
      city: mcpNonEmptyString(),
      etape: mcpString()
        .optional()
        .describe("Étape du processus (ex: avis_motion, adoption, consultation)"),
      query: mcpString().optional().describe("Mot-clé libre"),
      showDiscarded: mcpBoolean()
        .optional()
        .describe("Reveal archived signals hidden by default (default false). Read-only."),
      limit: mcpIntegerField({ min: 1, max: 100, default: 20 }),
    },
    scope: IMMO_SCOPES.search,
  },
  {
    name: "get_opportunity_dossier",
    title: "Get opportunity dossier",
    description:
      "Dossier d'opportunité consolidé (score, lots et signaux liés, rationale). Read-only.",
    inputSchema: {
      city: mcpNonEmptyString(),
      opportunityId: mcpNonEmptyString(),
    },
    scope: IMMO_SCOPES.read,
  },
  {
    name: "list_documents",
    title: "List documents",
    description:
      "Liste les documents sources archivés (procès-verbaux, etc.) par ville. Read-only.",
    inputSchema: {
      city: mcpString().optional(),
      limit: mcpIntegerField({ min: 1, max: 100, default: 20 }),
    },
    scope: IMMO_SCOPES.documentsRead,
  },
  {
    name: "read_document_excerpt",
    title: "Read document excerpt",
    description:
      "Lit un extrait borné d'un document source. La sortie est passée par la redaction anti-PII. Read-only.",
    inputSchema: {
      documentId: mcpNonEmptyString(),
      offset: mcpIntegerField({ min: 0, default: 0 }),
      maxChars: mcpIntegerField({ min: 1, max: 4000, default: 1200 }),
    },
    scope: IMMO_SCOPES.documentsRead,
  },
];

/** Raw-data tool contracts (zones/lots GeoJSON, grille & PV PDFs, provenance). */
export const RAW_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: "get_zones_geojson",
    title: "Get zones GeoJSON",
    description:
      "FeatureCollection GeoJSON des zones de zonage d'une ville (code de zone, kind, " +
      "grille PDF et propriétés sources). Réponse BORNÉE : limit défaut 500 (max 2000), " +
      "bbox [minLon,minLat,maxLon,maxLat] OBLIGATOIRE pour limit > 500. " +
      "numberMatched/numberReturned/truncated indiquent ce qui reste : si truncated, " +
      "resserrez le bbox. Read-only.",
    inputSchema: {
      city: mcpNonEmptyString().describe("Ville (slug, ex: longueuil, valleyfield, delson)"),
      bbox: bboxSchema,
      limit: limitSchema,
    },
    scope: IMMO_SCOPES.read,
  },
  {
    name: "get_lots_geojson",
    title: "Get lots GeoJSON",
    description:
      "FeatureCollection GeoJSON des lots cadastraux d'une ville, enrichis server-side : " +
      "zone jointe (zone.code/kind/densiteLogHa/usages/grillePdfUrl), zoneCode, " +
      "multifamilial4plus (+ multifamilial4plusSource: grille|heuristique), superficieM2, " +
      "tod/priorite quand la source les porte. Réponse BORNÉE : limit défaut 500 (max 2000), " +
      "bbox OBLIGATOIRE pour limit > 500 ; une ville peut dépasser 15 000 lots — paginez " +
      "par bbox. Filtres optionnels only4Plus/superficieMinM2 appliqués sur la page " +
      "récupérée. truncated=true → resserrez le bbox. Read-only.",
    inputSchema: {
      city: mcpNonEmptyString().describe("Ville (slug, ex: longueuil, valleyfield, delson)"),
      bbox: bboxSchema,
      limit: limitSchema,
      only4Plus: mcpBoolean()
        .optional()
        .describe("Ne garder que les lots dont multifamilial4plus === true"),
      superficieMinM2: mcpFinitePositiveField({})
        .optional()
        .describe("Superficie minimale en m² (champ superficieM2)"),
    },
    scope: IMMO_SCOPES.read,
  },
  {
    name: "get_grille_pdf",
    title: "Get grille de zonage PDF",
    description:
      "URL de la grille de zonage PDF (grillePdfUrl) d'une zone d'une ville, quand la " +
      "source municipale la porte. L'URL retournée est publique : elle peut être lue " +
      "directement. Retourne found=false si la zone est inconnue, grillePdfUrl=null si la " +
      "zone existe sans grille. Read-only.",
    inputSchema: {
      city: mcpNonEmptyString().describe("Ville (slug, ex: longueuil)"),
      zone: mcpNonEmptyString().describe("Code de zonage (ex: H-203)"),
    },
    scope: IMMO_SCOPES.documentsRead,
  },
  {
    name: "get_pv_pdf",
    title: "Get PV source PDF",
    description:
      "URL servie du procès-verbal source (PDF archivé) d'un signal, à partir de sa " +
      "référence brute rawRef (ex: raw/proces-verbaux-<ville>/cas/<sha>.pdf, telle que " +
      "portée par les signaux/documents) + métadonnées (ville, content-type). " +
      "Le PDF lui-même n'est jamais inliné dans la réponse. Read-only.",
    inputSchema: {
      rawRef: mcpNonEmptyString()
        .describe(
          "Référence brute du document (rawRef S3, ex: raw/proces-verbaux-longueuil/cas/<sha>.pdf ; " +
            "en mode mock: l'id de document, ex: doc-longueuil-pv-2026-04-14)",
        ),
    },
    scope: IMMO_SCOPES.documentsRead,
  },
  {
    name: "get_reglement_provenance",
    title: "Get règlement de zonage provenance",
    description:
      "Provenance du règlement de zonage en vigueur d'une ville — numéro, millésime, " +
      "page source, URL publique du règlement — telle que geo la stampe sur la grille " +
      "de normes (qc-zonage-norms), + la relation « modifie » (règlement ancien) quand " +
      "servie. Passthrough VERBATIM : un champ absent = null, jamais deviné/dérivé ; seul " +
      "reglement_url est l'URL publique (le breadcrumb interne _source_url n'est jamais " +
      "exposé). La provenance est muni-uniforme : zone_code est accepté mais n'affecte pas " +
      "le résultat (réservé au lien events, tool à venir). found=false si la grille de " +
      "normes n'est pas publiée pour la ville. Read-only.",
    inputSchema: {
      muni_slug: mcpNonEmptyString().describe("Ville (slug, ex: longueuil)"),
      zone_code: mcpString()
        .optional()
        .describe("Code de zone — accepté mais no-op pour la provenance (muni-uniforme)"),
    },
    scope: IMMO_SCOPES.read,
  },
  {
    name: "query_zoning_events",
    title: "Query zoning lifecycle events",
    description:
      "Timeline des events de cycle de vie du zonage d'une ville (avis de motion, " +
      "projets de règlement, adoptions, entrées en vigueur, dérogations, CPTAQ…) servis " +
      "par geo. Filtres exacts optionnels : zone_code (events liés à cette zone via " +
      "zone_codes_resolus), document_type (avis_motion|projet_reglement|adoption|" +
      "entree_en_vigueur|abrogation), decision_state (planned|decided). Chaque event est " +
      "renvoyé VERBATIM (§2 : document_type, decision_state, type_instrument, bylaw_numero, " +
      "date_iso, zone_codes_resolus, libelles_relation, url_pdf, provenance…) ; les clés " +
      "internes préfixées « _ » (breadcrumbs) ne sont jamais exposées. decision_state=planned " +
      "n'est JAMAIS présenté comme adopté (planned ≠ decided). Read-only.",
    inputSchema: {
      muni_slug: mcpNonEmptyString().describe("Ville (slug, ex: longueuil)"),
      zone_code: mcpString()
        .optional()
        .describe("Filtre : events liés à ce code de zone (exact, via zone_codes_resolus)"),
      document_type: mcpString()
        .optional()
        .describe("Filtre exact : avis_motion|projet_reglement|adoption|entree_en_vigueur|abrogation"),
      decision_state: mcpString()
        .optional()
        .describe("Filtre exact : planned|decided"),
    },
    scope: IMMO_SCOPES.read,
  },
];

/** Every tool contract in registration order (domain first, raw-data second). */
export const ALL_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  ...TOOL_DEFINITIONS,
  ...RAW_TOOL_DEFINITIONS,
];

/** Scope required per tool name (mirrors the registrar enforcement). */
export const TOOL_SCOPE_BY_NAME: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(ALL_TOOL_DEFINITIONS.map((def) => [def.name, def.scope])),
);
