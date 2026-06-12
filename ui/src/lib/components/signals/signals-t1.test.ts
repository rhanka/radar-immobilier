import { describe, it, expect } from "vitest";
import { demoSignalsT1 } from "$lib/demo/radar-t1-signals.js";
import { filterByStatus, sortSignals, buildFeed, markApprofondir } from "$lib/signals/feed.js";
import { VISION_PRIORITY_RANK } from "$lib/signals/feed.js";

// Tous les signaux sont désormais réels (mode:"real") — plus de synthétique.
describe("demoSignalsT1 — dataset réel uniquement", () => {
  it("contient exactement 3 signaux réels", () => {
    expect(demoSignalsT1).toHaveLength(3);
  });

  it("tous les signaux sont mode:real, aucun synthétique", () => {
    expect(demoSignalsT1.every((s) => s.mode === "real")).toBe(true);
    expect(demoSignalsT1.some((s) => s.mode === "simulation")).toBe(false);
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
    // Les 3 signaux réels : 2 high + 1 medium → premier est medium
    expect(["medium", "low"]).toContain(sorted[0].confidence);
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
  it("filterByStatus 'à-approfondir' retourne les 3 signaux réels", () => {
    const filtered = filterByStatus(demoSignalsT1, "à-approfondir");
    expect(filtered.length).toBe(3);
    expect(filtered.every((s) => s.status === "à-approfondir")).toBe(true);
  });

  it("filterByStatus 'tous' retourne les 3 signaux", () => {
    const filtered = filterByStatus(demoSignalsT1, "tous");
    expect(filtered).toHaveLength(demoSignalsT1.length);
    // Aucun signal synthétique dans le pool
    expect(filtered.every((s) => s.mode === "real")).toBe(true);
  });

  it("filterByStatus 'écarté' retourne un tableau vide (aucun signal écarté)", () => {
    const filtered = filterByStatus(demoSignalsT1, "écarté");
    expect(filtered.length).toBe(0);
  });

  it("filterByStatus 'surveillance' retourne un tableau vide (aucun signal surveillance)", () => {
    const filtered = filterByStatus(demoSignalsT1, "surveillance");
    expect(filtered.length).toBe(0);
  });

  it("buildFeed applique le filtre puis le tri — à-approfondir + value desc", () => {
    const result = buildFeed(demoSignalsT1, "à-approfondir", "value", "desc");
    expect(result.every((s) => s.status === "à-approfondir")).toBe(true);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].value).toBeGreaterThanOrEqual(result[i].value);
    }
  });

  // (e) Approfondir mutation immutable — AC#4
  it("markApprofondir positionne à-approfondir de façon immutable", () => {
    const target = demoSignalsT1[0]; // status: "à-approfondir" (signal réel)
    const out = markApprofondir(demoSignalsT1, target.id);
    expect(out.find((s) => s.id === target.id)?.status).toBe("à-approfondir");
    expect(demoSignalsT1[0].status).toBe("à-approfondir"); // inchangé (déjà à-approfondir)
  });
});
