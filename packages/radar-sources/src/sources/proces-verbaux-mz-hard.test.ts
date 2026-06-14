/**
 * Lot « M-Z villes dures » -- villes ACTIVES M..Z (NFD) sans graph/<ville>/latest.json
 * sur SCW, câblées CONFIG-ONLY. URLs d'index PV vérifiées en live HTTP 200 le
 * 2026-06-14 (preuve + stratégie par ville : pv-cities-hard.json). La plupart
 * sont des SPA (Modellium vplus / VPlus Angular / B-CITI / Webflow) → scrape via
 * chemin navigateur/obscura ; quelques-unes statiques (massueville, metabetchouan,
 * mont-joli). « mayo » n'est PAS ici : déjà câblée par un lot antérieur.
 */
import { describe, expect, it } from "vitest";

import { ALL_PV_CITIES } from "./proces-verbaux-generic.js";

// 30 villes M-Z config-only ajoutées ce lot (les 7 irréductibles + mayo exclues).
const EXPECTED = [
  "marieville",
  "oka",
  "notre-dame-de-stanbridge",
  "massueville",
  "notre-dame-de-bonsecours",
  "namur",
  "papineauville",
  "montpellier",
  "notre-dame-du-laus",
  "notre-dame-de-pontmain",
  "milan",
  "quebec",
  "notre-dame-des-pins",
  "mansfield-et-pontefract",
  "notre-dame-auxiliatrice-de-buckland",
  "metabetchouan-lac-a-la-croix",
  "roberval",
  "peribonka",
  "pohenegamook",
  "portneuf-sur-mer",
  "mont-joli",
  "padoue",
  "rapide-danseur",
  "pointe-lebel",
  "matapedia",
  "ristigouche-sud-est",
  "pointe-a-la-croix",
  "maria",
  "new-richmond",
  "petite-vallee",
];

describe("Lot M-Z villes dures -- câblage config-only", () => {
  const bySlug = new Map(ALL_PV_CITIES.map((c) => [c.config.citySlug, c]));

  for (const slug of EXPECTED) {
    it(`${slug}: entrée config-only valide`, () => {
      const entry = bySlug.get(slug);
      expect(entry, `${slug} absent de ALL_PV_CITIES`).toBeDefined();
      if (!entry) return;
      expect(entry.config.sourceId).toBe(`proces-verbaux-${slug}`);
      expect(entry.config.pvIndexUrl).toMatch(/^https?:\/\/.+/);
      expect(entry.pvText).toBeUndefined();
    });
  }

  it("30 villes uniques", () => {
    expect(new Set(EXPECTED).size).toBe(30);
  });

  it("aucun doublon de citySlug dans le registre global", () => {
    const slugs = ALL_PV_CITIES.map((c) => c.config.citySlug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
