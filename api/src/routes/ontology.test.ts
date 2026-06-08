import { describe, expect, it } from "vitest";

import type { ObjectInfo, ObjectStore } from "../storage/object-store.js";
import {
  projectStateKey,
  serializeProjectState,
  type OntologyProjectState,
} from "../services/exploitation/project-state.js";
import { ontologyRoute } from "./ontology.js";

const CITY = "salaberry-de-valleyfield";

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
    if (!v) throw new Error(`missing ${key}`);
    return v;
  }
  async head(key: string): Promise<ObjectInfo | null> {
    const v = this.objects.get(key);
    return v ? { key, size: v.byteLength } : null;
  }
}

const SAMPLE_STATE: OntologyProjectState = {
  schema: "radar_ontology_project_state_v1",
  citySlug: CITY,
  profileHash: "a".repeat(64),
  generatedAt: "2026-06-08T00:00:00.000Z",
  rawRefs: ["raw/role-evaluation-mamh/2026/01/01/cafe.xml"],
  mentions: [
    {
      id: "mention:lot:4193751",
      type: "Lot",
      label: "Lot 4193751",
      normalized_terms: ["4193751"],
      source_refs: ["raw/role-evaluation-mamh/2026/01/01/cafe.xml"],
    },
  ],
  candidates: [],
  canonicals: [
    {
      id: "lot::salaberry-de-valleyfield::4193751",
      type: "Lot",
      label: "Lot 4193751",
      aliases: [],
      memberMentionIds: ["mention:lot:4193751"],
      evidenceRefs: ["raw/role-evaluation-mamh/2026/01/01/cafe.xml"],
      status: "candidate",
    },
  ],
};

async function seedState(store: MemoryStore): Promise<void> {
  await store.put(
    projectStateKey(CITY),
    serializeProjectState(SAMPLE_STATE),
    "application/json",
  );
}

describe("GET /api/ontology/:city/* (read project state)", () => {
  it("404s when no project state exists for the city", async () => {
    const store = new MemoryStore();
    const app = ontologyRoute({ store });
    const res = await app.request(`/api/ontology/${CITY}/entities`);
    expect(res.status).toBe(404);
  });

  it("serves entities (canonicals) from the persisted state", async () => {
    const store = new MemoryStore();
    await seedState(store);
    const app = ontologyRoute({ store });
    const res = await app.request(`/api/ontology/${CITY}/entities`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      citySlug: string;
      profileHash: string;
      entities: { id: string; type: string }[];
    };
    expect(body.citySlug).toBe(CITY);
    expect(body.profileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(body.entities).toHaveLength(1);
    expect(body.entities[0]!.type).toBe("Lot");
  });

  it("serves mentions and candidates", async () => {
    const store = new MemoryStore();
    await seedState(store);
    const app = ontologyRoute({ store });

    const mres = await app.request(`/api/ontology/${CITY}/mentions`);
    expect(mres.status).toBe(200);
    const mbody = (await mres.json()) as { mentions: unknown[] };
    expect(mbody.mentions).toHaveLength(1);

    const cres = await app.request(`/api/ontology/${CITY}/candidates`);
    expect(cres.status).toBe(200);
    const cbody = (await cres.json()) as { candidates: unknown[] };
    expect(Array.isArray(cbody.candidates)).toBe(true);
  });
});
