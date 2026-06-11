/**
 * Lot cities-round12 -- 44 villes CONFIG-ONLY (S3-first).
 * URLs d'index verifiees en live HTTP 200 le 2026-06-11 ; preuve par ville en PR.
 */
import { describe, expect, it } from "vitest";
import { ALL_PV_CITIES } from "./proces-verbaux-generic.js";
const EXPECTED = ["saint-eusebe", "senneterre--la-vallee-de-lor", "packington", "les-bergeronnes", "saint-eloi", "temiscaming", "notre-dame-des-neiges", "degelis", "barraute", "la-corne", "saint-simon-de-rimouski", "lejeune", "riviere-heva", "latulipe-et-gaboury", "bearn", "saint-fabien", "saint-marc-de-figuery", "saint-eugene-de-ladriere", "esprit-saint", "saint-mathieu-dharricana", "amos", "remigny", "preissac", "saint-valerien", "saint-narcisse-de-rimouski", "ville-marie", "forestville", "rimouski", "rouyn-noranda", "trecesson", "saint-bruno-de-guigues", "nedelec", "saint-anaclet-de-lessard", "launay", "colombier", "berry", "saint-gabriel-de-rimouski", "les-hauteurs", "saint-donat--la-mitis", "saint-charles-garnier", "taschereau", "saint-joseph-de-lepage", "mont-joli", "authier"];
describe("Lot cities-round12 -- cablage config-only", () => {
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
  it("44 villes uniques", () => { expect(new Set(EXPECTED).size).toBe(44); });
});
