/**
 * Lot cities-round11 -- 28 villes CONFIG-ONLY (S3-first).
 * URLs d'index verifiees en live HTTP 200 le 2026-06-11 ; preuve par ville en PR.
 */
import { describe, expect, it } from "vitest";
import { ALL_PV_CITIES } from "./proces-verbaux-generic.js";
const EXPECTED = ["saint-damase-de-lislet", "sainte-louise", "saint-francois-de-sales", "les-eboulements", "sainte-hedwidge", "saint-hilarion", "saint-andre-du-lac-saint-jean", "la-pocatiere", "chambord", "hebertville", "riviere-ouelle", "saint-pacome", "clermont--charlevoix-est", "saint-philippe-de-neri", "mont-carmel", "ferland-et-boilleau", "kamouraska", "larouche", "saint-charles-de-bourget", "saint-andre-de-kamouraska", "saint-simeon--charlevoix-est", "begin", "petit-saguenay", "riviere-bleue", "saint-marc-du-lac-long", "val-dor", "tadoussac", "saint-epiphane"];
describe("Lot cities-round11 -- cablage config-only", () => {
  const bySlug = new Map(ALL_PV_CITIES.map((c) => [c.config.citySlug, c]));
  for (const slug of EXPECTED) {
    it(`${slug}: entree config-only valide`, () => {
      const entry = bySlug.get(slug);
      expect(entry, `${slug} absent`).toBeDefined();
      if (!entry) return;
      expect(entry.config.sourceId).toBe(`proces-verbaux-${slug}`);
      expect(entry.config.pvIndexUrl).toMatch(/^https?:\/\/.+/);
      expect(entry.pvText).toBeUndefined();
    });
  }
  it("28 villes uniques", () => { expect(new Set(EXPECTED).size).toBe(28); });
});
