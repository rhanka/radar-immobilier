/**
 * Tests for GET /api/opportunites
 *
 * Verifies:
 *   1. Empty response when no project states exist.
 *   2. Opportunities derived from real DesignationEvent canonicals.
 *   3. Sort order: descending by score.
 *   4. Score factors present and in [0,1].
 *   5. No PII in response.
 *   6. Cities with no project state contribute 0 items.
 *   7. Multi-city: higher-proximity city outranks lower-proximity.
 */

import { describe, expect, it } from "vitest";

import type { ObjectInfo, ObjectStore } from "../storage/object-store.js";
import {
  projectStateKey,
  serializeProjectState,
  type OntologyProjectState,
} from "../services/exploitation/project-state.js";
import { opportunitesRoute, type OpportunitesResponse } from "./opportunites.js";

// ─────────────────────────────────────────────────────────────────────────────
// In-memory store stub
// ─────────────────────────────────────────────────────────────────────────────

class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, Uint8Array>();

  async put(
    key: string,
    body: Uint8Array | Buffer | string,
    _contentType?: string,
  ): Promise<ObjectInfo> {
    const bytes =
      typeof body === "string" ? new TextEncoder().encode(body) : new Uint8Array(body);
    this.objects.set(key, bytes);
    return { key, size: bytes.byteLength };
  }

  async get(key: string): Promise<Uint8Array> {
    const v = this.objects.get(key);
    if (!v) throw new Error(`MemoryStore: missing ${key}`);
    return v;
  }

  async head(key: string): Promise<ObjectInfo | null> {
    const v = this.objects.get(key);
    return v ? { key, size: v.byteLength } : null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

// Use a recent date (30 days ago) to get a high recency score
const RECENT_DATE = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
// Use an old date to get a low recency score
const OLD_DATE = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();

const PV_KEY = "raw/proces-verbaux-sainte-catherine/2026/05/12/pv.txt";

/** Sainte-Catherine (close to MTL, H- zone) — should score high */
const STATE_SAINTE_CATHERINE: OntologyProjectState = {
  schema: "radar_ontology_project_state_v1",
  citySlug: "sainte-catherine",
  profileHash: "a".repeat(64),
  generatedAt: RECENT_DATE,
  rawRefs: [PV_KEY],
  mentions: [
    {
      id: "mention:de:sainte-catherine-H-101",
      type: "DesignationEvent",
      label: "Avis de motion règlement de zonage H-101",
      normalized_terms: ["1001-26"],
      source_refs: [PV_KEY],
      zoneRefs: ["H-101"],
      reglementNumbers: ["1001-26"],
    },
  ],
  candidates: [],
  canonicals: [
    {
      id: "designationevent::sainte-catherine::1001-26",
      type: "DesignationEvent",
      label: "Avis de motion règlement de zonage 1001-26 (zone H-101)",
      aliases: [],
      memberMentionIds: ["mention:de:sainte-catherine-H-101"],
      evidenceRefs: [PV_KEY],
      status: "candidate",
    },
  ],
};

const PV_KEY_VF = "raw/proces-verbaux-salaberry-de-valleyfield/2026/01/01/pv.txt";

/** Salaberry-de-Valleyfield (farther from MTL, commercial zone, old date) — should score lower */
const STATE_VALLEYFIELD_LOW: OntologyProjectState = {
  schema: "radar_ontology_project_state_v1",
  citySlug: "salaberry-de-valleyfield",
  profileHash: "b".repeat(64),
  generatedAt: OLD_DATE,
  rawRefs: [PV_KEY_VF],
  mentions: [
    {
      id: "mention:de:valleyfield-C-1",
      type: "DesignationEvent",
      label: "Avis de motion règlement de zonage C-1",
      normalized_terms: ["2000-26"],
      source_refs: [PV_KEY_VF],
      zoneRefs: ["C-1"],
      reglementNumbers: ["2000-26"],
    },
  ],
  candidates: [],
  canonicals: [
    {
      id: "designationevent::salaberry-de-valleyfield::2000-26",
      type: "DesignationEvent",
      label: "Avis de motion règlement de zonage 2000-26 (zone C-1)",
      aliases: [],
      memberMentionIds: ["mention:de:valleyfield-C-1"],
      evidenceRefs: [PV_KEY_VF],
      status: "candidate",
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function seedState(
  store: MemoryStore,
  state: OntologyProjectState,
): Promise<void> {
  await store.put(
    projectStateKey(state.citySlug),
    serializeProjectState(state),
    "application/json",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/opportunites", () => {
  it("returns ok:true with empty items when no project states exist", async () => {
    const store = new MemoryStore();
    const app = opportunitesRoute({ store });

    const res = await app.request("/api/opportunites");
    expect(res.status).toBe(200);

    const body = (await res.json()) as OpportunitesResponse;
    expect(body.ok).toBe(true);
    expect(body.total).toBe(0);
    expect(body.items).toHaveLength(0);
    expect(body.scoreVersion).toBe("v1");
  });

  it("returns opportunities derived from real DesignationEvent canonicals", async () => {
    const store = new MemoryStore();
    await seedState(store, STATE_SAINTE_CATHERINE);
    const app = opportunitesRoute({ store });

    const res = await app.request("/api/opportunites");
    const body = (await res.json()) as OpportunitesResponse;

    expect(body.ok).toBe(true);
    expect(body.total).toBe(1);
    expect(body.items).toHaveLength(1);

    const item = body.items[0]!;
    expect(item.citySlug).toBe("sainte-catherine");
    expect(item.reglementNumbers).toContain("1001-26");
    expect(item.zoneRefs).toContain("H-101");
    expect(typeof item.score).toBe("number");
    expect(item.score).toBeGreaterThan(0);
    expect(item.score).toBeLessThanOrEqual(100);
  });

  it("items are sorted by score descending", async () => {
    const store = new MemoryStore();
    // Seed: close city with residential zone (high score) + far city with old date (low score)
    await seedState(store, STATE_SAINTE_CATHERINE);
    await seedState(store, STATE_VALLEYFIELD_LOW);
    const app = opportunitesRoute({ store });

    const res = await app.request("/api/opportunites");
    const body = (await res.json()) as OpportunitesResponse;

    expect(body.items.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < body.items.length - 1; i++) {
      expect(body.items[i]!.score).toBeGreaterThanOrEqual(body.items[i + 1]!.score);
    }
  });

  it("sainte-catherine (close, H-zone, recent) outranks valleyfield (far, C-zone, old)", async () => {
    const store = new MemoryStore();
    await seedState(store, STATE_SAINTE_CATHERINE);
    await seedState(store, STATE_VALLEYFIELD_LOW);
    const app = opportunitesRoute({ store });

    const res = await app.request("/api/opportunites");
    const body = (await res.json()) as OpportunitesResponse;

    const catItem = body.items.find((i) => i.citySlug === "sainte-catherine")!;
    const vfItem = body.items.find((i) => i.citySlug === "salaberry-de-valleyfield")!;
    expect(catItem).toBeDefined();
    expect(vfItem).toBeDefined();
    expect(catItem.score).toBeGreaterThan(vfItem.score);
  });

  it("facteurs are present and each in [0,1]", async () => {
    const store = new MemoryStore();
    await seedState(store, STATE_SAINTE_CATHERINE);
    const app = opportunitesRoute({ store });

    const res = await app.request("/api/opportunites");
    const body = (await res.json()) as OpportunitesResponse;

    for (const item of body.items) {
      expect(item.facteurs).toBeDefined();
      expect(item.facteurs.proximite).toBeGreaterThanOrEqual(0);
      expect(item.facteurs.proximite).toBeLessThanOrEqual(1);
      expect(item.facteurs.zoneType).toBeGreaterThanOrEqual(0);
      expect(item.facteurs.zoneType).toBeLessThanOrEqual(1);
      expect(item.facteurs.recence).toBeGreaterThanOrEqual(0);
      expect(item.facteurs.recence).toBeLessThanOrEqual(1);
    }
  });

  it("no PII in any response field", async () => {
    const store = new MemoryStore();
    await seedState(store, STATE_SAINTE_CATHERINE);
    const app = opportunitesRoute({ store });

    const res = await app.request("/api/opportunites");
    const body = (await res.json()) as OpportunitesResponse;
    const serialized = JSON.stringify(body);

    // No owner / address / email fields
    expect(serialized).not.toMatch(/\bowner\b/i);
    expect(serialized).not.toMatch(/\baddress\b/i);
    expect(serialized).not.toMatch(/\bemail\b/i);
    // sourceRef must be an S3 key path (raw/...) not a personal identifier
    for (const item of body.items) {
      if (item.sourceRef) {
        expect(item.sourceRef).toMatch(/^raw\//);
      }
    }
  });

  it("cities with no project state contribute 0 items", async () => {
    const store = new MemoryStore(); // no states seeded
    const app = opportunitesRoute({ store });

    const res = await app.request("/api/opportunites");
    const body = (await res.json()) as OpportunitesResponse;

    expect(body.items).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it("only DesignationEvent canonicals are included (not Bylaw/Source)", async () => {
    // State with a mix: 1 DesignationEvent + 1 Bylaw
    const stateWithMix: OntologyProjectState = {
      ...STATE_SAINTE_CATHERINE,
      canonicals: [
        ...STATE_SAINTE_CATHERINE.canonicals,
        {
          id: "bylaw::sainte-catherine::999",
          type: "Bylaw",
          label: "Règlement 999",
          aliases: [],
          memberMentionIds: [],
          evidenceRefs: [PV_KEY],
          status: "candidate",
        },
      ],
    };
    const store = new MemoryStore();
    await seedState(store, stateWithMix);
    const app = opportunitesRoute({ store });

    const res = await app.request("/api/opportunites");
    const body = (await res.json()) as OpportunitesResponse;

    // Only the 1 DesignationEvent should appear
    expect(body.total).toBe(1);
    expect(body.items).toHaveLength(1);
  });
});
