import { describe, expect, it } from "vitest";
import {
  classifyLegacyZmpSignal,
  classifyVivierSignal,
  computeLegacySubsetCounts,
  computeVivierV2,
  extractLegacyZmpInput,
  instrumentFromSignal,
  isRegulatoryReform,
  type VivierSignalInput,
} from "./vivier-v2.js";
import { isResidentialEligible } from "@radar/domain";
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

describe("instrument lexicon — refonte is a bounded positive list, read per occurrence", () => {
  const instrumentOf = (label: string, description: string | null = null, category: string | null = null) =>
    instrumentFromSignal(category, label, description, null);

  // Défaut 1 — une occurrence non réglementaire ne doit JAMAIS masquer une
  // occurrence réglementaire présente ailleurs dans le même texte.
  //
  // Cas SYNTHÉTIQUE, déclaré comme tel : aucun nœud de cette forme n'existe
  // dans les 7 221 nœuds de production. Il éprouve la lecture PAR OCCURRENCE,
  // pas un phrasé observé. La catégorie structurée est volontairement ABSENTE :
  // quand elle est renseignée (`category="piia"`) elle FAIT AUTORITÉ et
  // l'emporte sur toute heuristique de texte libre — cf. le test
  // « an explicit category outranks the free-text heuristics ».
  it("keeps a regulatory refonte even when a non-regulatory « refonte » comes first", () => {
    expect(
      instrumentFromSignal(
        null,
        "PIIA — refonte architecturale",
        "Refonte complète du règlement de zonage",
        null,
      ),
    ).toBe("refonte");

    const classification = classifyVivierSignal({
      id: "mixed-refonte",
      type: "DesignationEvent",
      label: "PIIA — refonte architecturale",
      description: "Refonte complète du règlement de zonage",
      etape: "projet_reglement",
    });
    expect(classification.instrument).toBe("refonte");
    // La VRAIE porte de l'axe résidentiel est `isResidentialEligible`
    // (`packages/radar-domain/src/vivier/counts.ts`), PAS `exclusion_reason` :
    // `piia_non_pertinent` exige `residentiel.valeur === "non"` et ne se
    // déclenche donc jamais ici. Sans objet résidentiel explicite le résidentiel
    // reste `indetermine` et SEUL l'instrument décide de la sortie du vivier.
    expect(classification.residentiel.valeur).toBe("indetermine");
    expect(classification.exclusion_reason).toBeNull();
    expect(isResidentialEligible(classification)).toBe(true);
    expect(isResidentialEligible({ ...classification, instrument: "piia" })).toBe(false);
  });

  // Sutton. Le libellé et la description viennent de la fixture réelle
  // `sutton-legacy.fixture.ts` — SAUF « , dont le 362 (PPCMOI). », qui est une
  // SONDE SYNTHÉTIQUE ajoutée ici : la fixture porte « Adoption des premiers
  // projets de règlements 358 à 363. », sans mention de PPCMOI. La sonde éprouve
  // l'ordre `refonte` avant `ppcmoi` DANS le bloc heuristique (aucune catégorie
  // structurée n'est fournie). Le basculement `ppcmoi → refonte` de Sutton est,
  // lui, mesuré sur la base de production, pas sur cette fixture.
  it("keeps the Sutton refonte ahead of a PPCMOI mentioned in the same PV", () => {
    expect(
      instrumentOf(
        "Refonte réglementaire complète — Sutton (séance extraordinaire 27 mai 2026)",
        "Adoption des premiers projets de règlements 358 à 363, dont le 362 (PPCMOI).",
      ),
    ).toBe("refonte");
    expect(
      instrumentOf(
        "Signal : refonte totale Sutton",
        "Refonte totale du zonage et du lotissement. Le 362 (PPCMOI) est adopté séparément.",
      ),
    ).toBe("refonte");
  });

  // Défaut 2 — « refonte » hors urbanisme n'entre pas dans le vivier.
  it.each([
    "Refonte du site Web municipal",
    "Refonte du site internet de la Ville",
    "Refonte organisationnelle",
    "Refonte des infrastructures",
    "Refonte de la grille tarifaire",
    "Refonte architecturale",
    "Refontes architecturales",
    "Refonte des services souterrains",
    "Refonte du service souterrain",
    "Refonte totale du site Web municipal",
  ])("does not read %s as an urbanism refonte", (label) => {
    expect(instrumentOf(label)).toBe("autre");
    expect(isRegulatoryReform(label.toLowerCase())).toBe(false);
  });

  // Recall — les formes réglementaires bornées, dont celles que l'adjacence
  // stricte « refonte complete » ratait (Sutton).
  it.each([
    "Refonte réglementaire complète",
    "Refonte totale",
    "Refonte du règlement de zonage",
    "Refonte de la réglementation d'urbanisme",
    "Refonte du plan d'urbanisme",
    "Refonte des règlements de lotissement",
  ])("reads %s as a refonte", (label) => {
    expect(instrumentOf(label)).toBe("refonte");
  });

  // Piège vérifié : une classe d'apostrophes saisie visuellement peut contenir
  // deux fois la même apostrophe. Les deux codepoints sont testés en
  // échappement explicite, jamais au rendu.
  it("matches both apostrophe codepoints, asserted by escape not by glyph", () => {
    const ASCII_APOSTROPHE = "'";
    const TYPOGRAPHIC_APOSTROPHE = "’";
    expect(ASCII_APOSTROPHE).not.toBe(TYPOGRAPHIC_APOSTROPHE);
    expect(ASCII_APOSTROPHE.codePointAt(0)).toBe(0x27);
    expect(TYPOGRAPHIC_APOSTROPHE.codePointAt(0)).toBe(0x2019);

    for (const apostrophe of [ASCII_APOSTROPHE, TYPOGRAPHIC_APOSTROPHE]) {
      expect(isRegulatoryReform(`refonte du plan d${apostrophe}urbanisme`)).toBe(true);
      expect(isRegulatoryReform(`refonte de la reglementation d${apostrophe}urbanisme`)).toBe(true);
      expect(isRegulatoryReform(`refonte de l${apostrophe}urbanisme`)).toBe(true);
    }
  });
});

