/**
 * Tests du filtre par TYPE de zone (zone-kind-filter) — en-tête de
 * l'accordéon ZONES du drawer droit.
 *
 * Vérifie : groupes dérivés de la légende (labels non dupliqués, CONS+REC
 * fusionnés), matching additif (vide = tout), compteurs N/M et par groupe,
 * peinture pilotée (matchée accentuée / hors-filtre estompée / filtre
 * inactif → null, la hiérarchie existante s'applique).
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_ZONE_KIND_FILTER,
  isDefaultZoneKindFilter,
  zoneKindGroupId,
  zoneMatchesKindFilter,
  countZoneKindMatches,
  zoneKindGroupCounts,
  zoneKindFilterOpacity,
  ZONE_KIND_GROUPS,
  ZONE_KIND_FILTER_DIMMED_OPACITY,
  ZONE_KIND_FILTER_MATCH_OPACITY,
  type ZoneKindFilter,
  type ZoneKindGroupId,
} from "./zone-kind-filter.js";
import { ZONE_KIND_STYLES, ZONE_KIND_NEUTRAL } from "./zone-kind-style.js";

function filterOf(...ids: ZoneKindGroupId[]): ZoneKindFilter {
  return new Set(ids);
}

const ZONES = [
  { kind: "Habitation", code: "H-431" },
  { kind: null, code: "H-102" }, // kind résolu par préfixe de code
  { kind: "Commerce", code: "C-186" },
  { kind: null, code: "I-93" },
  { kind: "Conservation", code: "CONS-1" },
  { kind: "Récréation", code: "REC-2" },
  { kind: null, code: "XYZ-9" }, // irrésolu → Type non déterminé
];

// ── Groupes dérivés de la légende ─────────────────────────────────────────────

describe("ZONE_KIND_GROUPS — dérivés de zone-kind-style, pas dupliqués", () => {
  it("reprend les libellés de la légende zonage tels quels", () => {
    const byId = new Map(ZONE_KIND_GROUPS.map((g) => [g.id, g.label]));
    expect(byId.get("H")).toBe(ZONE_KIND_STYLES.H.label);
    expect(byId.get("C")).toBe(ZONE_KIND_STYLES.C.label);
    expect(byId.get("CONS_REC")).toBe(ZONE_KIND_STYLES.CONS.label);
    expect(byId.get("UNRESOLVED")).toBe(ZONE_KIND_NEUTRAL.label);
  });

  it("CONS et REC partagent le même groupe (même entrée de légende)", () => {
    expect(zoneKindGroupId("Conservation", "CONS-1")).toBe("CONS_REC");
    expect(zoneKindGroupId("Récréation", "REC-2")).toBe("CONS_REC");
  });

  it("kind irrésolu → UNRESOLVED (aucune invention)", () => {
    expect(zoneKindGroupId(null, "XYZ-9")).toBe("UNRESOLVED");
    expect(zoneKindGroupId("", null)).toBe("UNRESOLVED");
  });

  it("kind absent mais code préfixé → résolu par le code (H-102 → H)", () => {
    expect(zoneKindGroupId(null, "H-102")).toBe("H");
    expect(zoneKindGroupId(null, "I-93")).toBe("I");
  });
});

// ── Matching additif ──────────────────────────────────────────────────────────

describe("zoneMatchesKindFilter — additif, vide = toutes", () => {
  it("filtre vide (défaut) : toute zone matche", () => {
    expect(isDefaultZoneKindFilter(DEFAULT_ZONE_KIND_FILTER)).toBe(true);
    for (const z of ZONES) {
      expect(zoneMatchesKindFilter(z.kind, z.code, DEFAULT_ZONE_KIND_FILTER)).toBe(true);
    }
  });

  it("un groupe sélectionné : seules ses zones matchent", () => {
    const f = filterOf("H");
    expect(zoneMatchesKindFilter("Habitation", "H-431", f)).toBe(true);
    expect(zoneMatchesKindFilter(null, "H-102", f)).toBe(true);
    expect(zoneMatchesKindFilter("Commerce", "C-186", f)).toBe(false);
  });

  it("multi-sélection ADDITIVE : l'union des groupes matche", () => {
    const f = filterOf("H", "I");
    expect(zoneMatchesKindFilter("Habitation", "H-431", f)).toBe(true);
    expect(zoneMatchesKindFilter(null, "I-93", f)).toBe(true);
    expect(zoneMatchesKindFilter("Commerce", "C-186", f)).toBe(false);
  });

  it("UNRESOLVED sélectionnable : matche les zones au type non déterminé", () => {
    const f = filterOf("UNRESOLVED");
    expect(zoneMatchesKindFilter(null, "XYZ-9", f)).toBe(true);
    expect(zoneMatchesKindFilter("Habitation", "H-431", f)).toBe(false);
  });
});

// ── Compteurs ─────────────────────────────────────────────────────────────────

describe("compteurs N/M et par groupe", () => {
  it("countZoneKindMatches : N matchées sur l'ensemble fourni", () => {
    expect(countZoneKindMatches(ZONES, DEFAULT_ZONE_KIND_FILTER)).toBe(ZONES.length);
    expect(countZoneKindMatches(ZONES, filterOf("H"))).toBe(2);
    expect(countZoneKindMatches(ZONES, filterOf("H", "CONS_REC"))).toBe(4);
    expect(countZoneKindMatches(ZONES, filterOf("A"))).toBe(0);
  });

  it("zoneKindGroupCounts : seuls les groupes présents, avec leur compte", () => {
    const counts = zoneKindGroupCounts(ZONES);
    expect(counts.get("H")).toBe(2);
    expect(counts.get("C")).toBe(1);
    expect(counts.get("I")).toBe(1);
    expect(counts.get("CONS_REC")).toBe(2);
    expect(counts.get("UNRESOLVED")).toBe(1);
    expect(counts.has("A")).toBe(false); // groupe absent → pas de chip
  });
});

// ── Peinture pilotée par le filtre ───────────────────────────────────────────

describe("zoneKindFilterOpacity — peinture pilotée, zéro refetch", () => {
  it("filtre inactif → null (la hiérarchie d'opacité existante s'applique)", () => {
    expect(zoneKindFilterOpacity("Habitation", "H-431", DEFAULT_ZONE_KIND_FILTER)).toBeNull();
  });

  it("zone matchée → teinte accentuée ; hors-filtre → estompée, jamais 0", () => {
    const f = filterOf("H");
    expect(zoneKindFilterOpacity("Habitation", "H-431", f)).toBe(
      ZONE_KIND_FILTER_MATCH_OPACITY,
    );
    expect(zoneKindFilterOpacity("Commerce", "C-186", f)).toBe(
      ZONE_KIND_FILTER_DIMMED_OPACITY,
    );
    // Hors-filtre : estompée mais VISIBLE (opacité strictement positive).
    expect(ZONE_KIND_FILTER_DIMMED_OPACITY).toBeGreaterThan(0);
    expect(ZONE_KIND_FILTER_DIMMED_OPACITY).toBeLessThan(
      ZONE_KIND_FILTER_MATCH_OPACITY,
    );
  });
});
