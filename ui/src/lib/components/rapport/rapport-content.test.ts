import { describe, expect, it } from "vitest";
import {
  RAPPORT_DATE,
  RAPPORT_MARKDOWN,
  SLIDES_HTML,
  extractReportDate,
  stripLocalImages,
} from "./rapport-content.js";

describe("rapport-content — transformation", () => {
  it("retire les images locales assets/ mais garde le texte", () => {
    const md = [
      "# Titre",
      "",
      "![légende de capture](assets/capture.png)",
      "",
      "*Légende conservée.*",
      "",
      "Un paragraphe.",
    ].join("\n");
    const out = stripLocalImages(md);
    expect(out).not.toContain("![");
    expect(out).toContain("*Légende conservée.*");
    expect(out).toContain("Un paragraphe.");
  });

  it("extrait la date d'édition de l'en-tête", () => {
    expect(extractReportDate("Titre\nDate : 2026-07-02\n")).toBe("2026-07-02");
    expect(extractReportDate("aucune date ici")).toBeNull();
  });
});

describe("rapport-content — contenu compilé (docs/spec/reports/study-2026-07)", () => {
  it("embarque le rapport réel, sans référence d'image locale", () => {
    expect(RAPPORT_MARKDOWN.length).toBeGreaterThan(10_000);
    expect(RAPPORT_MARKDOWN).toContain("Rapport d'étude — Radar Immobilier");
    expect(RAPPORT_MARKDOWN).not.toMatch(/!\[[^\]]*\]\(assets\//);
  });

  it("porte la date d'édition", () => {
    expect(RAPPORT_DATE).toBe("2026-07-02");
  });

  it("mène par les deux axes (30/1104 et 33 E2E/5000+)", () => {
    expect(RAPPORT_MARKDOWN).toContain("30 villes prioritaires");
    expect(RAPPORT_MARKDOWN).toContain("1104 municipalités cibles");
    expect(RAPPORT_MARKDOWN).toContain("33 opportunités témoins");
    expect(RAPPORT_MARKDOWN).toContain("plus de 5000");
  });

  it("porte les chiffres clés des livraisons", () => {
    for (const figure of [
      "978 / 1104", // signaux extraits v2.3
      "29 / 30", // zonage servi focus
      "~1102 / 1106", // lots servis province
      "56 / 70", // signaux à citation vérifiable
      "97,9 % des 15 510 lots", // grilles de normes — pilote Salaberry
      "645 zones", // zonage Salaberry
      "96,3 %", // correspondance règlement officiel
      "97,5 %", // exactitude dérivation 4+
      "3171 lots", // périmètre de mesure 4+
      "OAuth 2.1/PKCE", // connecteur MCP
    ]) {
      expect(RAPPORT_MARKDOWN).toContain(figure);
    }
  });

  it("reste client-facing (vocabulaire interne proscrit)", () => {
    // Jamais le nom du produit de référence ni le jargon interne.
    expect(RAPPORT_MARKDOWN).not.toMatch(/steve/i);
    expect(RAPPORT_MARKDOWN).not.toMatch(/open[ -]?source/i);
    expect(RAPPORT_MARKDOWN).not.toMatch(/honnête|honnêteté/i);
    expect(RAPPORT_MARKDOWN).not.toMatch(/survente|sur-vendre/i);
    // « à consolider » réservé à la section coûts (une seule occurrence).
    expect(RAPPORT_MARKDOWN.match(/à consolider/gi) ?? []).toHaveLength(1);
  });
});

describe("rapport-content — slides embarquées", () => {
  it("embarque le HTML autonome des slides", () => {
    expect(SLIDES_HTML).toContain("<title>Radar Immobilier — Rapport d'étude");
    expect(SLIDES_HTML).toContain("16 / 16");
  });

  it("reste cohérent avec le rapport (mêmes chiffres clés)", () => {
    for (const figure of ["978 / 1104", "97,9", "97,5", "59,2", "645 zones"]) {
      expect(RAPPORT_MARKDOWN).toContain(figure);
      expect(SLIDES_HTML).toContain(figure);
    }
  });

  it("reste client-facing (vocabulaire interne proscrit)", () => {
    expect(SLIDES_HTML).not.toMatch(/steve/i);
    expect(SLIDES_HTML).not.toMatch(/honnête|honnêteté/i);
    expect(SLIDES_HTML).not.toMatch(/survente|sur-vendre/i);
  });
});