describe("instrument lexicon — recall on real production phrasings, bounded to urbanism", () => {
  const instrumentOf = (label: string, description: string | null = null, category: string | null = null) =>
    instrumentFromSignal(category, label, description, null);

  // Les trois DesignationEvent de PRODUCTION que la liste positive faisait
  // SORTIR du vivier (revue adverse sur les 7 221 nœuds, 724 villes). Un signal
  // qui sort est plus grave qu'un signal qui n'entre pas : le propriétaire
  // l'avait sous les yeux, il disparaît de son panneau.
  it.each([
    [
      "event-chibougamau-520-05",
      "Refonte des plans et règlement d'urbanisme",
    ],
    [
      "event-hatley-refonte-urbanisme-sadd-2026",
      "Refonte complète outils planification/réglementation d'urbanisme",
    ],
    [
      "event-saint-jean-de-matha-zonage-604-adoption-2026-01-14",
      "Adoption règlement de zonage 604 — refonte plan et règlements d'urbanisme",
    ],
  ])("keeps the production refonte %s in the vivier", (_id, label) => {
    expect(instrumentOf(label)).toBe("refonte");
  });

  // Rappel LATENT : trois nœuds de production formulés « cadre réglementaire »
  // ne survivaient que parce que `rezonage` gagnait avant dans leur texte. La
  // prochaine ville formulée ainsi sans « rezonage » tombait silencieusement en
  // `autre` — `reglements?\b` ne matche pas « réglementaire ».
  it.each([
    "Refonte du cadre réglementaire d'urbanisme", // hudson, saint-étienne-de-bolton
    "Refonte cadre réglementaire complet", // val-des-bois
  ])("reads %s as a refonte without relying on « rezonage »", (label) => {
    expect(instrumentOf(label)).toBe("refonte");
  });

  // BORNE D'URBANISME. Un règlement municipal quelconque n'est pas une refonte
  // d'urbanisme : l'objet doit être qualifié (zonage, lotissement, urbanisme,
  // construction) ou être l'idiome de refonte d'ensemble (« réglementaire »,
  // « cadre réglementaire »).
  it.each([
    "Refonte du règlement de taxation",
    "Refonte de la réglementation sur les animaux",
    "Refonte du règlement de régie interne du conseil",
    "Refonte du règlement sur la gestion contractuelle",
    "Refonte du règlement sur la sécurité incendie",
    "Refonte des règlements municipaux",
    "Refonte des règlements de la bibliothèque municipale",
    "Refonte du règlement d'emprunt",
  ])("does not read the municipal bylaw %s as an urbanism refonte", (label) => {
    expect(instrumentOf(label)).toBe("autre");
  });

  // La ponctuation ne doit PAS tenir lieu de borne : ce qui écarte « refonte
  // totale du site Web », c'est l'absence d'objet d'urbanisme, pas le fait que
  // l'adjectif d'ampleur soit ou non suivi d'une virgule.
  it.each([
    "Refonte complète, en trois phases, du site Web municipal",
    "Refonte totale, prévue en 2027, du site Internet",
    "Refonte globale : la nouvelle image de marque de la Ville",
  ])("does not let punctuation smuggle %s into the vivier", (label) => {
    expect(instrumentOf(label)).toBe("autre");
  });

  // Séparateurs des PV — plus fréquents que le NBSP et jusqu'ici non couverts.
  // Les caractères invisibles ou homographes sont écrits en ÉCHAPPEMENT, jamais
  // au glyphe : tiret cadratin, tiret demi-cadratin et tiret insécable sont
  // indiscernables à la relecture.
  it.each([
    ["em dash pair U+2014", "Refonte \u2014 complète \u2014 du règlement de zonage"],
    ["colon", "Refonte : le règlement de zonage est remplacé"],
    ["comma pair", "Refonte, complète, du règlement de zonage"],
    ["en dash U+2013", "Refonte\u2013complète du règlement de zonage"],
    ["non-breaking hyphen U+2011", "Refonte\u2011complète du règlement de zonage"],
    ["NBSP U+00A0", "Refonte\u00a0du règlement de zonage"],
  ])("reads a refonte across the %s separator", (_name, label) => {
    expect(instrumentOf(label)).toBe("refonte");
  });

  // Une catégorie structurée fait autorité : un PPCMOI/PIIA/dérogation ponctuel
  // dont le PV MENTIONNE une refonte en cours ne doit pas entrer dans le vivier
  // sous une étiquette fausse. Les `candidate === …` explicites passent tous
  // AVANT le bloc heuristique de texte libre.
  it.each([
    [
      "ppcmoi",
      "PPCMOI — 145 rue Principale",
      "Autorisation du projet particulier, en concordance avec la refonte du règlement de zonage en cours.",
      "ppcmoi",
    ],
    [
      "piia",
      "PIIA — 12 rue des Érables",
      "Approbation des plans : la refonte du règlement de zonage est en cours.",
      "piia",
    ],
    [
      "derogation_mineure",
      "Dérogation mineure — 4 rue du Parc",
      "Marge latérale réduite, en attendant la refonte du règlement de zonage.",
      "derogation",
    ],
  ])("lets the explicit category %s outrank the free-text refonte", (category, label, description, expected) => {
    expect(instrumentOf(label, description, category)).toBe(expected);
  });

  // …et l'ordre interne du bloc heuristique reste inchangé : sans catégorie
  // structurée, une refonte réglementaire porte le signal devant `ppcmoi`/`piia`.
  it("keeps refonte ahead of ppcmoi/piia inside the free-text block", () => {
    expect(
      instrumentOf(
        "Refonte du règlement de zonage",
        "Le projet particulier (PPCMOI) 362 est adopté séparément.",
      ),
    ).toBe("refonte");
    expect(
      instrumentOf("Refonte du règlement de zonage", "PIIA cité en annexe."),
    ).toBe("refonte");
  });
});

