import { describe, it, expect } from "vitest";
import { STEVE30, STEVE30_SCORED } from "./dataset.js";
import type { SteveFeatures } from "./features.js";

describe("STEVE30 dataset integrity", () => {
  it("has 31 signal rows over 30 distinct cities (Mont-Saint-Hilaire ×2)", () => {
    expect(STEVE30).toHaveLength(31);
    expect(new Set(STEVE30.map((r) => r.city)).size).toBe(30);
  });
  it("has unique ids", () => {
    expect(new Set(STEVE30.map((r) => r.id)).size).toBe(STEVE30.length);
  });
  it("status is 'scored' iff a note is present", () => {
    for (const r of STEVE30) {
      expect(r.status === "scored").toBe(r.note !== null);
    }
  });
  it("every note is an integer in [0, 10]", () => {
    for (const r of STEVE30_SCORED) {
      expect(Number.isInteger(r.note)).toBe(true);
      expect(r.note as number).toBeGreaterThanOrEqual(0);
      expect(r.note as number).toBeLessThanOrEqual(10);
    }
  });
  it("has 16 scored rows including three 10/10 refontes", () => {
    expect(STEVE30_SCORED).toHaveLength(16);
    const tens = STEVE30_SCORED.filter((r) => r.note === 10).map((r) => r.city);
    expect(tens.sort()).toEqual([
      "Saint-Raphaël",
      "Saint-Stanislas-de-Kostka",
      "Sutton",
    ]);
  });
  it("the 9 'Signaux indisponibles' rows carry no note and no features", () => {
    const bug = STEVE30.filter((r) => r.status === "signal_unavailable");
    expect(bug).toHaveLength(9);
    for (const r of bug) {
      expect(r.note).toBeNull();
      for (const v of Object.values(r.features)) expect(v).toBeNull();
    }
  });
  it("non-residential rows are exactly the four noise cases", () => {
    const noise = STEVE30.filter(
      (r) => r.features.residentialRelevance === "non_residential",
    ).map((r) => r.id);
    expect(noise.sort()).toEqual([
      "mont-tremblant",
      "saint-charles-borromee",
      "saint-frederic",
      "stratford",
    ]);
  });
  it("every feature value stays inside its declared vocabulary", () => {
    const vocab: Record<keyof SteveFeatures, readonly (string | boolean)[]> = {
      residentialRelevance: ["residential", "non_residential"],
      changeNature: [
        "refonte_complete",
        "levee_rci",
        "densification_multi",
        "ppcmoi",
        "cptaq",
        "densification_mineure",
        "assouplissement",
        "petition",
        "non_residentiel",
      ],
      earliness: [
        "ordre_du_jour",
        "avis_de_motion",
        "projet",
        "consultation",
        "adopte",
        "en_vigueur",
      ],
      regulatoryExploitability: ["grille_et_lot", "grille_ou_zone", "zone_seule", "aucune"],
      landExploitability: ["lots_confirmes", "lots_candidats", "lots_manquants"],
      zonePrecedent: [true, false],
      ownerType: [
        "particulier",
        "ferme",
        "investisseur",
        "promoteur",
        "firme_immobiliere",
        "societe_portefeuille",
        "ville",
      ],
      projectScale: ["exploitable", "trop_massif", "sur_mesure_promoteur"],
      distanceMtl: ["proche", "eloigne"],
    };
    for (const r of STEVE30) {
      for (const key of Object.keys(vocab) as (keyof SteveFeatures)[]) {
        const val = r.features[key];
        if (val === null) continue;
        expect(vocab[key]).toContain(val);
      }
    }
  });
  it("every row cites at least one source §", () => {
    for (const r of STEVE30) expect(r.sources.length).toBeGreaterThan(0);
  });
});
