/**
 * Tests de zoneAllows4Plus — dérivation pure « la zone permet le 4 logements+ ».
 * Cas : grille réelle (densité / usages), heuristique par kind, alignement
 * avec la table de densités du mode carte-Steve (zone-kind.ts).
 */
import { describe, expect, it } from "vitest";
import {
  zoneAllows4Plus,
  MULTIFAMILIAL_4PLUS_MIN_DENSITE_LOG_HA,
} from "./zone-allows-4plus.js";
import {
  densiteLogHaFromKind,
  canonicalKindFromSimKind,
} from "../geo/simulation/zone-kind.js";
import type { ZoneKind } from "./lot-potential.js";

describe("zoneAllows4Plus — grille réelle", () => {
  it("densité réelle 45 log/ha (zone H) → true, confidence grille", () => {
    expect(
      zoneAllows4Plus({ kind: "H", densiteLogHa: 45, usages: [] }),
    ).toEqual({ allows4Plus: true, confidence: "grille" });
  });

  it("densité réelle exactement au seuil (20) → false (strictement supérieur)", () => {
    expect(
      zoneAllows4Plus({
        kind: "H",
        densiteLogHa: MULTIFAMILIAL_4PLUS_MIN_DENSITE_LOG_HA,
        usages: [],
      }),
    ).toEqual({ allows4Plus: false, confidence: "grille" });
  });

  it("densité réelle faible (15) sur zone MIXTE → false : la grille prime sur le kind", () => {
    expect(
      zoneAllows4Plus({ kind: "MIXTE", densiteLogHa: 15, usages: [] }),
    ).toEqual({ allows4Plus: false, confidence: "grille" });
  });

  it("usages réels contenant multi-logements → true, grille (même sans densité)", () => {
    expect(
      zoneAllows4Plus({
        kind: "H",
        densiteLogHa: null,
        usages: ["résidentiel", "multi-logements"],
      }),
    ).toEqual({ allows4Plus: true, confidence: "grille" });
  });

  it("usages réels 'multifamiliale 4 logements et plus' → true, grille", () => {
    expect(
      zoneAllows4Plus({
        kind: "H",
        densiteLogHa: null,
        usages: ["habitation multifamiliale 4 logements et plus"],
      }),
    ).toEqual({ allows4Plus: true, confidence: "grille" });
  });

  it("usages réels sans multi (unifamilial isolé) → false, grille (foi négative)", () => {
    expect(
      zoneAllows4Plus({
        kind: "H",
        densiteLogHa: null,
        usages: ["habitation unifamiliale isolée"],
      }),
    ).toEqual({ allows4Plus: false, confidence: "grille" });
  });

  it("densité sous le seuil MAIS usages multi → true (l'un ou l'autre suffit)", () => {
    expect(
      zoneAllows4Plus({
        kind: "H",
        densiteLogHa: 10,
        usages: ["multi-logements"],
      }),
    ).toEqual({ allows4Plus: true, confidence: "grille" });
  });
});

describe("zoneAllows4Plus — heuristique par kind (aucune donnée de grille)", () => {
  it("MIXTE → true (densité estimée 40 > 20)", () => {
    expect(
      zoneAllows4Plus({ kind: "MIXTE", densiteLogHa: null, usages: [] }),
    ).toEqual({ allows4Plus: true, confidence: "heuristique" });
  });

  it("H → false (densité estimée 20, sous-couverture assumée sans grille)", () => {
    expect(
      zoneAllows4Plus({ kind: "H", densiteLogHa: null, usages: [] }),
    ).toEqual({ allows4Plus: false, confidence: "heuristique" });
  });

  it.each(["C", "I", "P", "A", "CONS", "REC", "U", "AUTRE"] as ZoneKind[])(
    "%s → false (densité estimée 0)",
    (kind) => {
      expect(
        zoneAllows4Plus({ kind, densiteLogHa: null, usages: [] }),
      ).toEqual({ allows4Plus: false, confidence: "heuristique" });
    },
  );
});

describe("alignement avec la table du mode carte-Steve (zone-kind.ts)", () => {
  // La table locale HEURISTIC_DENSITE_BY_KIND est un miroir de DENSITE_BY_KIND
  // (couche simulation). Ce test verrouille l'alignement sans créer de
  // dépendance scoring → simulation dans le code de production.
  it.each([
    ["habitation", 20],
    ["mixte", 40],
    ["commercial", 0],
    ["industriel", 0],
    ["public", 0],
  ] as const)("kind Steve %s (densité %d) donne le même verdict", (simKind, densite) => {
    const canonical = canonicalKindFromSimKind(simKind);
    const steveDensite = densiteLogHaFromKind(simKind);
    expect(steveDensite).toBe(densite);

    const heuristique = zoneAllows4Plus({
      kind: canonical,
      densiteLogHa: null,
      usages: [],
    });
    expect(heuristique.allows4Plus).toBe(
      steveDensite > MULTIFAMILIAL_4PLUS_MIN_DENSITE_LOG_HA,
    );
  });
});