describe("instrument lexicon — apposition and prefixed refonte categories", () => {
  const instrumentOf = (label: string, description: string | null = null, category: string | null = null) =>
    instrumentFromSignal(category, label, description, null);

  // Recette sur les 7 221 nœuds de production : les DEUX dernières sorties.
  // Textes RÉELS des nœuds, pas des paraphrases.

  // chute-saint-philippe — six règlements d'urbanisme adoptés en bloc. Sortait
  // parce que le qualifiant d'urbanisme exigeait « de » / « d' » : l'apposition
  // nue « réglementation urbanisme » n'était pas reconnue.
  it("keeps event-chute-saint-philippe-refonte-reglementation-2026-04-13 in the vivier", () => {
    expect(
      instrumentOf(
        "Adoption groupée règlements 331 à 336-2026 — refonte réglementation urbanisme",
        "Adoption groupée de 6 règlements d'urbanisme (331 à 336-2026) modifiant permis (137, 138), zonage (139), lotissement (140), construction (141)…",
      ),
    ).toBe("refonte");
  });

  // saint-sixte — DOUBLE cause, chacune testée SEULE pour qu'aucune ne masque
  // l'autre : (1) la catégorie structurée `refonte_reglementation_urbanisme`
  // n'était pas reconnue, le test étant une égalité stricte à `refonte` ;
  // (2) « réglementation zones » n'avait aucun qualifiant reconnu.
  it("keeps signal-saint-sixte-refonte-urbanisme-fo2fo3 in the vivier, on each cause alone", () => {
    const label =
      "Signal : refonte réglementation zones Fo-2/Fo-3 et milieu villageois (règlements 260-26 et 261-26)";

    // Cause 1 seule — la catégorie structurée doit faire autorité même préfixée.
    // Le libellé est neutralisé pour que seul le token puisse décider.
    expect(instrumentOf("Signal saint-sixte", null, "refonte_reglementation_urbanisme")).toBe("refonte");

    // Cause 2 seule — sans catégorie, l'apposition « réglementation zones » doit
    // porter le signal.
    expect(instrumentOf(label)).toBe("refonte");

    // Le nœud réel, les deux causes réunies.
    expect(instrumentOf(label, null, "refonte_reglementation_urbanisme")).toBe("refonte");
  });

  // La reconnaissance de la catégorie structurée est un PRÉFIXE borné, pas une
  // égalité stricte ni un `includes`. Trois tokens `refonte_*` existent en base.
  it.each([
    "refonte",
    "refontes",
    "refonte_reglementation",
    "refonte_reglementation_urbanisme",
    "Refonte réglementation urbanisme", // `token()` replie et souligne les espaces
  ])("reads the structured category %s as a refonte", (category) => {
    expect(instrumentOf("Libellé sans marqueur", null, category)).toBe("refonte");
  });

  // …et le préfixe est BORNÉ : une catégorie qui CONTIENT « refonte » sans
  // commencer par elle n'est pas une refonte, et les autres catégories
  // structurées gardent leur reconnaissance.
  it("keeps the refonte prefix bounded and the other categories intact", () => {
    expect(instrumentOf("PIIA — 12 rue des Érables", null, "piia_refonte_architecturale")).toBe("piia");
    expect(instrumentOf("Dérogation mineure — 4 rue du Parc", null, "derogation_mineure")).toBe("derogation");
    expect(instrumentOf("PPCMOI — 145 rue Principale", null, "ppcmoi")).toBe("ppcmoi");
    expect(instrumentOf("Modification de zonage", null, "modification_zonage")).toBe("rezonage");
  });

  // L'apposition est admise, mais c'est LE MOT D'URBANISME qui qualifie —
  // jamais l'absence de préposition. La borne des huit familles municipales
  // tient donc aussi en apposition nue.
  it.each([
    "Refonte réglementation urbanisme",
    "Refonte règlement zonage",
    "Refonte réglementation zones",
    "Refonte règlements lotissement",
  ])("reads the bare apposition %s as a refonte", (label) => {
    expect(instrumentOf(label)).toBe("refonte");
  });

  it.each([
    "Refonte réglementation animaux",
    "Refonte règlement taxation",
    "Refonte réglementation matières résiduelles",
    "Refonte règlement emprunt",
    "Refonte règlements municipaux",
    "Refonte réglementation sécurité incendie",
  ])("does not read the bare apposition %s as an urbanism refonte", (label) => {
    expect(instrumentOf(label)).toBe("autre");
  });

  // Lac-Frontière — le SEUL vrai faux positif retiré par ce lot. Il doit rester
  // dehors : la voirie n'est pas de l'urbanisme, en apposition comme ailleurs.
  it.each([
    "Refonte des services souterrains",
    "Refonte services souterrains",
    "Refonte réseau souterrain route 204",
  ])("keeps the lac-frontière family %s out of the vivier", (label) => {
    expect(instrumentOf(label)).toBe("autre");
  });
});
