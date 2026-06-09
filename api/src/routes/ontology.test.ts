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

/**
 * WRITE-CORE route — POST /api/ontology/:city/patch. Token-gated (401 without a
 * valid `x-radar-write-token`); a valid op is persisted to the append-only patch
 * log and re-applied, returning the updated read-model. Anti-invention: an op
 * naming an unknown id is rejected; an illegal status transition is rejected.
 */
const TOKEN = "test-write-token";

/** A two-mention state where the two Lots share a NO_LOT (auto entity_match). */
const RECONCILABLE_STATE: OntologyProjectState = {
  schema: "radar_ontology_project_state_v1",
  citySlug: CITY,
  profileHash: "a".repeat(64),
  generatedAt: "2026-06-08T00:00:00.000Z",
  rawRefs: [
    "raw/role-evaluation-mamh/2026/01/01/a.xml",
    "raw/avis-publics-valleyfield/2026/05/20/b.html",
  ],
  mentions: [
    {
      id: "mention:lot:4193751",
      type: "Lot",
      label: "Lot 4193751",
      normalized_terms: ["4193751"],
      source_refs: ["raw/role-evaluation-mamh/2026/01/01/a.xml"],
    },
    {
      id: "mention:lot:4193751-avis",
      type: "Lot",
      label: "Lot 4193751",
      normalized_terms: ["4193751"],
      source_refs: ["raw/avis-publics-valleyfield/2026/05/20/b.html"],
    },
  ],
  candidates: [],
  canonicals: [],
};

async function seedReconcilable(store: MemoryStore): Promise<void> {
  await store.put(
    projectStateKey(CITY),
    serializeProjectState(RECONCILABLE_STATE),
    "application/json",
  );
}

