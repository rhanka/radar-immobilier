/**
 * m2 — Logique du filtre de plage de dates des signaux.
 *
 * Vérifie : défaut 6 mois, presets 3/6/12, détection du preset actif, extraction
 * de `etape_date`, bornes inclusives, conservation des signaux sans date, et que
 * resserrer la plage (6 → 3 mois) réduit RÉELLEMENT la population.
 */
import { describe, it, expect } from "vitest";
import type { GraphSignalNode } from "./graph-signal-detail-client.js";
import {
  activePresetForRange,
  DEFAULT_PRESET_MONTHS,
  defaultDateRange,
  filterNodesByEtapeDate,
  isWithinRange,
  presetRange,
  signalEtapeDate,
  subMonths,
} from "./signal-date-filter.js";

// Point d'ancrage déterministe pour tous les tests dépendants du « maintenant ».
const NOW = new Date("2026-07-17T12:00:00Z");

function node(id: string, props: Record<string, unknown>): GraphSignalNode {
  return {
    id,
    type: "Signal",
    label: id,
    citySlug: "austin",
    sourceRef: null,
    createdAt: null,
    props,
  };
}

describe("presets & défaut", () => {
  it("le défaut est 6 mois", () => {
    expect(DEFAULT_PRESET_MONTHS).toBe(6);
    const def = defaultDateRange(NOW);
    expect(def.end).toEqual(NOW);
    expect(def.start).toEqual(subMonths(NOW, 6));
    // Le défaut EST le preset 6 mois.
    expect(activePresetForRange(def)).toBe(6);
  });

  it("presetRange pose end = now et start = now − N mois", () => {
    const r3 = presetRange(3, NOW);
    expect(r3.end).toEqual(NOW);
    expect(r3.start).toEqual(subMonths(NOW, 3));
    expect(activePresetForRange(r3)).toBe(3);
    expect(activePresetForRange(presetRange(12, NOW))).toBe(12);
  });

  it("une plage custom (non reconstructible) ne sélectionne aucun preset", () => {
    const custom = { start: new Date("2026-01-05"), end: new Date("2026-02-20") };
    expect(activePresetForRange(custom)).toBeNull();
  });

  it("une plage partielle (start ou end nul) ne sélectionne aucun preset", () => {
    expect(activePresetForRange({ start: null, end: NOW })).toBeNull();
    expect(activePresetForRange({ start: subMonths(NOW, 6), end: null })).toBeNull();
  });
});

describe("signalEtapeDate — extraction de la date d'étape", () => {
  it("lit etape_date à plat", () => {
    const d = signalEtapeDate(node("a", { etape_date: "2026-05-01" }));
    expect(d?.toISOString().slice(0, 10)).toBe("2026-05-01");
  });

  it("lit etapeDate imbriqué dans props.properties", () => {
    const d = signalEtapeDate(node("b", { properties: { etapeDate: "2026-04-15" } }));
    expect(d?.toISOString().slice(0, 10)).toBe("2026-04-15");
  });

  it("se rabat sur publishedAt puis createdAt quand aucune date d'étape", () => {
    const pub = signalEtapeDate({ ...node("c", {}), publishedAt: "2026-03-03" });
    expect(pub?.toISOString().slice(0, 10)).toBe("2026-03-03");
    const created = signalEtapeDate({ ...node("d", {}), createdAt: "2026-02-02" });
    expect(created?.toISOString().slice(0, 10)).toBe("2026-02-02");
  });

  it("renvoie null pour un signal sans date exploitable ou date non parsable", () => {
    expect(signalEtapeDate(node("e", {}))).toBeNull();
    expect(signalEtapeDate(node("f", { etape_date: "pas-une-date" }))).toBeNull();
  });
});

describe("isWithinRange — bornes inclusives, dateless conservé", () => {
  const range = presetRange(6, NOW); // [2026-01-17 .. 2026-07-17]

  it("inclut une date dans la plage", () => {
    expect(isWithinRange(new Date("2026-04-10"), range)).toBe(true);
  });

  it("inclut les bornes au jour près", () => {
    expect(isWithinRange(new Date("2026-01-17T23:00:00Z"), range)).toBe(true);
    expect(isWithinRange(new Date("2026-07-17T00:00:00Z"), range)).toBe(true);
  });

  it("exclut une date hors plage", () => {
    expect(isWithinRange(new Date("2025-12-31"), range)).toBe(false);
    expect(isWithinRange(new Date("2026-08-01"), range)).toBe(false);
  });

  it("conserve un signal sans date (null) — anti-invention", () => {
    expect(isWithinRange(null, range)).toBe(true);
  });

  it("une borne nulle est ouverte", () => {
    expect(isWithinRange(new Date("2000-01-01"), { start: null, end: NOW })).toBe(true);
    expect(isWithinRange(new Date("2999-01-01"), { start: NOW, end: null })).toBe(true);
  });
});

describe("filterNodesByEtapeDate — resserrer réduit la population", () => {
  const nodes = [
    node("il-y-a-1-mois", { etape_date: "2026-06-17" }),
    node("il-y-a-4-mois", { etape_date: "2026-03-17" }),
    node("il-y-a-9-mois", { etape_date: "2025-10-17" }),
    { ...node("sans-date", {}) },
  ];

  it("6 mois retient les <6 mois + le sans-date, exclut les 9 mois", () => {
    const six = filterNodesByEtapeDate(nodes, presetRange(6, NOW));
    expect(six.map((n) => n.id).sort()).toEqual(
      ["il-y-a-1-mois", "il-y-a-4-mois", "sans-date"].sort(),
    );
  });

  it("passer de 6 à 3 mois RÉDUIT la liste (le signal à 4 mois tombe)", () => {
    const six = filterNodesByEtapeDate(nodes, presetRange(6, NOW));
    const three = filterNodesByEtapeDate(nodes, presetRange(3, NOW));
    expect(three.length).toBeLessThan(six.length);
    expect(three.map((n) => n.id).sort()).toEqual(
      ["il-y-a-1-mois", "sans-date"].sort(),
    );
    expect(three.map((n) => n.id)).not.toContain("il-y-a-4-mois");
  });

  it("12 mois retient tout le daté + le sans-date", () => {
    const twelve = filterNodesByEtapeDate(nodes, presetRange(12, NOW));
    expect(twelve).toHaveLength(4);
  });
});
