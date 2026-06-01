import { describe, it, expect } from "vitest";
import {
  TREATMENTS,
  CONNECTORS,
  STATUS_LABELS_FR,
  benchmarkRecap,
} from "$lib/automation/automation-data.js";
import type { ConnectorStatus } from "$lib/automation/automation-data.js";

describe("AutomationView — data layer (Lot 1 helpers)", () => {
  // ── TREATMENTS ────────────────────────────────────────────────────────────

  it("TREATMENTS contient exactement 3 cadences", () => {
    expect(TREATMENTS).toHaveLength(3);
  });

  it("TREATMENTS couvre initial, récurrent et approfondissement", () => {
    const kinds = TREATMENTS.map((t) => t.kind);
    expect(kinds).toContain("initial");
    expect(kinds).toContain("recurrent");
    expect(kinds).toContain("approfondissement");
  });

  it("chaque traitement a title, cadence, description et trigger non vides", () => {
    for (const t of TREATMENTS) {
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.cadence.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.trigger.length).toBeGreaterThan(0);
    }
  });

  // ── CONNECTORS ────────────────────────────────────────────────────────────

  it("aucun connecteur n'a le statut 'connecte' (les autres restent simulés)", () => {
    const connected = CONNECTORS.filter((c) => c.status === "connecte");
    expect(connected).toHaveLength(0);
  });

  it("au moins un connecteur est RÉEL (amorce ÉV11)", () => {
    const real = CONNECTORS.filter((c) => c.status === "reel");
    expect(real.length).toBeGreaterThanOrEqual(1);
  });

  it("STATUS_LABELS_FR couvre les statuts possibles", () => {
    const statuts: ConnectorStatus[] = ["connecte", "a-venir", "manuel", "reel"];
    for (const s of statuts) {
      expect(STATUS_LABELS_FR[s]).toBeTruthy();
    }
  });

  it("CONNECTORS ne sont pas vides et ont id + label", () => {
    expect(CONNECTORS.length).toBeGreaterThan(0);
    for (const c of CONNECTORS) {
      expect(c.id.length).toBeGreaterThan(0);
      expect(c.label.length).toBeGreaterThan(0);
    }
  });

  // ── benchmarkRecap ────────────────────────────────────────────────────────

  it("benchmarkRecap() est trié par rang croissant (rank 1 en premier)", () => {
    const recap = benchmarkRecap();
    for (let i = 1; i < recap.length; i++) {
      expect(recap[i].rank).toBeGreaterThan(recap[i - 1].rank);
    }
  });

  it("benchmarkRecap() commence par Claude (rank 1)", () => {
    const recap = benchmarkRecap();
    expect(recap[0].rank).toBe(1);
    expect(recap[0].name).toMatch(/Claude/);
  });

  it("benchmarkRecap() contient les 4 pistes du benchmark", () => {
    const recap = benchmarkRecap();
    expect(recap).toHaveLength(4);
    const names = recap.map((r) => r.name);
    expect(names.some((n) => n.includes("Claude"))).toBe(true);
    expect(names.some((n) => n.includes("Codex"))).toBe(true);
    expect(names.some((n) => n.includes("Humain"))).toBe(true);
    expect(names.some((n) => n.includes("Gemini"))).toBe(true);
  });

  it("Gemini (rank 4) a fabrication 'multiple'", () => {
    const recap = benchmarkRecap();
    const gemini = recap.find((r) => r.name.includes("Gemini"));
    expect(gemini).toBeDefined();
    expect(gemini!.fabrication).toBe("multiple");
  });

  it("les trois autres pistes ont fabrication 'none'", () => {
    const recap = benchmarkRecap();
    const others = recap.filter((r) => !r.name.includes("Gemini"));
    for (const r of others) {
      expect(r.fabrication).toBe("none");
    }
  });

  it("tous les totaux sont des nombres positifs", () => {
    const recap = benchmarkRecap();
    for (const r of recap) {
      expect(r.total).toBeGreaterThan(0);
    }
  });
});