describe("POST /api/ontology/:city/patch (write-core, token-gated)", () => {
  it("401s when no token is provided", async () => {
    const store = new MemoryStore();
    await seedReconcilable(store);
    const app = ontologyRoute({ store, ontologyWriteToken: TOKEN });
    const res = await app.request(`/api/ontology/${CITY}/patch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        op: "reject_match",
        aId: "mention:lot:4193751",
        bId: "mention:lot:4193751-avis",
      }),
    });
    expect(res.status).toBe(401);
  });

  it("401s on a token mismatch", async () => {
    const store = new MemoryStore();
    await seedReconcilable(store);
    const app = ontologyRoute({ store, ontologyWriteToken: TOKEN });
    const res = await app.request(`/api/ontology/${CITY}/patch`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-radar-write-token": "wrong" },
      body: JSON.stringify({
        op: "reject_match",
        aId: "mention:lot:4193751",
        bId: "mention:lot:4193751-avis",
      }),
    });
    expect(res.status).toBe(401);
  });

  it("401s when no write token is configured (fail-closed)", async () => {
    const store = new MemoryStore();
    await seedReconcilable(store);
    const app = ontologyRoute({ store });
    const res = await app.request(`/api/ontology/${CITY}/patch`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-radar-write-token": TOKEN },
      body: JSON.stringify({
        op: "reject_match",
        aId: "mention:lot:4193751",
        bId: "mention:lot:4193751-avis",
      }),
    });
    expect(res.status).toBe(401);
  });

  it("happy path: reject_match suppresses the auto-candidate union", async () => {
    const store = new MemoryStore();
    await seedReconcilable(store);
    const app = ontologyRoute({ store, ontologyWriteToken: TOKEN });

    // Baseline: the two lots auto-reconcile into ONE canonical.
    const before = await deriveAppliedEntities(app);
    expect(before.filter((e) => e.type === "Lot")).toHaveLength(1);

    const res = await app.request(`/api/ontology/${CITY}/patch`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-radar-write-token": TOKEN },
      body: JSON.stringify({
        op: "reject_match",
        aId: "mention:lot:4193751",
        bId: "mention:lot:4193751-avis",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      entities: { id: string; type: string }[];
      candidates: unknown[];
    };
    expect(body.ok).toBe(true);
    // After the reject, the lots split into TWO canonicals and the candidate drops.
    expect(body.entities.filter((e) => e.type === "Lot")).toHaveLength(2);
    expect(body.candidates).toHaveLength(0);

    // The decision is persisted (a re-fetch re-applies it).
    const after = await deriveAppliedEntities(app);
    expect(after.filter((e) => e.type === "Lot")).toHaveLength(2);
  });

  it("happy path: accept_match drops the candidate from the queue", async () => {
    const store = new MemoryStore();
    await seedReconcilable(store);
    const app = ontologyRoute({ store, ontologyWriteToken: TOKEN });

    // Baseline: one auto entity_match candidate is pending for the shared NO_LOT.
    const beforeRes = await app.request(`/api/ontology/${CITY}/candidates`);
    const before = (await beforeRes.json()) as { candidates: unknown[] };
    expect(before.candidates).toHaveLength(1);

    const res = await app.request(`/api/ontology/${CITY}/patch`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-radar-write-token": TOKEN },
      body: JSON.stringify({
        op: "accept_match",
        aId: "mention:lot:4193751",
        bId: "mention:lot:4193751-avis",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      entities: { id: string; type: string }[];
      candidates: unknown[];
    };
    expect(body.ok).toBe(true);
    // The accepted pair LEAVES the queue, and the two lots stay one canonical.
    expect(body.candidates).toHaveLength(0);
    expect(body.entities.filter((e) => e.type === "Lot")).toHaveLength(1);

    // The decision persists: a re-fetch still shows an empty candidate queue.
    const afterRes = await app.request(`/api/ontology/${CITY}/candidates`);
    const after = (await afterRes.json()) as { candidates: unknown[] };
    expect(after.candidates).toHaveLength(0);
  });

  it("happy path: set_status candidate→validated overrides a canonical status", async () => {
    const store = new MemoryStore();
    await seedReconcilable(store);
    const app = ontologyRoute({ store, ontologyWriteToken: TOKEN });
    const entities = await deriveAppliedEntities(app);
    const lot = entities.find((e) => e.type === "Lot")!;

    const res = await app.request(`/api/ontology/${CITY}/patch`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-radar-write-token": TOKEN },
      body: JSON.stringify({
        op: "set_status",
        canonicalId: lot.id,
        from: lot.status,
        to: "validated",
      }),
    });
    // The two-source lot is already validated; candidate→validated is legal and
    // idempotent here — the route accepts it (200) and returns it validated.
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entities: { id: string; status: string }[];
    };
    expect(body.entities.find((e) => e.id === lot.id)!.status).toBe("validated");
  });

  it("422s on an op referencing an unknown id (anti-invention)", async () => {
    const store = new MemoryStore();
    await seedReconcilable(store);
    const app = ontologyRoute({ store, ontologyWriteToken: TOKEN });
    const res = await app.request(`/api/ontology/${CITY}/patch`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-radar-write-token": TOKEN },
      body: JSON.stringify({
        op: "accept_match",
        aId: "mention:lot:4193751",
        bId: "mention:lot:does-not-exist",
      }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unknown-id");
  });

  it("422s on an illegal status transition (D3 gate)", async () => {
    const store = new MemoryStore();
    await seedReconcilable(store);
    const app = ontologyRoute({ store, ontologyWriteToken: TOKEN });
    const lot = (await deriveAppliedEntities(app)).find((e) => e.type === "Lot")!;
    // validated→candidate is NOT in hardening.status_transitions.
    const res = await app.request(`/api/ontology/${CITY}/patch`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-radar-write-token": TOKEN },
      body: JSON.stringify({
        op: "set_status",
        canonicalId: lot.id,
        from: "validated",
        to: "candidate",
      }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid-status-transition");
  });

  it("400s on a malformed patch op", async () => {
    const store = new MemoryStore();
    await seedReconcilable(store);
    const app = ontologyRoute({ store, ontologyWriteToken: TOKEN });
    const res = await app.request(`/api/ontology/${CITY}/patch`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-radar-write-token": TOKEN },
      body: JSON.stringify({ op: "nonsense" }),
    });
    expect(res.status).toBe(400);
  });

  it("404s when the city has no project state", async () => {
    const store = new MemoryStore();
    const app = ontologyRoute({ store, ontologyWriteToken: TOKEN });
    const res = await app.request(`/api/ontology/${CITY}/patch`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-radar-write-token": TOKEN },
      body: JSON.stringify({
        op: "reject_match",
        aId: "mention:lot:4193751",
        bId: "mention:lot:4193751-avis",
      }),
    });
    expect(res.status).toBe(404);
  });
});

/** Fetch the current applied entities via the read endpoint (re-applies decisions). */
async function deriveAppliedEntities(
  app: ReturnType<typeof ontologyRoute>,
): Promise<{ id: string; type: string; status: string }[]> {
  const res = await app.request(`/api/ontology/${CITY}/entities`);
  const body = (await res.json()) as {
    entities: { id: string; type: string; status: string }[];
  };
  return body.entities;
}
