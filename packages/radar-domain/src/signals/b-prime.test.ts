import { describe, expect, it } from "vitest";
import { classifyBPrime, FRANC_NON_RESIDENTIEL_RE } from "./b-prime.js";

/** Normalise comme le classifieur (minuscule + sans accents). */
const fold = (s: string): string => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

describe("classifyBPrime", () => {
  it("uses an explicit stage annotation before text and audits an invalid annotation", () => {
    expect(classifyBPrime({ etapeAnnotation: "avis_motion", label: "Adoption" }))
      .toMatchObject({ etape: "avis_motion", etapeAnnotation: { raw: "avis_motion", valid: true } });
    expect(classifyBPrime({ etapeAnnotation: "instrument: refonte", label: "Avis de motion" }))
      .toMatchObject({ etape: "inconnu", etapeAnnotation: { raw: "instrument: refonte", valid: false } });
    expect(classifyBPrime({ etapeAnnotation: "", label: "Avis de motion" }))
      .toMatchObject({ etape: "inconnu", etapeAnnotation: { raw: "", valid: false } });
    expect(classifyBPrime({ etapeAnnotation: "consultation_publique" }))
      .toMatchObject({ etape: "consultation", etapeAnnotation: { raw: "consultation_publique", valid: true } });
  });

  it("keeps complete reforms unknown and excludes commercial or regional-pole signals", () => {
    expect(classifyBPrime({ label: "Révision complète du règlement résidentiel" }))
      .toMatchObject({ residentiel: "indetermine", exclusionReason: null, effetDensifiant: "inconnu" });
    expect(classifyBPrime({ category: " REFONTE " })).toMatchObject({ residentiel: "indetermine" });
    expect(classifyBPrime({ label: "Densification du parc industriel" }))
      .toMatchObject({ residentiel: "non", exclusionReason: "non_residentiel_franc" });
    expect(classifyBPrime({ category: " Commercial " })).toMatchObject({ residentiel: "non" });
    expect(classifyBPrime({
      label: "Pôle commercial régional — projet résidentiel",
      props: { extrait: "Pôle commercial régional", source_ref: "pv-42" },
    })).toMatchObject({
      exclusionReason: "pole_commercial_regional",
      provenance: { extrait: "Pôle commercial régional", source: "pv-42" },
    });
  });

  it("R3 — durcissement lexical : pluriel « commerciaux » et variantes enseigne/affichage exclus", () => {
    // Contre-exemple RÉEL (packages/radar-sources/.../proces-verbaux-lavaltrie.fixture.ts) :
    // « Règlement de zonage … aux fins d'autoriser certains usages commerciaux
    // … dans les zones C 8 et C 168 ». Le pluriel -aux échappait au regex → il
    // entrait à tort dans B. Il doit désormais être franc-non-résidentiel.
    expect(classifyBPrime({
      label: "Règlement de zonage — autoriser certains usages commerciaux zone C-8",
      description: "Modification du zonage aux fins d'autoriser certains usages commerciaux.",
      etapeAnnotation: "second_projet",
    })).toMatchObject({ residentiel: "non", exclusionReason: "non_residentiel_franc" });

    for (const label of [
      "Nouvelle grille commerciale zone C-8",
      "Zones commerciales et de services",
      "Règlement sur les enseignes commerciales",
      "Modification des normes d'affichage",
      "Panneau-réclame en bordure d'autoroute",
    ]) {
      const c = classifyBPrime({ label });
      expect(c.residentiel, `attendu non-résidentiel: ${label}`).toBe("non");
      expect(c.exclusionReason, `attendu exclusion: ${label}`).toBe("non_residentiel_franc");
    }
  });

  it("R3 — la preuve résidentielle FORTE l'emporte sur le franc-non-résidentiel", () => {
    // « de commercial à résidentiel, 12 logements » : commercial PRÉSENT mais
    // preuve forte (logements) → reste dans B (residentiel oui, pas d'exclusion).
    expect(classifyBPrime({
      label: "Rezonage de commercial à résidentiel — 12 logements",
      description: "Conversion d'un bâtiment commercial en immeuble à logements de 12 unités.",
      etapeAnnotation: "projet_reglement",
    })).toMatchObject({ residentiel: "oui", exclusionReason: null });
    // Usage réellement mixte avec du logement : gardé (opportunité).
    expect(classifyBPrime({ label: "Zone d'usage mixte commercial et habitation" }))
      .toMatchObject({ residentiel: "oui", exclusionReason: null });
    // Preuve FAIBLE seule (« densification commerciale ») NE sauve PAS : exclu.
    expect(classifyBPrime({ label: "Densification commerciale du secteur" }))
      .toMatchObject({ residentiel: "non", exclusionReason: "non_residentiel_franc" });
    // Franc commercial sans aucun logement (Lavaltrie C-8) : exclu.
    expect(classifyBPrime({ label: "Autoriser certains usages commerciaux zone C-8" }))
      .toMatchObject({ residentiel: "non", exclusionReason: "non_residentiel_franc" });
  });

  it("R3 — le regex partagé matche toute la famille commercial/industriel", () => {
    for (const word of [
      "commercial", "commerciale", "commerciales", "commerciaux",
      "industriel", "industriels", "industrielle", "industrielles",
      "enseigne", "enseignes", "affichage", "affichages", "panneau-reclame",
    ]) {
      expect(FRANC_NON_RESIDENTIEL_RE.test(fold(word)), `doit matcher: ${word}`).toBe(true);
    }
    // Faux amis à NE PAS exclure (pas de sur-blocage).
    for (const word of ["residentiel", "logement", "habitation", "densification", "lotissement"]) {
      expect(FRANC_NON_RESIDENTIEL_RE.test(fold(word)), `ne doit PAS matcher: ${word}`).toBe(false);
    }
  });
});
