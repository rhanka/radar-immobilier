import { describe, it, expect } from "vitest";
import { Signal, SIGNAL_TYPE_VALUES } from "@radar/domain";
import { filterByStatus, sortSignals, buildFeed, markApprofondir } from "$lib/signals/feed.js";
import { VISION_PRIORITY_RANK } from "$lib/signals/feed.js";
import type { SignalT } from "@radar/domain";

/**
 * Fixtures locales pour tester les helpers feed.ts.
 * Tous mode:"real" — les signaux simulés ont été supprimés (voir feat/signaux-reels-vue).
 * Ces données représentent des changements de zonage réels types pour tester le tri/filtre.
 */
const testSignals: SignalT[] = [
  Signal.parse({
    id: "test-rezone-high",
    type: "residential-rezoning",
    value: SIGNAL_TYPE_VALUES["residential-rezoning"],
    confidence: "high",
    status: "nouveau",
    sourceRefs: ["avis-consultation-150-49"],
    detectedAt: "2026-02-25",
    bylaw: "150-49",
    zone: "H-609-4",
    mode: "real",
  }),
  Signal.parse({
    id: "test-rezone-medium",
    type: "residential-rezoning",
    value: SIGNAL_TYPE_VALUES["residential-rezoning"],
    confidence: "medium",
    status: "à-approfondir",
    sourceRefs: ["avis-consultation-150-49-1"],
    detectedAt: "2026-04-22",
    bylaw: "150-49-1",
    zone: "H-143",
    mode: "real",
  }),
  Signal.parse({
    id: "test-ppcmoi-low",
    type: "ppcmoi",
    value: SIGNAL_TYPE_VALUES["ppcmoi"],
    confidence: "low",
    status: "surveillance",
    sourceRefs: [],
    detectedAt: "2026-05-10",
    zone: "C-627",
    mode: "real",
  }),
  Signal.parse({
    id: "test-cptaq-medium",
    type: "cptaq",
    value: SIGNAL_TYPE_VALUES["cptaq"],
    confidence: "medium",
    status: "nouveau",
    sourceRefs: [],
    detectedAt: "2026-05-01",
    bylaw: "150-44",
    zone: "A-118",
    mode: "real",
  }),
  Signal.parse({
    id: "test-derogation-ecarte",
    type: "derogation-relevant",
    value: SIGNAL_TYPE_VALUES["derogation-relevant"],
    confidence: "medium",
    status: "écarté",
    sourceRefs: [],
    detectedAt: "2026-05-15",
    zone: "H-516",
    mode: "real",
  }),
  Signal.parse({
    id: "test-rezone-high-2",
    type: "residential-rezoning",
    value: SIGNAL_TYPE_VALUES["residential-rezoning"],
    confidence: "high",
    status: "à-approfondir",
    sourceRefs: ["avis-approbation-referendaire-150-51"],
    detectedAt: "2026-04-22",
    bylaw: "150-51",
    zone: "H-521",
    mode: "real",
  }),
];

describe("feed.ts — helpers de tri/filtre purs (fixtures réelles)", () => {
  it("toutes les fixtures sont des SignalT valides (mode:real uniquement)", () => {
    for (const s of testSignals) {
      expect(Signal.safeParse(s).success).toBe(true);
      expect(s.mode).toBe("real");
    }
  });

  // (a) tri par valeur desc : signal à 10 en premier
  it("sort by value desc: signal valeur-10 en premier", () => {
    const sorted = sortSignals(testSignals, "value", "desc");
    expect(sorted[0].value).toBe(10);
  });

  // (b) confiance : high > medium > low
  it("sort by confidence desc: signaux haute-confiance avant les autres", () => {
    const sorted = sortSignals(testSignals, "confidence", "desc");
    const confidences = sorted.map((s) => s.confidence);
    const firstNonHigh = confidences.findIndex((c) => c !== "high");
    const lastHigh = confidences.lastIndexOf("high");
    expect(lastHigh).toBeLessThan(firstNonHigh === -1 ? Infinity : firstNonHigh);
  });

  it("sort by confidence asc: signaux faible-confiance en premier", () => {
    const sorted = sortSignals(testSignals, "confidence", "asc");
    expect(sorted[0].confidence).toBe("low");
  });

  // S1.4 — tri par priorité VISION : residential-rezoning (rang 1) en premier
  it("sort by vision-priority desc: residential-rezoning (rang VISION 1) en premier", () => {
    const sorted = sortSignals(testSignals, "vision-priority", "desc");
    expect(sorted[0].type).toBe("residential-rezoning");
  });

  it("VISION_PRIORITY_RANK: cptaq (rang 4) > ppcmoi (rang 2) en numérique VISION", () => {
    // CPTAQ a un rang VISION plus élevé (4) que PPCMOI (2) — c'est la contradiction S1.4
    expect(VISION_PRIORITY_RANK["cptaq"]).toBeGreaterThan(VISION_PRIORITY_RANK["ppcmoi"]!);
  });

  // (d) filtre par statut
  it("filterByStatus 'nouveau' retourne seulement les signaux nouveau", () => {
    const filtered = filterByStatus(testSignals, "nouveau");
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((s) => s.status === "nouveau")).toBe(true);
  });

  it("filterByStatus 'écarté' retourne seulement les signaux écarté", () => {
    const filtered = filterByStatus(testSignals, "écarté");
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((s) => s.status === "écarté")).toBe(true);
  });

  it("filterByStatus 'tous' retourne tous les signaux", () => {
    const filtered = filterByStatus(testSignals, "tous");
    expect(filtered).toHaveLength(testSignals.length);
    // Tous sont mode:real (plus aucun simulé)
    expect(filtered.every((s) => s.mode === "real")).toBe(true);
  });

  it("filterByStatus 'surveillance' retourne seulement les signaux surveillance", () => {
    const filtered = filterByStatus(testSignals, "surveillance");
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((s) => s.status === "surveillance")).toBe(true);
  });

  it("buildFeed applique le filtre puis le tri — écarté + value desc", () => {
    const result = buildFeed(testSignals, "écarté", "value", "desc");
    expect(result.every((s) => s.status === "écarté")).toBe(true);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].value).toBeGreaterThanOrEqual(result[i].value);
    }
  });

  // (e) Approfondir mutation immutable — AC#4
  // testSignals[3] (test-cptaq-medium) démarre en "nouveau"
  it("markApprofondir positionne à-approfondir de façon immutable", () => {
    const target = testSignals[3]; // status: "nouveau"
    expect(target.status).toBe("nouveau"); // vérification préalable
    const out = markApprofondir(testSignals, target.id);
    expect(out.find((s) => s.id === target.id)?.status).toBe("à-approfondir");
    expect(testSignals[3].status).not.toBe("à-approfondir"); // original inchangé
  });
});
