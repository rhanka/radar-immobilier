import { describe, expect, it } from "vitest";
import {
  classifyLegacyZmpSignal,
  classifyVivierSignal,
  computeLegacySubsetCounts,
  computeVivierV2,
  extractLegacyZmpInput,
  type VivierSignalInput,
} from "./vivier-v2.js";
import { classifyResidentielPertinence } from "./graph-store.js";
import { classifyBPrime } from "@radar/domain";
import { PV_BELOEIL_2026_02_TEXT } from "@radar/sources";

const signal = (overrides: Partial<VivierSignalInput> = {}): VivierSignalInput => ({
  id: "signal-1",
  type: "Signal",
  category: "ppcmoi",
  label: "PPCMOI résidentiel",
  description: "Consultation publique",
  etape: "consultation_publique",
  ...overrides,
});

describe("RESIDENTIEL_MARKERS_RE twins — byte-identical across API, domain, UI", () => {
  it("graph-store and b-prime RESIDENTIAL regex produce the same results on plural terms", () => {
    const terms = [
      "logements", "habitations", "multilogements", "multi-logements",
      "condominiums", "maisons de chambres", "immeubles residentiels",
      "immeubles locatifs", "usages mixtes", "densifications",
    ];
    for (const term of terms) {
      const apiResult = classifyResidentielPertinence(null, term, null);
      expect(apiResult, `API must match residential for: ${term}`).toBe("residentiel");
    }
  });
});

describe("GUARD — axis r MUST NOT branch on completeReform (C1 kills recall: 170→91, Sutton LOST)", () => {
  it("a refonte with no residential marker stays indeterminate on axis r", () => {
    expect(classifyResidentielPertinence(
      null,
      "Refonte réglementaire complète — nouveau zonage",
      "Adoption 1ers projets de règlement 358 (zonage), 362 (PPCMOI).",
    )).toBe("indetermine");
  });

  it("Sutton verbatim: refonte réglementaire is NOT promoted to residentiel by axis r", () => {
    expect(classifyResidentielPertinence(
      null,
      "Signal : refonte réglementaire complète Sutton — nouveau zonage et lotissement (2026)",
      "Refonte totale du zonage (règlement 358)",
    )).toBe("indetermine");
  });

  it("a refonte with a non-residential marker is still non_residentiel on axis r", () => {
    expect(classifyResidentielPertinence(
      null,
      "Refonte industrielle complète",
      "Refonte du parc industriel",
    )).toBe("non_residentiel");
  });

  it("Rosemère stays OUT of B: the real PV pôle régional has no residential marker", () => {
    const classification = classifyVivierSignal({
      id: "rosemere-801-71",
      type: "DesignationEvent",
      category: null,
      label: "801-71 - Règlement modifiant le Règlement de zonage 801 afin d'assurer la conformité au Règlement 24-02 de la MRC de Thérèse-De Blainville et aux Règlements 800-06 et 800-08 de la Ville de Rosemère relatifs au pôle régional - Règlement de concordance - Avis de motion",
      description: "Avis de motion : règlement de concordance assurant la conformité au règlement 24-02 de la MRC relatif au pôle régional.",
      etape: "avis_motion",
    });
    expect(classification.residentiel.valeur).toBe("indetermine");
    expect(classification.exclusion_reason).toBeNull();
  });
});

describe("instrumentFromSignal — regulatory refonte tested BEFORE ppcmoi", () => {
  it("Sutton refonte event: description mentions PPCMOI but label says refonte → instrument=refonte", () => {
    const classification = classifyVivierSignal({
      id: "event-sutton-refonte-reglementaire-2026-05-27",
      type: "DesignationEvent",
      category: null,
      label: "Refonte réglementaire complète — Sutton (séance extraordinaire 27 mai 2026)",
      description: "Adoption 1ers projets règlements 358 (zonage), 359 (lotissement), 360 (construction), 361 (permis et certificats), 362 (PPCMOI), 363 (permis). Consultation publique 25 juin 2026.",
      etape: "projet_reglement",
    });
    expect(classification.instrument).toBe("refonte");
  });

  it("Terrasse-Vaudreuil PIIA: architectural refonte remains a PIIA", () => {
    const classification = classifyVivierSignal({
      id: "signal-terrasse-vaudreuil-piia-43-5e-avenue",
      type: "Signal",
      category: "piia",
      label: "PIIA — rénovation majeure et refonte architecturale",
      description: null,
      etape: "avis_motion",
    });
    expect(classification).toMatchObject({ instrument: "piia", etape: "inconnu" });
  });

  it("a pure PPCMOI without refonte still gets instrument=ppcmoi", () => {
    const classification = classifyVivierSignal({
      id: "ppcmoi-pure",
      type: "Signal",
      category: "ppcmoi",
      label: "PPCMOI — 12 logements",
      description: "Projet particulier de construction",
      etape: "avis_motion",
    });
    expect(classification.instrument).toBe("ppcmoi");
  });

  it("classifies the real Amos plan d'urbanisme mention after apostrophe folding", () => {
    const classification = classifyVivierSignal({
      id: "amos-va1-81-plan-urbanisme",
      type: "Signal",
      category: null,
      label: "Modification zonage parc industriel J.-E.-Therrien — Adoption VA1-81 (plan d'urbanisme) et VA1-82 (zonage)",
      description: null,
      etape: "adoption",
    });
    expect(classification.instrument).toBe("plan_urbanisme");
  });
});

