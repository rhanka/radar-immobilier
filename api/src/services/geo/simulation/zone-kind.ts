/**
 * Dérivation du kind et de la densité estimée d'une zone Steve
 * à partir du préfixe de son code de zone.
 *
 * Anti-invention : aucun chiffre inventé. Les densités sont des
 * estimations conservatrices basées sur les prefixes documentés dans
 * SPEC_EVOL_INTEGRATION_CARTE_STEVE.md §4 + ARCHITECTURE.md.
 *
 * Correspondances documentées :
 *   H-NNN  → habitation (résidentiel) — Delson règlement 901
 *   RM-NNN → résidentiel mixte (habitation)
 *   M-NNN  → mixte
 *   MS-NNN → mixte-secteur (Saint-Constant)
 *   MxtV-N → mixte-villageois
 *   C-NNN  → commercial
 *   I-NNN  → industriel
 *   ID-NNN → industriel (Saint-Constant)
 *   P-NNN  → public/institutionnel
 *   CGS-N  → public (Saint-Constant)
 *   "" / "N/D" → inconnu
 */

import type { SimulationZoneKind } from "./types.js";
import type { ZoneKind } from "../../scoring/lot-potential.js";

/** Regex par préfixe → kind. Ordre : plus spécifique d'abord. */
const ZONE_PREFIX_RULES: Array<{ re: RegExp; kind: SimulationZoneKind }> = [
  { re: /^(H|RM)-/i,             kind: "habitation"  },
  { re: /^(M|MS|MxtV)-/i,        kind: "mixte"       },
  { re: /^C-/i,                   kind: "commercial"  },
  { re: /^(I|ID)-/i,             kind: "industriel"  },
  { re: /^(P|CGS)-/i,            kind: "public"      },
];

/**
 * Dérive le kind d'une zone à partir de son code.
 * "N/D" ou "" → "autre".
 */
export function zoneKindFromCode(codeAffiche: string): SimulationZoneKind {
  const trimmed = codeAffiche.trim();
  if (!trimmed || trimmed === "N/D") return "autre";
  for (const rule of ZONE_PREFIX_RULES) {
    if (rule.re.test(trimmed)) return rule.kind;
  }
  return "autre";
}

/**
 * Densité de logements estimée (log/ha) par kind de zone.
 *
 * Valeurs conservatrices basées sur les règlements typiques QC :
 *   habitation → 20 log/ha (R unifamilial dense à bifamilial)
 *   mixte      → 40 log/ha (immeuble + commerce en RDC)
 *   commercial → 0         (pas de logements permis en zone C)
 *   industriel → 0
 *   public     → 0
 *   autre      → 0
 */
const DENSITE_BY_KIND: Record<SimulationZoneKind, number> = {
  habitation:  20,
  mixte:       40,
  commercial:   0,
  industriel:   0,
  public:       0,
  conservation: 0,
  autre:        0,
};

/** Retourne la densiteLogHa estimée pour un kind de zone. */
export function densiteLogHaFromKind(kind: SimulationZoneKind): number {
  return DENSITE_BY_KIND[kind];
}

/**
 * Usages permis (liste) dérivés du kind.
 * Utilisés pour les filtres « usage actuel » (spec S-5).
 */
const USAGES_BY_KIND: Record<SimulationZoneKind, string[]> = {
  habitation:  ["résidentiel", "multi-logements"],
  mixte:       ["résidentiel", "commercial", "multi-logements"],
  commercial:  ["commercial"],
  industriel:  ["industriel"],
  public:      ["public", "institutionnel"],
  conservation:["conservation"],
  autre:       [],
};

/** Retourne les usages permis pour un kind. */
export function usagesFromKind(kind: SimulationZoneKind): string[] {
  return USAGES_BY_KIND[kind];
}

/**
 * Convertit un SimulationZoneKind (dérivé du préfixe Steve) vers
 * un ZoneKind canonique (SPEC_DESIGN_DATA_MODEL §1.1).
 *
 * Mapping :
 *   habitation  → H
 *   mixte       → MIXTE
 *   commercial  → C
 *   industriel  → I
 *   public      → P
 *   conservation→ CONS
 *   autre       → AUTRE
 */
const CANONICAL_KIND_MAP: Record<SimulationZoneKind, ZoneKind> = {
  habitation:   "H",
  mixte:        "MIXTE",
  commercial:   "C",
  industriel:   "I",
  public:       "P",
  conservation: "CONS",
  autre:        "AUTRE",
};

/**
 * Retourne le ZoneKind canonique pour un SimulationZoneKind.
 * Utilisé pour brancher la simulation sur le scorer canonique 0-10.
 */
export function canonicalKindFromSimKind(kind: SimulationZoneKind): ZoneKind {
  return CANONICAL_KIND_MAP[kind];
}
