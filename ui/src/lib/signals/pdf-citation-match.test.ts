/**
 * Tests du matcher citation → couche texte PDF (logique pure, offline).
 *
 * Objectif produit : surligner le passage cité (« extrait cité ») même quand la
 * bbox est absente, en retrouvant la citation verbatim dans le texte de la page,
 * robuste aux espaces, accents, ligatures et coupures pdftotext.
 */
import { describe, it, expect } from "vitest";
import { normalizeForMatch, findCitationInPage } from "./pdf-citation-match.js";

describe("normalizeForMatch", () => {
  it("met en minuscules, retire les accents et réduit les espaces", () => {
    expect(normalizeForMatch("  Le  Conseil   APPROUVE  ")).toBe("le conseil approuve");
    expect(normalizeForMatch("règlement numéro 2026-15")).toBe("reglement numero 2026-15");
  });

  it("décompose les ligatures œ/æ", () => {
    expect(normalizeForMatch("nœud cœur")).toBe("noeud coeur");
    expect(normalizeForMatch("et cætera")).toBe("et caetera");
  });

  it("normalise apostrophes et tirets typographiques", () => {
    expect(normalizeForMatch("l’unanimité")).toBe("l'unanimite");
    expect(normalizeForMatch("zone H‑431")).toBe("zone h-431");
  });
});

describe("findCitationInPage — match exact", () => {
  it("retrouve une citation présente verbatim et restitue l'intervalle brut", () => {
    const pageText =
      "Procès-verbal de la séance. Le conseil municipal approuve le règlement 2026-15. Fin.";
    const match = findCitationInPage(pageText, "Le conseil municipal approuve le règlement 2026-15");
    expect(match).not.toBeNull();
    expect(match!.coverage).toBe(1);
    const slice = pageText.slice(match!.start, match!.end);
    expect(slice.toLowerCase()).toContain("le conseil municipal approuve");
  });

  it("matche malgré les différences d'accents et d'espaces", () => {
    const pageText = "Attendu que la zone H-431 doit être modifiée selon les normes.";
    const match = findCitationInPage(pageText, "attendu  que  la  zone h-431 doit etre modifiee");
    expect(match).not.toBeNull();
    expect(match!.coverage).toBeGreaterThan(0.6);
  });

  it("matche une citation avec ligature face à un texte décomposé", () => {
    const pageText = "Le nœud du problème concerne le cœur du règlement.";
    const match = findCitationInPage(pageText, "le noeud du probleme concerne le coeur");
    expect(match).not.toBeNull();
  });
});

describe("findCitationInPage — fallback fenêtre de mots", () => {
  it("retrouve la plus longue séquence quand la citation a une tête/queue bruitée", () => {
    const pageText =
      "Le conseil adopte la résolution 2026-15 portant sur la densification résidentielle.";
    // La citation graphify ajoute du bruit en tête et en queue absent du PV.
    const match = findCitationInPage(
      pageText,
      "[bruit ocr] adopte la résolution 2026-15 portant sur la densification [suite manquante]",
    );
    expect(match).not.toBeNull();
    const slice = normalizeForMatch(pageText.slice(match!.start, match!.end));
    expect(slice).toContain("resolution 2026-15");
    expect(match!.coverage).toBeLessThan(1);
    expect(match!.coverage).toBeGreaterThan(0);
  });

  it("ne matche PAS sur une simple fenêtre de mots génériques (bug #83)", () => {
    // « attendu que la municipalite » est une amorce générique présente sur
    // PLUSIEURS pages d'un PV. Avec l'ancien `||` (windowLen >= 4 suffisait),
    // ces 4 mots déclenchaient un surlignage parasite hors page cible. La
    // citation réelle (suite) étant absente de cette page, on attend `null`.
    const pageText =
      "Attendu que la municipalité de Saint-Damase tient une séance ordinaire ce jour.";
    const match = findCitationInPage(
      pageText,
      "attendu que la municipalité adopte le règlement 2026-42 sur la densification résidentielle du secteur nord",
    );
    expect(match).toBeNull();
  });

  it("retourne null quand la citation n'apparaît pas du tout", () => {
    const pageText = "Texte sans rapport avec la citation recherchée ici.";
    const match = findCitationInPage(pageText, "le conseil municipal approuve le règlement 2026-15");
    expect(match).toBeNull();
  });

  it("retourne null pour une citation vide", () => {
    expect(findCitationInPage("du texte", "")).toBeNull();
    expect(findCitationInPage("du texte", "   ")).toBeNull();
  });

  it("retourne null pour un texte de page vide", () => {
    expect(findCitationInPage("", "une citation")).toBeNull();
  });
});
