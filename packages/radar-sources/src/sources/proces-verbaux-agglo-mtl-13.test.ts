/**
 * Lot cities-round13 -- 34 villes CONFIG-ONLY (S3-first).
 * URLs d'index verifiees en live HTTP 200 le 2026-06-11 ; preuve par ville en PR.
 */
import { describe, expect, it } from "vitest";
import { ALL_PV_CITIES } from "./proces-verbaux-generic.js";
const EXPECTED = ["matagami", "sayabec", "la-sarre", "albertville", "amqui", "saint-ulric", "sainte-paule", "causapscal", "baie-comeau", "normetal", "matane", "saint-rene-de-matane", "sainte-felicite--la-matanie", "saint-jean-de-cherbourg", "grosses-roches", "nouvelle", "carleton-sur-mer", "cap-chat", "caplan", "sainte-anne-des-monts", "saint-alphonse", "bonaventure", "port-cartier", "saint-elzear--bonaventure", "new-carlisle", "la-martre", "paspebiac", "marsoui", "hope", "riviere-a-claude", "mont-saint-pierre", "murdochville", "grande-vallee", "grande-riviere"];
describe("Lot cities-round13 -- cablage config-only", () => {
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
  it("34 villes uniques", () => { expect(new Set(EXPECTED).size).toBe(34); });
});
