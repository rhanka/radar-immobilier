/**
 * Tests for GET /api/signals/:city/detail
 *
 * Verifies:
 *   1. Events shape for a city with real DesignationEvent canonicals.
 *   2. Empty events list for a city without a project state.
 *   3. Empty events list for a city with no DesignationEvent canonicals.
 *   4. Règlement numbers extracted from member mention normalized_terms.
 *   5. Zone codes extracted from canonical label (e.g. H-431).
 *   6. No PII in any response field.
 */

import { describe, expect, it } from "vitest";

import type { ObjectInfo, ObjectStore } from "../storage/object-store.js";
import {
  projectStateKey,
  serializeProjectState,
  type OntologyProjectState,
} from "../services/exploitation/project-state.js";
import { signalsDetailRoute, type SignalDetailResponse } from "./signals-detail.js";

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

const CITY = "saint-constant";
const GENERATED_AT = "2026-05-19T12:00:00.000Z";
const PV_RAW_REF =
  "raw/proces-verbaux-saint-constant/2026/05/19/abc123.txt";

/** Minimal project state with one real DesignationEvent (règlements 1926-26/1927-26, zone H-431). */
const STATE_WITH_DESIGNATION_EVENT: OntologyProjectState = {
  schema: "radar_ontology_project_state_v1",
  citySlug: CITY,
  profileHash: "a".repeat(64),
  generatedAt: GENERATED_AT,
  rawRefs: [PV_RAW_REF],
  mentions: [
    {
      id: "mention:source:proc-verbaux-saint-constant-2026-05-19",
      type: "Source",
      label: PV_RAW_REF,
      normalized_terms: [PV_RAW_REF],
      source_refs: [PV_RAW_REF],
    },
    {
      id: "mention:bylaw:saint-constant-1926-26",
      type: "Bylaw",
      label: "Règlement 1926-26",
      normalized_terms: ["1926-26"],
      source_refs: [PV_RAW_REF],
    },
    {
      id: "mention:bylaw:saint-constant-1927-26",
      type: "Bylaw",
      label: "Règlement 1927-26",
      normalized_terms: ["1927-26"],
      source_refs: [PV_RAW_REF],
    },
    {
      id: "mention:designationevent:saint-constant-1926-26+1927-26",
      type: "DesignationEvent",
      label: "Avis de motion règlement de zonage 1926-26+1927-26",
      normalized_terms: ["1926-26", "1927-26"],
      source_refs: [PV_RAW_REF],
      zoneRefs: ["H-431"],
    },
  ],
  candidates: [],
  canonicals: [
    {
      id: "designationevent::saint-constant::1926-26",
      type: "DesignationEvent",
      // Label mentions zone H-431 (from the real PV text).
      label:
        "Avis de motion règlement de zonage 1926-26+1927-26 (zone H-431)",
      aliases: [],
      memberMentionIds: [
        "mention:designationevent:saint-constant-1926-26+1927-26",
      ],
      evidenceRefs: [PV_RAW_REF],
      status: "candidate",
    },
    {
      id: "bylaw::saint-constant::1926-26",
      type: "Bylaw",
      label: "Règlement 1926-26",
      aliases: [],
      memberMentionIds: ["mention:bylaw:saint-constant-1926-26"],
      evidenceRefs: [PV_RAW_REF],
      status: "candidate",
    },
  ],
};

/**
 * Châteauguay fixture: DesignationEvent with letter-prefix règlement Z-3001
 * and real zone codes C-754, C-810, H-812.
 *
 * Tests the fix for data pollution: Z-3001 must appear in reglementNumbers,
 * NOT in zoneRefs.  zoneRefs must be [C-754, C-810, H-812] only.
 */
const CHATEAUGUAY_PV_RAW_REF =
  "raw/proces-verbaux-chateauguay/2026/02/23/pv2026-02-23.txt";
const STATE_CHATEAUGUAY: OntologyProjectState = {
  schema: "radar_ontology_project_state_v1",
  citySlug: "chateauguay",
  profileHash: "d".repeat(64),
  generatedAt: GENERATED_AT,
  rawRefs: [CHATEAUGUAY_PV_RAW_REF],
  mentions: [
    {
      id: "mention:designationevent:chateauguay-Z-3001",
      type: "DesignationEvent",
      label:
        "Avis de motion règlement de zonage Z-3001 visant à permettre les bâtiments de 4 étages dans la zone C-754",
      // norm() lowercases terms in the real pipeline; use the realistic form so
      // the case-insensitive extraction is actually exercised (z-3001 → Z-3001).
      normalized_terms: ["z-3001"],
      source_refs: [CHATEAUGUAY_PV_RAW_REF],
      zoneRefs: ["C-754", "C-810", "H-812"],
    },
  ],
  candidates: [],
  canonicals: [
    {
      id: "designationevent::chateauguay::Z-3001",
      type: "DesignationEvent",
      label:
        "Avis de motion règlement de zonage Z-3001 visant à permettre les bâtiments de 4 étages dans la zone C-754",
      aliases: [],
      memberMentionIds: ["mention:designationevent:chateauguay-Z-3001"],
      evidenceRefs: [CHATEAUGUAY_PV_RAW_REF],
      status: "candidate",
    },
  ],
};

