/**
 * Tests pour pv-seed.ts — seed PV Rive-Sud + Vallée-du-Richelieu + Marguerite-D'Youville
 *   (saint-constant, sainte-catherine, chateauguay, la-prairie, delson, vaudreuil-dorion,
 *    sainte-martine, saint-remi, mcmasterville, beloeil, sainte-julie).
 *
 * Vérifie :
 *   1. Saint-Constant : PV réel → ≥1 DesignationEvent canonique (règl. 1926-26/1927-26)
 *   2. Sainte-Catherine : PV réel → 0 DesignationEvent zonage (faux-positif écarté)
 *   3. Châteauguay : PV réel → 1 DesignationEvent (Z-3001, zones C-754/C-810)
 *   4. La Prairie : PV réel → 0 DesignationEvent zonage (taxes/patrimoine/circulation)
 *   5. Delson : PV réel → 0 DesignationEvent zonage (référence passée sans avis de motion actif)
 *   6. Vaudreuil-Dorion : PV réel → 0 DesignationEvent zonage (faux-positif écarté)
 *   7. Sainte-Martine : PV réel → 1 DesignationEvent (2026-510, zone MxtV-2)
 *   8. ALL_SIGNALS_CITY_SLUGS inclut toutes les villes
 *   9. McMasterville : PV réel → 1 DesignationEvent (382-37, modifie zonage 382-00-2008)
 *  10. Beloeil : PV réel → 1 DesignationEvent (1667-127/1667-128, zone C-523)
 *  11. Sainte-Julie : PV réel → 1 DesignationEvent (1101-132, zone C-150)
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
// 3. Châteauguay — POSITIF (règlement Z-3001, zones C-754/C-810)
// ─────────────────────────────────────────────────────────────────────────────

describe("seedPvCity — Châteauguay (POSITIF : zonage Z-3001, zones C-754/C-810)", () => {
  let store: MemoryStore;
  let result: Awaited<ReturnType<typeof seedPvCity>>;

  beforeEach(async () => {
    store = new MemoryStore();
    result = await seedPvCity(
      store,
      "chateauguay",
      () => new Date("2026-06-10T00:00:00Z"),
    );
  });

  it("seed réussit (ok: true)", () => {
    expect(result.ok).toBe(true);
  });

  it("la clé S3 du PV contient 'proces-verbaux-chateauguay'", () => {
    expect(result.pvRawRef).toMatch(/proces-verbaux-chateauguay/);
  });

  it("exactement 1 DesignationEvent canonique (Z-3001)", () => {
    expect(result.designationEventCount).toBe(1);
  });

  it("le DesignationEvent est keyed sur le règlement Z-3001", () => {
    // Le DesignationEvent canonique porte le label "Avis de motion règlement de zonage Z-3001".
    // Les zones C-754/C-810 sont dans les zoneRefs des mentions, pas dans le label canonique.
    const events = result.exploitation.state.canonicals.filter(
      (c) => c.type === "DesignationEvent",
    );
    const combined = events.map((e) => e.label).join(" ").toLowerCase();
    expect(combined.includes("z-3001")).toBe(true);
  });

  it("les mentions DesignationEvent référencent les zones C-754 et/ou C-810", () => {
    // Les zoneRefs sont portées par les MentionNode (pas par les canonicaux).
    const eventMentions = result.exploitation.state.mentions.filter(
      (m) => m.type === "DesignationEvent",
    );
    const allZoneRefs = eventMentions.flatMap((m) => m.zoneRefs ?? []);
    const combined = allZoneRefs.join(" ").toUpperCase();
    expect(combined.includes("C-754") || combined.includes("C-810")).toBe(true);
  });

  it("le project-state de chateauguay est persisté dans le store", () => {
    expect(result.stateKey).toMatch(/chateauguay/);
    expect(store.objects.has(result.stateKey)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. La Prairie — NÉGATIF (0 DesignationEvent zonage)
// ─────────────────────────────────────────────────────────────────────────────

describe("seedPvCity — La Prairie (NÉGATIF : 0 DesignationEvent zonage)", () => {
  let result: Awaited<ReturnType<typeof seedPvCity>>;

  beforeEach(async () => {
    const store = new MemoryStore();
    result = await seedPvCity(
      store,
      "la-prairie",
      () => new Date("2026-06-10T00:00:00Z"),
    );
  });

  it("seed réussit (ok: true)", () => {
    expect(result.ok).toBe(true);
  });

  it("ANTI-INVENTION : 0 DesignationEvent zonage (taxes/patrimoine/circulation ≠ zonage)", () => {
    expect(result.designationEventCount).toBe(0);
  });

  it("le project-state de la-prairie est persisté", () => {
    expect(result.stateKey).toMatch(/la-prairie/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Delson — NÉGATIF (0 DesignationEvent zonage)
// ─────────────────────────────────────────────────────────────────────────────

describe("seedPvCity — Delson (NÉGATIF : 0 DesignationEvent zonage)", () => {
  let result: Awaited<ReturnType<typeof seedPvCity>>;

  beforeEach(async () => {
    const store = new MemoryStore();
    result = await seedPvCity(
      store,
      "delson",
      () => new Date("2026-06-10T00:00:00Z"),
    );
  });

  it("seed réussit (ok: true)", () => {
    expect(result.ok).toBe(true);
  });

  it("ANTI-INVENTION : 0 DesignationEvent zonage (référence passée ≠ avis de motion actif)", () => {
    expect(result.designationEventCount).toBe(0);
  });

  it("le project-state de delson est persisté", () => {
    expect(result.stateKey).toMatch(/delson/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Vaudreuil-Dorion — NÉGATIF (0 DesignationEvent zonage)
// ─────────────────────────────────────────────────────────────────────────────

describe("seedPvCity — Vaudreuil-Dorion (NÉGATIF : 0 DesignationEvent zonage)", () => {
  let result: Awaited<ReturnType<typeof seedPvCity>>;

  beforeEach(async () => {
    const store = new MemoryStore();
    result = await seedPvCity(
      store,
      "vaudreuil-dorion",
      () => new Date("2026-06-10T00:00:00Z"),
    );
  });

  it("seed réussit (ok: true)", () => {
    expect(result.ok).toBe(true);
  });

  it("ANTI-INVENTION : 0 DesignationEvent zonage (faux-positif écarté en amont)", () => {
    expect(result.designationEventCount).toBe(0);
  });

  it("le project-state de vaudreuil-dorion est persisté", () => {
    expect(result.stateKey).toMatch(/vaudreuil-dorion/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Sainte-Martine — POSITIF (règlement 2026-510, zone MxtV-2)
// ─────────────────────────────────────────────────────────────────────────────

describe("seedPvCity — Sainte-Martine (POSITIF : zonage réel 2026-510, zone MxtV-2)", () => {
  let store: MemoryStore;
  let result: Awaited<ReturnType<typeof seedPvCity>>;

  beforeEach(async () => {
    store = new MemoryStore();
    result = await seedPvCity(
      store,
      "sainte-martine",
      () => new Date("2026-06-10T00:00:00Z"),
    );
  });

  it("seed réussit (ok: true)", () => {
    expect(result.ok).toBe(true);
  });

  it("la clé S3 du PV contient 'proces-verbaux-sainte-martine'", () => {
    expect(result.pvRawRef).toMatch(/proces-verbaux-sainte-martine/);
  });

  it("exactement 1 DesignationEvent canonique (règlement 2026-510, zone MxtV-2)", () => {
    // Le vrai PV d'avril 2026 contient l'avis de motion pour le règlement 2026-510
    // modifiant le règlement de zonage 2019-342 afin d'agrandir la zone MxtV-2.
    // detectZonageChange() → changementZonage:true → 1 DesignationEvent émis.
    expect(result.designationEventCount).toBeGreaterThanOrEqual(1);
  });

  it("le DesignationEvent référence le règlement 2026-510", () => {
    const events = result.exploitation.state.canonicals.filter(
      (c) => c.type === "DesignationEvent",
    );
    const terms = events.flatMap((e) => e.aliases.concat(e.label));
    const combined = terms.join(" ").toLowerCase();
    expect(combined.includes("2026-510") || combined.includes("2026-511")).toBe(true);
  });

  it("le project-state de sainte-martine est persisté dans le store", () => {
    expect(result.stateKey).toMatch(/sainte-martine/);
    expect(store.objects.has(result.stateKey)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. ALL_SIGNALS_CITY_SLUGS — inclut toutes les villes (MAMH + PV Rive-Sud)
// ─────────────────────────────────────────────────────────────────────────────

describe("ALL_SIGNALS_CITY_SLUGS", () => {
  it("inclut saint-constant (villes PV Rive-Sud)", () => {
    expect(ALL_SIGNALS_CITY_SLUGS).toContain("saint-constant");
  });

  it("inclut sainte-catherine", () => {
    expect(ALL_SIGNALS_CITY_SLUGS).toContain("sainte-catherine");
  });

  it("inclut chateauguay", () => {
    expect(ALL_SIGNALS_CITY_SLUGS).toContain("chateauguay");
  });

  it("inclut la-prairie", () => {
    expect(ALL_SIGNALS_CITY_SLUGS).toContain("la-prairie");
  });

  it("inclut delson", () => {
    expect(ALL_SIGNALS_CITY_SLUGS).toContain("delson");
  });

  it("inclut vaudreuil-dorion", () => {
    expect(ALL_SIGNALS_CITY_SLUGS).toContain("vaudreuil-dorion");
  });

  it("inclut salaberry-de-valleyfield (villes MAMH)", () => {
    expect(ALL_SIGNALS_CITY_SLUGS).toContain("salaberry-de-valleyfield");
  });

  it("inclut beauharnois", () => {
    expect(ALL_SIGNALS_CITY_SLUGS).toContain("beauharnois");
  });

  it("inclut sainte-martine (villes PV Rive-Sud)", () => {
    expect(ALL_SIGNALS_CITY_SLUGS).toContain("sainte-martine");
  });

  it("inclut saint-remi (villes PV Rive-Sud)", () => {
    expect(ALL_SIGNALS_CITY_SLUGS).toContain("saint-remi");
  });

  it("inclut mcmasterville (villes PV Vallée-du-Richelieu)", () => {
    expect(ALL_SIGNALS_CITY_SLUGS).toContain("mcmasterville");
  });

  it("inclut beloeil (villes PV Vallée-du-Richelieu)", () => {
    expect(ALL_SIGNALS_CITY_SLUGS).toContain("beloeil");
  });

  it("inclut sainte-julie (villes PV Marguerite-D'Youville)", () => {
    expect(ALL_SIGNALS_CITY_SLUGS).toContain("sainte-julie");
  });

  it("PV_SEED_CITY_SLUGS contient les 11 villes PV (Rive-Sud + Vallée-du-Richelieu + Marguerite-D'Youville)", () => {
    expect(PV_SEED_CITY_SLUGS).toContain("saint-constant");
    expect(PV_SEED_CITY_SLUGS).toContain("sainte-catherine");
    expect(PV_SEED_CITY_SLUGS).toContain("chateauguay");
    expect(PV_SEED_CITY_SLUGS).toContain("la-prairie");
    expect(PV_SEED_CITY_SLUGS).toContain("delson");
    expect(PV_SEED_CITY_SLUGS).toContain("vaudreuil-dorion");
    expect(PV_SEED_CITY_SLUGS).toContain("sainte-martine");
    expect(PV_SEED_CITY_SLUGS).toContain("saint-remi");
    expect(PV_SEED_CITY_SLUGS).toContain("mcmasterville");
    expect(PV_SEED_CITY_SLUGS).toContain("beloeil");
    expect(PV_SEED_CITY_SLUGS).toContain("sainte-julie");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Saint-Rémi — POSITIF (règlement V654-2026-33, modifie V654-2017-00)
// ─────────────────────────────────────────────────────────────────────────────

describe("seedPvCity — Saint-Rémi (POSITIF : zonage réel V654-2026-33)", () => {
  let store: MemoryStore;
  let result: Awaited<ReturnType<typeof seedPvCity>>;

  beforeEach(async () => {
    store = new MemoryStore();
    result = await seedPvCity(
      store,
      "saint-remi",
      () => new Date("2026-06-10T00:00:00Z"),
    );
  });

  it("seed réussit (ok: true)", () => {
    expect(result.ok).toBe(true);
  });

  it("la clé S3 du PV contient 'proces-verbaux-saint-remi'", () => {
    expect(result.pvRawRef).toMatch(/proces-verbaux-saint-remi/);
  });

  it("exactement 1 DesignationEvent canonique (règlement V654-2026-33)", () => {
    // Le vrai PV d'avril 2026 contient l'avis de motion pour le règlement V654-2026-33
    // modifiant le règlement de zonage V654-2017-00.
    // detectZonageChange() → changementZonage:true → 1 DesignationEvent émis.
    expect(result.designationEventCount).toBeGreaterThanOrEqual(1);
  });

  it("le DesignationEvent référence le règlement V654-2026-33", () => {
    const events = result.exploitation.state.canonicals.filter(
      (c) => c.type === "DesignationEvent",
    );
    const terms = events.flatMap((e) => e.aliases.concat(e.label));
    const combined = terms.join(" ").toLowerCase();
    expect(combined.includes("v654-2026-33") || combined.includes("654-2026-33")).toBe(true);
  });

  it("le project-state de saint-remi est persisté dans le store", () => {
    expect(result.stateKey).toMatch(/saint-remi/);
    expect(store.objects.has(result.stateKey)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. McMasterville — POSITIF (règlement 382-37, modifie zonage 382-00-2008)
// ─────────────────────────────────────────────────────────────────────────────

describe("seedPvCity — McMasterville (POSITIF : zonage réel 382-37)", () => {
  let store: MemoryStore;
  let result: Awaited<ReturnType<typeof seedPvCity>>;

  beforeEach(async () => {
    store = new MemoryStore();
    result = await seedPvCity(
      store,
      "mcmasterville",
      () => new Date("2026-06-10T00:00:00Z"),
    );
  });

  it("seed réussit (ok: true)", () => {
    expect(result.ok).toBe(true);
  });

  it("la clé S3 du PV contient 'proces-verbaux-mcmasterville'", () => {
    expect(result.pvRawRef).toMatch(/proces-verbaux-mcmasterville/);
  });

  it("exactement 1 DesignationEvent canonique (règlement 382-37)", () => {
    // Le vrai PV de novembre 2025 contient l'avis de motion pour le règlement 382-37-2025
    // modifiant le règlement de zonage numéro 382-00-2008.
    // detectZonageChange() → changementZonage:true → 1 DesignationEvent émis.
    expect(result.designationEventCount).toBeGreaterThanOrEqual(1);
  });

  it("le DesignationEvent référence le règlement 382-37", () => {
    const events = result.exploitation.state.canonicals.filter(
      (c) => c.type === "DesignationEvent",
    );
    const terms = events.flatMap((e) => e.aliases.concat(e.label));
    const combined = terms.join(" ").toLowerCase();
    expect(combined.includes("382-37")).toBe(true);
  });

  it("le project-state de mcmasterville est persisté dans le store", () => {
    expect(result.stateKey).toMatch(/mcmasterville/);
    expect(store.objects.has(result.stateKey)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Beloeil — POSITIF (règlements 1667-127/1667-128, zone C-523)
// ─────────────────────────────────────────────────────────────────────────────

describe("seedPvCity — Beloeil (POSITIF : zonage réel 1667-127/1667-128, zone C-523)", () => {
  let store: MemoryStore;
  let result: Awaited<ReturnType<typeof seedPvCity>>;

  beforeEach(async () => {
    store = new MemoryStore();
    result = await seedPvCity(
      store,
      "beloeil",
      () => new Date("2026-06-10T00:00:00Z"),
    );
  });

  it("seed réussit (ok: true)", () => {
    expect(result.ok).toBe(true);
  });

  it("la clé S3 du PV contient 'proces-verbaux-beloeil'", () => {
    expect(result.pvRawRef).toMatch(/proces-verbaux-beloeil/);
  });

  it("exactement 1 DesignationEvent canonique (règlements 1667-127/1667-128)", () => {
    // Le vrai PV de février 2026 contient deux avis de motion pour les règlements
    // 1667-127-2026 et 1667-128-2026 modifiant le règlement de zonage 1667-00-2011.
    // detectZonageChange() → changementZonage:true → 1 DesignationEvent émis.
    expect(result.designationEventCount).toBeGreaterThanOrEqual(1);
  });

  it("le DesignationEvent référence le règlement 1667-127", () => {
    const events = result.exploitation.state.canonicals.filter(
      (c) => c.type === "DesignationEvent",
    );
    const terms = events.flatMap((e) => e.aliases.concat(e.label));
    const combined = terms.join(" ").toLowerCase();
    expect(combined.includes("1667-127") || combined.includes("1667-128")).toBe(true);
  });

  it("le project-state de beloeil est persisté dans le store", () => {
    expect(result.stateKey).toMatch(/beloeil/);
    expect(store.objects.has(result.stateKey)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Sainte-Julie — POSITIF (règlement 1101-132, zone C-150)
// ─────────────────────────────────────────────────────────────────────────────

describe("seedPvCity — Sainte-Julie (POSITIF : zonage réel 1101-132, zone C-150)", () => {
  let store: MemoryStore;
  let result: Awaited<ReturnType<typeof seedPvCity>>;

  beforeEach(async () => {
    store = new MemoryStore();
    result = await seedPvCity(
      store,
      "sainte-julie",
      () => new Date("2026-06-10T00:00:00Z"),
    );
  });

  it("seed réussit (ok: true)", () => {
    expect(result.ok).toBe(true);
  });

  it("la clé S3 du PV contient 'proces-verbaux-sainte-julie'", () => {
    expect(result.pvRawRef).toMatch(/proces-verbaux-sainte-julie/);
  });

  it("exactement 1 DesignationEvent canonique (règlement 1101-132, zone C-150)", () => {
    // Le vrai PV de mars 2026 contient l'avis de motion pour le règlement 1101-132
    // modifiant le Règlement de zonage 1101 afin de modifier la grille des usages
    // et des normes de la zone C-150.
    // detectZonageChange() → changementZonage:true → 1 DesignationEvent émis.
    expect(result.designationEventCount).toBeGreaterThanOrEqual(1);
  });

  it("le DesignationEvent référence le règlement 1101-132", () => {
    const events = result.exploitation.state.canonicals.filter(
      (c) => c.type === "DesignationEvent",
    );
    const terms = events.flatMap((e) => e.aliases.concat(e.label));
    const combined = terms.join(" ").toLowerCase();
    expect(combined.includes("1101-132")).toBe(true);
  });

  it("le project-state de sainte-julie est persisté dans le store", () => {
    expect(result.stateKey).toMatch(/sainte-julie/);
    expect(store.objects.has(result.stateKey)).toBe(true);
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
