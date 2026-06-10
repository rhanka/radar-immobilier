/**
 * Tests pour pv-seed.ts — seed PV Rive-Sud (saint-constant, sainte-catherine).
 *
 * Vérifie :
 *   1. Saint-Constant : PV réel → ≥1 DesignationEvent canonique (règl. 1926-26/1927-26)
 *   2. Sainte-Catherine : PV réel → 0 DesignationEvent zonage (faux-positif écarté)
 *   3. ALL_SIGNALS_CITY_SLUGS inclut saint-constant et sainte-catherine
 *
 * Aucun appel réseau — objectStore en mémoire uniquement.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { ObjectInfo, ObjectStore } from "../../storage/object-store.js";
import {
  seedPvCity,
  PV_SEED_CITY_SLUGS,
  ALL_SIGNALS_CITY_SLUGS,
} from "./pv-seed.js";

// ─────────────────────────────────────────────────────────────────────────────
// In-memory ObjectStore (pas de MinIO)
// ─────────────────────────────────────────────────────────────────────────────

class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, Uint8Array>();

  async put(
    key: string,
    body: Uint8Array | Buffer | string,
    _contentType?: string,
  ): Promise<ObjectInfo> {
    const bytes =
      typeof body === "string"
        ? new TextEncoder().encode(body)
        : new Uint8Array(body);
    this.objects.set(key, bytes);
    return { key, size: bytes.byteLength };
  }

  async get(key: string): Promise<Uint8Array> {
    const v = this.objects.get(key);
    if (!v) throw new Error(`MemoryStore: clé manquante "${key}"`);
    return v;
  }

  async head(key: string): Promise<ObjectInfo | null> {
    const v = this.objects.get(key);
    return v ? { key, size: v.byteLength } : null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Saint-Constant — POSITIF (règlement de zonage 1926-26/1927-26 réel)
// ─────────────────────────────────────────────────────────────────────────────

describe("seedPvCity — Saint-Constant (POSITIF : zonage réel 1926-26/1927-26)", () => {
  let store: MemoryStore;
  let result: Awaited<ReturnType<typeof seedPvCity>>;

  beforeEach(async () => {
    store = new MemoryStore();
    result = await seedPvCity(
      store,
      "saint-constant",
      () => new Date("2026-06-10T00:00:00Z"),
    );
  });

  it("seed réussit (ok: true)", () => {
    expect(result.ok).toBe(true);
  });

  it("la clé S3 du PV contient 'proces-verbaux-saint-constant'", () => {
    expect(result.pvRawRef).toMatch(/proces-verbaux-saint-constant/);
  });

  it("au moins un DesignationEvent canonique (changement de zonage réel)", () => {
    // Le vrai PV de mai 2026 contient deux avis de motion de zonage.
    // detectZonageChange() doit retourner changementZonage:true → ≥1 DesignationEvent.
    expect(result.designationEventCount).toBeGreaterThanOrEqual(1);
  });

  it("le DesignationEvent est keyed sur les règlements réels 1926-26/1927-26", () => {
    const events = result.exploitation.state.canonicals.filter(
      (c) => c.type === "DesignationEvent",
    );
    const terms = events.flatMap((e) => e.aliases.concat(e.label));
    const combined = terms.join(" ").toLowerCase();
    // Au moins un des deux règlements doit apparaître dans les termes normalisés
    expect(combined.includes("1926-26") || combined.includes("1927-26")).toBe(true);
  });

  it("au moins un Bylaw canonique (règlement 1926-26 ou 1927-26)", () => {
    const bylaws = result.exploitation.state.canonicals.filter(
      (c) => c.type === "Bylaw",
    );
    const labels = bylaws.map((b) => b.label);
    const hasRealBylaw = labels.some(
      (l) => l.includes("1926-26") || l.includes("1927-26"),
    );
    expect(hasRealBylaw).toBe(true);
  });

  it("le project-state de saint-constant est persisté dans le store", () => {
    expect(result.stateKey).toMatch(/saint-constant/);
    expect(store.objects.has(result.stateKey)).toBe(true);
  });

  it("les mentions contiennent les bylaw réels", () => {
    const mentionTerms = result.exploitation.state.mentions
      .flatMap((m) => m.normalized_terms);
    expect(mentionTerms).toContain("1926-26");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Sainte-Catherine — NÉGATIF (avis de motion non-zonage, faux-positif écarté)
// ─────────────────────────────────────────────────────────────────────────────

describe("seedPvCity — Sainte-Catherine (NÉGATIF : 0 DesignationEvent zonage)", () => {
  let result: Awaited<ReturnType<typeof seedPvCity>>;

  beforeEach(async () => {
    const store = new MemoryStore();
    result = await seedPvCity(
      store,
      "sainte-catherine",
      () => new Date("2026-06-10T00:00:00Z"),
    );
  });

  it("seed réussit (ok: true)", () => {
    expect(result.ok).toBe(true);
  });

  it("ANTI-INVENTION : 0 DesignationEvent zonage (circulation + emprunt ≠ zonage)", () => {
    // Le vrai PV de mai 2026 Sainte-Catherine contient des avis de motion
    // pour circulation (1008-00-50) et emprunt (944-26) — JAMAIS pour le zonage.
    // detectZonageChange() → changementZonage:false → 0 DesignationEvent émis.
    expect(result.designationEventCount).toBe(0);
  });

  it("le project-state de sainte-catherine est persisté", () => {
    expect(result.stateKey).toMatch(/sainte-catherine/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. ALL_SIGNALS_CITY_SLUGS — inclut saint-constant et les villes MAMH
// ─────────────────────────────────────────────────────────────────────────────

describe("ALL_SIGNALS_CITY_SLUGS", () => {
  it("inclut saint-constant (villes PV Rive-Sud)", () => {
    expect(ALL_SIGNALS_CITY_SLUGS).toContain("saint-constant");
  });

  it("inclut sainte-catherine", () => {
    expect(ALL_SIGNALS_CITY_SLUGS).toContain("sainte-catherine");
  });

  it("inclut salaberry-de-valleyfield (villes MAMH)", () => {
    expect(ALL_SIGNALS_CITY_SLUGS).toContain("salaberry-de-valleyfield");
  });

  it("inclut beauharnois", () => {
    expect(ALL_SIGNALS_CITY_SLUGS).toContain("beauharnois");
  });

  it("PV_SEED_CITY_SLUGS contient saint-constant et sainte-catherine", () => {
    expect(PV_SEED_CITY_SLUGS).toContain("saint-constant");
    expect(PV_SEED_CITY_SLUGS).toContain("sainte-catherine");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Idempotence — re-seed ne plante pas
// ─────────────────────────────────────────────────────────────────────────────

describe("seedPvCity — idempotence (double seed)", () => {
  it("un second appel sur saint-constant réussit sans erreur", async () => {
    const store = new MemoryStore();
    const now = () => new Date("2026-06-10T00:00:00Z");
    const r1 = await seedPvCity(store, "saint-constant", now);
    const r2 = await seedPvCity(store, "saint-constant", now);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    // Les deux runs doivent produire le même nombre de DesignationEvents
    expect(r2.designationEventCount).toBe(r1.designationEventCount);
  });
});