describe("typographic apostrophe normalization", () => {
  it("keeps B-prime and the Vivier server in agreement for a conversion", () => {
    const label = "Changement d’usage — local commercial vers usage résidentiel";
    const bPrime = classifyBPrime({ label });
    const vivier = classifyVivierSignal(signal({
      id: "apostrophe-commercial-to-residential",
      category: "rezonage",
      label,
      description: null,
      etape: "avis_motion",
    }));

    expect(bPrime).toMatchObject({ residentiel: "oui", exclusionReason: null });
    expect(vivier).toMatchObject({
      residentiel: { valeur: "oui" },
      exclusion_reason: null,
    });
  });
});

describe("server vivier_v2 computation", () => {
  it("reads legacy fields only from props.properties", () => {
    const input = extractLegacyZmpInput({
      id: "strict",
      type: "Signal",
      label: "Adoption ordinaire",
      props: {
        category: "rezonage",
        etape: "projet_reglement",
        intensite: "haute",
        refs: [{ category: "rezonage", etape: "avis_motion", nb_unites_max: "12" }],
        properties: { category: "vente_terrain", etape: "adoption" },
      },
      sourceRef: null,
    });

    expect(input).toMatchObject({
      category: "vente_terrain",
      etape: "adoption",
      nbUnitesMax: null,
      intensite: null,
    });
    expect(classifyLegacyZmpSignal(input).flags).toEqual({ z: false, m: false, p: false });
  });

  it("reproduces JSONB text extraction for legacy scalar values", () => {
    const input = extractLegacyZmpInput({
      id: "scalar-values",
      type: "Signal",
      props: {
        properties: {
          category: " ppcmoi ",
          description: false,
          etape: "projet_reglement",
          nb_unites_max: 12,
          intensite: null,
        },
      },
    });

    expect(input).toMatchObject({
      category: " ppcmoi ",
      description: "false",
      etape: "projet_reglement",
      nbUnitesMax: "12",
      intensite: null,
    });
  });
  it("classifies Sutton legacy memberships once for counts and detail IDs", () => {
    const suton = [
      signal({ id: "sutton-a", category: "rezonage", etape: "avis_motion", nbUnitesMax: "8" }),
      signal({ id: "sutton-t", category: "rezonage", etape: "avis_motion", nbUnitesMax: "2" }),
      signal({ id: "sutton-z", category: "rezonage", etape: "adoption", nbUnitesMax: "2" }),
      signal({ id: "sutton-m", category: "vente_terrain", etape: "adoption", nbUnitesMax: "8" }),
      signal({ id: "sutton-raw", category: "vente_terrain", etape: "adoption", nbUnitesMax: "2" }),
    ];

    const memberships = suton.map(classifyLegacyZmpSignal);
    const counts = computeLegacySubsetCounts(suton);

    expect(memberships.filter((item) => item.flags.z && item.flags.m && item.flags.p).map((item) => item.signalId)).toEqual(["sutton-a"]);
    expect(memberships.filter((item) => item.flags.z && item.flags.p).map((item) => item.signalId)).toEqual(["sutton-a", "sutton-t"]);
    expect(counts[""]).toBe(5);
    expect(counts["z|m|p"]).toBe(1);
    expect(counts["z|p"]).toBe(2);
    expect(memberships.every((item) => item.version === "legacy-zmp-v1")).toBe(true);
  });

  it("uses the graph-store zonage helper and keeps missing evidence indeterminate", () => {
    const etapeFallback = classifyVivierSignal(
      signal({ category: null, etape: "rezonage", label: "Avis de motion" }),
    );
    expect(etapeFallback.zonage.valeur).toBe("oui");

    const missing = classifyVivierSignal(
      signal({ category: null, etape: null, label: "Avis de motion", description: null }),
    );
    expect(missing.zonage.valeur).toBe("indetermine");
    expect(missing.residentiel.valeur).toBe("indetermine");
    expect(missing.effet_densifiant).toBe("inconnu");
    expect(missing.etape).toBe("avis_motion");
  });

  it("keeps instrument separate from stage and assigns the requested exclusions", () => {
    const ppcmoi = classifyVivierSignal(
      signal({
        category: "ppcmoi",
        label: "Avis de motion PPCMOI résidentiel",
        description: "Second projet de règlement",
        etape: null,
        props: { properties: { etapes_historique: ["avis_motion", "second_projet"] } },
      }),
    );
    expect(ppcmoi.instrument).toBe("ppcmoi");
    expect(ppcmoi.etape).toBe("second_projet");
    expect(ppcmoi.etapes_historique).toEqual(["avis_motion", "second_projet"]);

    const piia = classifyVivierSignal(
      signal({ category: "piia", label: "PIIA centre commercial", description: null }),
    );
    expect(piia.instrument).toBe("piia");
    expect(piia.exclusion_reason).toBe("piia_non_pertinent");

    const derogation = classifyVivierSignal(
      signal({ category: "derogation", label: "Dérogation agricole", description: null }),
    );
    expect(derogation.instrument).toBe("derogation");
    expect(derogation.exclusion_reason).toBe("derogation_hors_sujet");
  });

  it("routes B-prime commercial-regional exclusions through B without changing A", () => {
    const regionalPole = signal({
      id: "regional-pole",
      category: "rezonage",
      label: "Pôle commercial régional — projet résidentiel",
      etape: "avis_motion",
      nbUnitesMax: "8",
      props: { extrait: "Pôle commercial régional", source_ref: "pv-42" },
    });

    const classification = classifyVivierSignal(regionalPole);
    const counts = computeVivierV2([regionalPole]).counts;

    // B′ must remove the regional commercial pole from B's qualification.
    expect(classification.residentiel.valeur).toBe("non");
    expect(classification.exclusion_reason).toBe("non_residentiel_franc");
    expect(counts).toMatchObject({
      qualified: 0,
      excludedByReason: { non_residentiel_franc: 1 },
      total: 1,
    });
    // The legacy A predicate is intentionally independent of B′.
    expect(classifyLegacyZmpSignal(regionalPole).flags).toEqual({ z: true, m: true, p: true });
  });

  it("uses resolved R3 evidence and excludes the real Beloeil 1667-128 Commerce signal", () => {
    const conversion = classifyVivierSignal(signal({
      category: "rezonage",
      label: "Conversion d'un bâtiment commercial à usage résidentiel",
      description: null,
      etape: "avis_motion",
    }));
    expect(conversion.residentiel.valeur).toBe("oui");
    expect(conversion.exclusion_reason).toBeNull();

    const resolvedReference = classifyVivierSignal(signal({
      category: null,
      label: null,
      description: null,
      etape: "avis_motion",
      props: {
        refs: [{
          category: "rezonage",
          description: "Transformation d'un commerce en usage résidentiel",
        }],
      },
    }));
    expect(resolvedReference.residentiel.valeur).toBe("oui");
    expect(resolvedReference.exclusion_reason).toBeNull();

    const provenanceOnly = classifyVivierSignal(signal({
      category: "rezonage",
      label: "Densification commerciale du secteur",
      description: null,
      etape: "avis_motion",
      props: { extrait: "Conversion d'un bâtiment commercial à usage résidentiel" },
    }));
    expect(provenanceOnly.residentiel.valeur).toBe("non");
    expect(provenanceOnly.exclusion_reason).toBe("non_residentiel_franc");

    const start = PV_BELOEIL_2026_02_TEXT.indexOf("2026-02-92");
    const end = PV_BELOEIL_2026_02_TEXT.indexOf("2026-02-93", start);
    const beloeil1667128 = PV_BELOEIL_2026_02_TEXT.slice(start, end);
    expect(beloeil1667128).toContain("1667-128-2026");
    expect(beloeil1667128).toContain("COMMERCE");

    const beloeilCommercial = classifyVivierSignal(signal({
      id: "beloeil-1667-128",
      category: "rezonage",
      label: beloeil1667128,
      description: null,
      etape: "avis_motion",
    }));
    expect(beloeilCommercial.residentiel.valeur).toBe("non");
    expect(beloeilCommercial.exclusion_reason).toBe("non_residentiel_franc");
  });

  it("computes v2 and legacy z|m|p counts from the same input", () => {
    const signals = [
      signal({ id: "qualified", category: "ppcmoi", nbUnitesMax: "8" }),
      signal({
        id: "unknown",
        category: null,
        etape: "consultation_publique",
        label: "Avis de motion",
        description: null,
      }),
      signal({ id: "non-zoning", category: "vente_terrain", etape: null, label: "Projet résidentiel" }),
    ];
    const v2 = computeVivierV2(signals);
    const legacy = computeLegacySubsetCounts(signals);

    expect(v2.classifications).toHaveLength(signals.length);
    expect(v2.counts.total).toBe(signals.length);
    expect(v2.counts.qualified).toBe(1);
    expect(v2.counts.residentialUnknown).toBe(1);
    expect(v2.counts.excludedByReason.hors_zonage).toBe(1);
    expect(v2.classifications[1]?.classification.zonage.valeur).toBe("indetermine");
    expect(v2.classifications[1]?.classification.exclusion_reason).toBeNull();
    expect(v2.classifications[2]?.classification.zonage.valeur).toBe("non");
    expect(legacy[""]).toBe(3);
    expect(legacy.z).toBe(1);
    expect(legacy["z|m|p"]).toBe(0);
  });
});
