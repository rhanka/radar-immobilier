import { describe, it, expect } from "vitest";
import { demoSignalsT1 } from "$lib/demo/radar-t1-signals.js";
import { filterByStatus, sortSignals, buildFeed, markApprofondir } from "$lib/signals/feed.js";
import { VISION_PRIORITY_RANK } from "$lib/signals/feed.js";

// SI1 — toutes les 6 lignes sont dans le dataset (simulation jamais masquée dans ce feed)
describe("demoSignalsT1 — dataset complet", () => {
  it("contient exactement 6 signaux", () => {
    expect(demoSignalsT1).toHaveLength(6);
  });

  it("contient 3 signaux réels et 3 exemples simulation", () => {
    const real = demoSignalsT1.filter((s) => s.mode === "real");
    const sim = demoSignalsT1.filter((s) => s.mode === "simulation");
    expect(real).toHaveLength(3);
    expect(sim).toHaveLength(3);
  });
});

describe("feed.ts — helpers de tri/filtre purs", () => {
  // (a) tri par valeur desc : signal à 10 en premier
  it("sort by value desc: signal valeur-10 en premier", () => {
    const sorted = sortSignals(demoSignalsT1, "value", "desc");
    expect(sorted[0].value).toBe(10);
  });

  // (b) confiance : high > medium > low
  it("sort by confidence desc: signaux haute-confiance avant les autres", () => {
    const sorted = sortSignals(demoSignalsT1, "confidence", "desc");
    const confidences = sorted.map((s) => s.confidence);
    const firstNonHigh = confidences.findIndex((c) => c !== "high");
    const lastHigh = confidences.lastIndexOf("high");
    expect(lastHigh).toBeLessThan(firstNonHigh === -1 ? Infinity : firstNonHigh);
  });

  it("sort by confidence asc: signaux faible-confiance en premier", () => {
    const sorted = sortSignals(demoSignalsT1, "confidence", "asc");
    expect(sorted[0].confidence).toBe("low");
  });

  // S1.4 — tri par priorité VISION : residential-rezoning (rang 1) en premier
  it("sort by vision-priority desc: residential-rezoning (rang VISION 1) en premier", () => {
    const sorted = sortSignals(demoSignalsT1, "vision-priority", "desc");
    expect(sorted[0].type).toBe("residential-rezoning");
  });

  it("VISION_PRIORITY_RANK: cptaq (rang 4) > ppcmoi (rang 2) en numérique VISION", () => {
    // CPTAQ a un rang VISION plus élevé (4) que PPCMOI (2) — c'est la contradiction S1.4
    expect(VISION_PRIORITY_RANK["cptaq"]).toBeGreaterThan(VISION_PRIORITY_RANK["ppcmoi"]!);
  });

  // (d) filtre par statut
  it("filterByStatus 'nouveau' retourne seulement les signaux nouveau", () => {
    const filtered = filterByStatus(demoSignalsT1, "nouveau");
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((s) => s.status === "nouveau")).toBe(true);
  });

  it("filterByStatus 'écarté' retourne seulement les signaux écarté", () => {
    const filtered = filterByStatus(demoSignalsT1, "écarté");
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((s) => s.status === "écarté")).toBe(true);
  });

  it("filterByStatus 'tous' retourne les 6 signaux", () => {
    const filtered = filterByStatus(demoSignalsT1, "tous");
    expect(filtered).toHaveLength(demoSignalsT1.length);
    // SI1 : les signaux simulation sont présents dans le pool complet
    expect(filtered.some((s) => s.mode === "simulation")).toBe(true);
  });

  it("filterByStatus 'surveillance' retourne seulement les signaux surveillance", () => {
    const filtered = filterByStatus(demoSignalsT1, "surveillance");
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((s) => s.status === "surveillance")).toBe(true);
  });

  it("buildFeed applique le filtre puis le tri — écarté + value desc", () => {
    const result = buildFeed(demoSignalsT1, "écarté", "value", "desc");
    expect(result.every((s) => s.status === "écarté")).toBe(true);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].value).toBeGreaterThanOrEqual(result[i].value);
    }
  });

  // (e) Approfondir mutation immutable — AC#4
  // demoSignalsT1[3] démarre en "nouveau" — ancre sûre pour le test d'immutabilité.
  it("markApprofondir positionne à-approfondir de façon immutable", () => {
    const target = demoSignalsT1[3]; // status: "nouveau"
    const out = markApprofondir(demoSignalsT1, target.id);
    expect(out.find((s) => s.id === target.id)?.status).toBe("à-approfondir");
    expect(demoSignalsT1[3].status).not.toBe("à-approfondir"); // original inchangé
  });
});
