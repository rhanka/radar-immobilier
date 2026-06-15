/**
 * Tests unitaires de l'extracteur de références géographiques.
 *
 * Pas d'accès DB — fonctions pures uniquement.
 *
 * Cas testés :
 * - Texte vide / sans code -> tableau vide (anti-invention)
 * - Codes de zone : mention explicite, format standard, numérique pur
 * - Normalisation des codes (suffixe VLO, demi-cadratin, casse)
 * - Numéros de lot : mention explicite, compact, avec espaces
 * - Multi-codes dans un même texte
 * - Déduplication : même code normalisé, score maximal retenu
 * - Score et seuil de résolution
 */
import { describe, expect, it } from "vitest";
import {
  extractZoneCodes,
  extractLotRefs,
  extractRefsFromNode,
  normalizeZoneCode,
  normalizeLotRef,
  SCORE,
  RESOLUTION_THRESHOLD,
} from "./extract-refs.js";

// ─── normalizeZoneCode ────────────────────────────────────────────────────────

describe("normalizeZoneCode", () => {
  it("met en majuscules", () => {
    expect(normalizeZoneCode("h-431")).toBe("H-431");
  });

  it("supprime le suffixe (VLO)", () => {
    expect(normalizeZoneCode("H34-327 (VLO)")).toBe("H34-327");
  });

  it("supprime les espaces restants", () => {
    expect(normalizeZoneCode("H 34-327")).toBe("H34-327");
  });

  it("remplace le tiret demi-cadratin", () => {
    expect(normalizeZoneCode("H–431")).toBe("H-431");
  });

  it("code sans tiret reste inchangé (après majuscules)", () => {
    expect(normalizeZoneCode("A1336")).toBe("A1336");
  });
});

// ─── normalizeLotRef ──────────────────────────────────────────────────────────

describe("normalizeLotRef", () => {
  it("supprime les espaces dans le format cadastral", () => {
    expect(normalizeLotRef("6 057 912")).toBe("6057912");
  });

  it("laisse le compact intact", () => {
    expect(normalizeLotRef("6057912")).toBe("6057912");
  });

  it("supprime les caractères non-numériques", () => {
    expect(normalizeLotRef("6.057.912")).toBe("6057912");
  });
});

// ─── extractZoneCodes ─────────────────────────────────────────────────────────

describe("extractZoneCodes", () => {
  it("retourne [] pour un texte vide", () => {
    expect(extractZoneCodes("")).toEqual([]);
  });

  it("retourne [] si aucun code de zone", () => {
    const text = "Demande de permis de construction au 123 rue des Érables";
    expect(extractZoneCodes(text)).toEqual([]);
  });

  it("P1 — extrait une mention explicite 'zone H-431' avec score 0.85", () => {
    const text = "Modification de la zone H-431 dans le secteur nord";
    const results = extractZoneCodes(text);
    expect(results).toHaveLength(1);
    expect(results[0]!.codeNorm).toBe("H-431");
    expect(results[0]!.score).toBe(SCORE.ZONE_EXPLICIT);
    expect(results[0]!.patternId).toBe("zone_explicit");
  });

  it("P1 — extrait avec suffixe secteur (VLO)", () => {
    const text = "La zone H34-327 (VLO) est visée par ce règlement";
    const results = extractZoneCodes(text);
    const found = results.find((r) => r.codeNorm === "H34-327");
    expect(found).toBeDefined();
    expect(found!.score).toBe(SCORE.ZONE_EXPLICIT);
    expect(found!.rawText).toMatch(/H34-327/);
  });

  it("P2 — extrait un code standard H34-327 hors mention explicite", () => {
    const text = "Rezonage secteur H34-327, rezonage approuvé";
    const results = extractZoneCodes(text);
    const found = results.find((r) => r.codeNorm === "H34-327");
    expect(found).toBeDefined();
    expect(found!.score).toBe(SCORE.ZONE_STANDARD);
    expect(found!.patternId).toBe("zone_standard");
  });

  it("P3 — extrait un code numérique 'zone 1000' avec score 0.40", () => {
    const text = "Modification du règlement zone 1000";
    const results = extractZoneCodes(text);
    expect(results).toHaveLength(1);
    expect(results[0]!.codeNorm).toBe("1000");
    expect(results[0]!.score).toBe(SCORE.ZONE_NUMERIC);
    expect(results[0]!.patternId).toBe("zone_numeric");
  });

  it("P3 — code numérique en dessous du seuil de résolution", () => {
    const text = "zone 2000";
    const results = extractZoneCodes(text);
    expect(results[0]!.score).toBeLessThan(RESOLUTION_THRESHOLD);
  });

  it("déduplication — le même code trouvé par P1 et P2 retourne score max", () => {
    // "zone C-512" -> P1 (0.85) + P2 (0.65) -> doit garder 0.85
    const text = "Modification zone C-512 du règlement C-512 applicable";
    const results = extractZoneCodes(text);
    const found = results.filter((r) => r.codeNorm === "C-512");
    expect(found).toHaveLength(1);
    expect(found[0]!.score).toBe(SCORE.ZONE_EXPLICIT);
  });

  it("multi-codes — extrait plusieurs codes distincts", () => {
    const text = "Rezonage des zones H-431 et C-512 en zone résidentielle";
    const results = extractZoneCodes(text);
    const norms = results.map((r) => r.codeNorm);
    expect(norms).toContain("H-431");
    expect(norms).toContain("C-512");
  });

  it("tri par score décroissant", () => {
    const text = "zone H-431 et H34-327";
    const results = extractZoneCodes(text);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
    }
  });

  it("Sherbrooke style — A1336 extrait via P2 standard (pas de tiret)", () => {
    // Note : A1336 ne contient pas de tiret, P2 ne matche pas.
    // Ce cas est extrait uniquement si précédé de "zone ".
    const text = "zone A1336 modifiée par le règlement 2500";
    const results = extractZoneCodes(text);
    const found = results.find((r) => r.codeNorm === "A1336");
    expect(found).toBeDefined();
  });

  it("insensible à la casse", () => {
    const text = "ZONE h-431 résidentielle";
    const results = extractZoneCodes(text);
    expect(results.find((r) => r.codeNorm === "H-431")).toBeDefined();
  });
});