/** Project state with no DesignationEvent canonicals (only Bylaw/Source). */
const STATE_NO_DESIGNATION_EVENTS: OntologyProjectState = {
  schema: "radar_ontology_project_state_v1",
  citySlug: "sainte-catherine",
  profileHash: "b".repeat(64),
  generatedAt: GENERATED_AT,
  rawRefs: ["raw/proces-verbaux-sainte-catherine/2026/05/12/def456.txt"],
  mentions: [],
  candidates: [],
  canonicals: [
    {
      id: "bylaw::sainte-catherine::158",
      type: "Bylaw",
      label: "Règlement 158",
      aliases: [],
      memberMentionIds: [],
      evidenceRefs: [
        "raw/proces-verbaux-sainte-catherine/2026/05/12/def456.txt",
      ],
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

describe("GET /api/signals/:city/detail", () => {
  it("returns events list with correct shape for a city with DesignationEvents", async () => {
    const store = new MemoryStore();
    await seedState(store, STATE_WITH_DESIGNATION_EVENT);
    const app = signalsDetailRoute({ store });

    const res = await app.request(`/api/signals/${CITY}/detail`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as SignalDetailResponse;
    expect(body.ok).toBe(true);
    expect(body.citySlug).toBe(CITY);
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events).toHaveLength(1);

    const event = body.events[0]!;
    expect(event.label).toContain("1926-26");
    expect(typeof event.label).toBe("string");
    expect(typeof event.sourceRef).toBe("string");
    expect(typeof event.dateObserved).toBe("string");
    expect(Array.isArray(event.reglementNumbers)).toBe(true);
    expect(Array.isArray(event.zoneRefs)).toBe(true);
  });

  it("extracts règlement numbers from member mention normalized_terms", async () => {
    const store = new MemoryStore();
    await seedState(store, STATE_WITH_DESIGNATION_EVENT);
    const app = signalsDetailRoute({ store });

    const res = await app.request(`/api/signals/${CITY}/detail`);
    const body = (await res.json()) as SignalDetailResponse;
    const event = body.events[0]!;

    // Both 1926-26 and 1927-26 are in the DesignationEvent mention's normalized_terms.
    expect(event.reglementNumbers).toContain("1926-26");
    expect(event.reglementNumbers).toContain("1927-26");
  });

  it("extracts zone codes from canonical label (e.g. H-431)", async () => {
    const store = new MemoryStore();
    await seedState(store, STATE_WITH_DESIGNATION_EVENT);
    const app = signalsDetailRoute({ store });

    const res = await app.request(`/api/signals/${CITY}/detail`);
    const body = (await res.json()) as SignalDetailResponse;
    const event = body.events[0]!;

    // The canonical label contains "zone H-431".
    expect(event.zoneRefs).toContain("H-431");
  });

  it("carries the S3 evidence ref as sourceRef (no PII)", async () => {
    const store = new MemoryStore();
    await seedState(store, STATE_WITH_DESIGNATION_EVENT);
    const app = signalsDetailRoute({ store });

    const res = await app.request(`/api/signals/${CITY}/detail`);
    const body = (await res.json()) as SignalDetailResponse;
    const event = body.events[0]!;

    expect(event.sourceRef).toBe(PV_RAW_REF);
    // No PII: sourceRef is an S3 key (raw/…), not an owner name/address.
    expect(event.sourceRef).toMatch(/^raw\//);
  });

  it("returns events=[] when city has no project state", async () => {
    const store = new MemoryStore(); // empty
    const app = signalsDetailRoute({ store });

    const res = await app.request("/api/signals/unknown-city/detail");
    expect(res.status).toBe(200);

    const body = (await res.json()) as SignalDetailResponse;
    expect(body.ok).toBe(true);
    expect(body.citySlug).toBe("unknown-city");
    expect(body.events).toHaveLength(0);
  });

  it("returns events=[] for city with no DesignationEvent canonicals", async () => {
    const store = new MemoryStore();
    await seedState(store, STATE_NO_DESIGNATION_EVENTS);
    const app = signalsDetailRoute({ store });

    const res = await app.request("/api/signals/sainte-catherine/detail");
    expect(res.status).toBe(200);

    const body = (await res.json()) as SignalDetailResponse;
    expect(body.ok).toBe(true);
    expect(body.events).toHaveLength(0);
  });

  it("dateObserved matches the project state generatedAt", async () => {
    const store = new MemoryStore();
    await seedState(store, STATE_WITH_DESIGNATION_EVENT);
    const app = signalsDetailRoute({ store });

    const res = await app.request(`/api/signals/${CITY}/detail`);
    const body = (await res.json()) as SignalDetailResponse;
    const event = body.events[0]!;

    expect(event.dateObserved).toBe(GENERATED_AT);
  });

  it("reads zoneRefs from member mention zoneRefs field (primary path, not label scan)", async () => {
    // State where the canonical label has NO zone code in it, but the member
    // mention carries zoneRefs: ["H-431"] — verifies the mention-based path.
    const stateMentionOnlyZone: OntologyProjectState = {
      schema: "radar_ontology_project_state_v1",
      citySlug: CITY,
      profileHash: "c".repeat(64),
      generatedAt: GENERATED_AT,
      rawRefs: [PV_RAW_REF],
      mentions: [
        {
          id: "mention:designationevent:saint-constant-1926-26+1927-26",
          type: "DesignationEvent",
          label: "Avis de motion règlement de zonage 1926-26+1927-26",
          normalized_terms: ["1926-26", "1927-26"],
          source_refs: [PV_RAW_REF],
          zoneRefs: ["H-431"],
        },
      ],
      candidates: [],
      canonicals: [
        {
          id: "designationevent::saint-constant::1926-26",
          type: "DesignationEvent",
          // Label deliberately has NO zone code — tests the mention-based path.
          label: "Avis de motion règlement de zonage 1926-26+1927-26",
          aliases: [],
          memberMentionIds: [
            "mention:designationevent:saint-constant-1926-26+1927-26",
          ],
          evidenceRefs: [PV_RAW_REF],
          status: "candidate",
        },
      ],
    };
    const store = new MemoryStore();
    await seedState(store, stateMentionOnlyZone);
    const app = signalsDetailRoute({ store });

    const res = await app.request(`/api/signals/${CITY}/detail`);
    const body = (await res.json()) as SignalDetailResponse;
    const event = body.events[0]!;

    // zoneRefs must come from the mention field, not from label scanning.
    expect(event.zoneRefs).toContain("H-431");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Châteauguay — correction pollution données Z-3001 / zoneRefs
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/signals/chateauguay/detail — séparation règlement Z-3001 des zones (fix pollution)", () => {
  it("reglementNumbers contient Z-3001 (lettre-préfixe, normalized_terms)", async () => {
    const store = new MemoryStore();
    await seedState(store, STATE_CHATEAUGUAY);
    const app = signalsDetailRoute({ store });

    const res = await app.request("/api/signals/chateauguay/detail");
    const body = (await res.json()) as SignalDetailResponse;
    const event = body.events[0]!;

    // Z-3001 is in normalized_terms and matches the letter-prefix règlement pattern.
    expect(event.reglementNumbers).toContain("Z-3001");
  });

  it("zoneRefs = [C-754, C-810, H-812] sans Z-3001 (mention zoneRefs, pas label scan)", async () => {
    const store = new MemoryStore();
    await seedState(store, STATE_CHATEAUGUAY);
    const app = signalsDetailRoute({ store });

    const res = await app.request("/api/signals/chateauguay/detail");
    const body = (await res.json()) as SignalDetailResponse;
    const event = body.events[0]!;

    // Pass 1 (mention zoneRefs) carries the real zone codes; Z-3001 must NOT appear.
    expect(event.zoneRefs).toContain("C-754");
    expect(event.zoneRefs).toContain("C-810");
    expect(event.zoneRefs).toContain("H-812");
    expect(event.zoneRefs).not.toContain("Z-3001");
    expect(event.zoneRefs).not.toContain("Z-3300");
  });

  it("non-régression Saint-Constant: reglementNumbers=[1926-26, 1927-26], zoneRefs=[H-431]", async () => {
    const store = new MemoryStore();
    await seedState(store, STATE_WITH_DESIGNATION_EVENT);
    const app = signalsDetailRoute({ store });

    const res = await app.request(`/api/signals/${CITY}/detail`);
    const body = (await res.json()) as SignalDetailResponse;
    const event = body.events[0]!;

    expect(event.reglementNumbers).toContain("1926-26");
    expect(event.reglementNumbers).toContain("1927-26");
    expect(event.zoneRefs).toContain("H-431");
    // Digit-prefix règlement numbers must NOT appear in zoneRefs.
    expect(event.zoneRefs).not.toContain("1926-26");
    expect(event.zoneRefs).not.toContain("1927-26");
  });
});
