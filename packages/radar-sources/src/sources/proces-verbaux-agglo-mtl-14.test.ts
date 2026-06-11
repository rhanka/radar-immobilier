/**
 * Lot cities-round14 -- 26 villes CONFIG-ONLY (S3-first).
 * URLs d'index verifiees en live HTTP 200 le 2026-06-11 ; preuve par ville en PR.
 */
import { describe, expect, it } from "vitest";
import { ALL_PV_CITIES } from "./proces-verbaux-generic.js";
const EXPECTED = ["la-redemption", "grand-metis", "sainte-germaine-boule", "metis-sur-mer", "saint-moise", "authier-nord", "saint-zenon-du-lac-humqui", "macamic", "lascension-de-patapedia", "palmarolle", "saint-cleophas", "saint-noel", "gallichan", "saint-leon-le-grand--la-matapedia", "saint-damase--la-matapedia", "sainte-therese-de-gaspe", "sept-iles", "gaspe", "riviere-au-tonnerre", "riviere-saint-jean", "lile-danticosti", "les-iles-de-la-madeleine", "havre-saint-pierre", "fermont", "aguanish", "natashquan"];
describe("Lot cities-round14 -- cablage config-only", () => {
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
  it("26 villes uniques", () => { expect(new Set(EXPECTED).size).toBe(26); });
});