// ─── extractLotRefs ───────────────────────────────────────────────────────────

describe("extractLotRefs", () => {
  it("retourne [] pour un texte vide", () => {
    expect(extractLotRefs("")).toEqual([]);
  });

  it("retourne [] si aucun numéro de lot", () => {
    const text = "Modification du règlement de zonage, article 42, section 3";
    expect(extractLotRefs(text)).toEqual([]);
  });

  it("L1 — extrait 'lot 6 057 912' avec score 0.75", () => {
    const text = "Cette demande concerne le lot 6 057 912 situé dans la zone résidentielle";
    const results = extractLotRefs(text);
    const found = results.find((r) => r.noLotNorm === "6057912");
    expect(found).toBeDefined();
    expect(found!.score).toBe(SCORE.LOT_EXPLICIT);
    expect(found!.patternId).toBe("lot_explicit");
  });

  it("L1 — extrait 'lot 6057912' (sans espaces) avec score 0.75", () => {
    const text = "Rezonage du lot 6057912";
    const results = extractLotRefs(text);
    const found = results.find((r) => r.noLotNorm === "6057912");
    expect(found).toBeDefined();
    expect(found!.score).toBe(SCORE.LOT_EXPLICIT);
  });

  it("L2 — extrait compact 7+ chiffres avec score 0.45", () => {
    const text = "Dossier 4516943 transmis au service d'urbanisme";
    const results = extractLotRefs(text);
    const found = results.find((r) => r.noLotNorm === "4516943");
    expect(found).toBeDefined();
    expect(found!.score).toBe(SCORE.LOT_COMPACT);
  });

  it("L2 — 6 chiffres seulement : non capturé (trop court)", () => {
    const text = "article 123456 du règlement";
    const results = extractLotRefs(text);
    expect(results).toHaveLength(0);
  });

  it("déduplication — lot 6 057 912 via L1 + L2 -> score L1 retenu", () => {
    const text = "lot 6057912 cadastre: 6057912";
    const results = extractLotRefs(text);
    const found = results.filter((r) => r.noLotNorm === "6057912");
    expect(found).toHaveLength(1);
    expect(found[0]!.score).toBe(SCORE.LOT_EXPLICIT);
  });

  it("multi-lots — extrait plusieurs lots distincts", () => {
    const text = "Lots 6057912 et 4193751 visés par la demande";
    const results = extractLotRefs(text);
    const norms = results.map((r) => r.noLotNorm);
    expect(norms).toContain("6057912");
    expect(norms).toContain("4193751");
  });

  it("insensible à la casse de 'lot'", () => {
    const text = "LOT 6057912 en zone résidentielle";
    const results = extractLotRefs(text);
    expect(results.find((r) => r.noLotNorm === "6057912")).toBeDefined();
  });
});

// ─── extractRefsFromNode ──────────────────────────────────────────────────────

describe("extractRefsFromNode", () => {
  it("combine label et description sans duplication", () => {
    const label = "Rezonage zone H-431";
    const description = "La zone H-431 est modifiée pour permettre la densification";
    const result = extractRefsFromNode(label, description);
    const found = result.zoneCodes.filter((r) => r.codeNorm === "H-431");
    // Même si le code apparaît dans les deux champs, une seule entrée après dédup
    expect(found).toHaveLength(1);
    expect(found[0]!.score).toBe(SCORE.ZONE_EXPLICIT);
  });

  it("fonctionne sans description (undefined)", () => {
    const result = extractRefsFromNode("Demande lot 6057912");
    expect(result.lotRefs.find((r) => r.noLotNorm === "6057912")).toBeDefined();
  });

  it("fonctionne sans description (null)", () => {
    const result = extractRefsFromNode("zone H-431 approuvée", null);
    expect(result.zoneCodes.find((r) => r.codeNorm === "H-431")).toBeDefined();
  });

  it("texte sans aucune référence -> résultat vide honnête", () => {
    const result = extractRefsFromNode(
      "Adoption du budget municipal 2026",
      "Présentation du budget annuel de la ville",
    );
    expect(result.zoneCodes).toHaveLength(0);
    expect(result.lotRefs).toHaveLength(0);
  });

  it("cas mixte : zone + lot dans le même noeud", () => {
    const label = "Rezonage lot 6057912 zone H-431";
    const result = extractRefsFromNode(label);
    expect(result.zoneCodes.find((r) => r.codeNorm === "H-431")).toBeDefined();
    expect(result.lotRefs.find((r) => r.noLotNorm === "6057912")).toBeDefined();
  });
});
