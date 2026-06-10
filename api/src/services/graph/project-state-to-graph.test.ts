/**
 * WP A.3.1 — projectStateToGraph unit tests.
 *
 * Test tiers:
 *  1. PURE (always run): converter on a minimal hand-crafted state fixture.
 *  2. REAL VF SEED (always run, no network): converter on the real Valleyfield
 *     project state produced by `seedCityOntology` with the committed bytes.
 *  3. DB-BOUND (gated on GRAPH_DB_TESTS=1): upsertGraph idempotency with
 *     the converter output.
 */

import { describe, expect, it } from "vitest";

import type { ObjectInfo, ObjectStore } from "../../storage/object-store.js";
import { projectStateToGraph } from "./project-state-to-graph.js";
import type { OntologyProjectState } from "../exploitation/project-state.js";
import type { CanonicalEntity } from "../exploitation/reconcile.js";
import type { MentionNode } from "../exploitation/mentions.js";
import { upsertGraph } from "./graph-store.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers / fixtures
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal in-memory ObjectStore (no MinIO) for seed tests. */
class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, Uint8Array>();
  async put(key: string, body: Uint8Array | Buffer | string, _ct?: string): Promise<ObjectInfo> {
    const bytes = typeof body === "string" ? new TextEncoder().encode(body) : new Uint8Array(body);
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

const FIXED = () => new Date("2026-06-08T00:00:00.000Z");

/** Build a minimal CanonicalEntity for use in fixtures. */
function makeCanonical(
  id: string,
  type: string,
  label: string,
  opts: Partial<CanonicalEntity> = {},
): CanonicalEntity {
  return {
    id,
    type,
    label,
    aliases: [],
    memberMentionIds: [id],
    evidenceRefs: [],
    status: "candidate",
    ...opts,
  };
}

/** Build a minimal MentionNode for use in fixtures. */
function makeMention(id: string, type: string, label: string, sourceRefs: string[] = []): MentionNode {
  return { id, type, label, normalized_terms: [label.toLowerCase()], source_refs: sourceRefs };
}

/** Build a minimal OntologyProjectState. */
function makeState(
  canonicals: CanonicalEntity[],
  mentions: MentionNode[],
  candidates: OntologyProjectState["candidates"] = [],
): OntologyProjectState {
  return {
    schema: "radar_ontology_project_state_v1",
    citySlug: "test-city",
    profileHash: "abc123",
    generatedAt: "2026-06-08T00:00:00.000Z",
    rawRefs: [],
    mentions,
    candidates,
    canonicals,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Pure tests — always run
// ─────────────────────────────────────────────────────────────────────────────

describe("projectStateToGraph — pure converter", () => {
  it("empty state produces empty graph", () => {
    const g = projectStateToGraph(makeState([], []));
    expect(g.nodes).toHaveLength(0);
    expect(g.links).toHaveLength(0);
  });

  it("single canonical → one node, no edges", () => {
    const c = makeCanonical("lot::city::4193751", "Lot", "Lot 4193751", {
      memberMentionIds: ["mention:lot:4193751"],
      evidenceRefs: ["raw/role/lot.xml"],
    });
    const m = makeMention("mention:lot:4193751", "Lot", "Lot 4193751", ["raw/role/lot.xml"]);
    const g = projectStateToGraph(makeState([c], [m]));
    expect(g.nodes).toHaveLength(1);
    expect(g.nodes[0]!.id).toBe("lot::city::4193751");
    expect(g.nodes[0]!.file_type).toBe("lot");
    expect(g.links).toHaveLength(0);
  });

  it("two canonicals sharing no evidence → no concerns edge", () => {
    const bylaw = makeCanonical("bylaw::city::150-51", "Bylaw", "Règlement 150-51", {
      memberMentionIds: ["mention:bylaw:150-51"],
      evidenceRefs: ["raw/regl/150-51.txt"],
    });
    const ev = makeCanonical("designationevent::city::event-a", "DesignationEvent", "Event A", {
      memberMentionIds: ["mention:de:event-a"],
      evidenceRefs: ["raw/avis/avis.html"],
    });
    const g = projectStateToGraph(makeState([bylaw, ev], [
      makeMention("mention:bylaw:150-51", "Bylaw", "Règlement 150-51", ["raw/regl/150-51.txt"]),
      makeMention("mention:de:event-a", "DesignationEvent", "Event A", ["raw/avis/avis.html"]),
    ]));
    // 2 canonical nodes only — no concerns because evidenceRefs don't overlap.
    expect(g.nodes).toHaveLength(2);
    const concerns = g.links?.filter((l) => l.relation === "concerns");
    expect(concerns).toHaveLength(0);
  });

  it("DesignationEvent + Bylaw sharing an evidence ref → concerns edge", () => {
    const SHARED_REF = "raw/avis/avis.html";
    const bylaw = makeCanonical("bylaw::city::209-47", "Bylaw", "Règlement 209-47", {
      memberMentionIds: ["mention:bylaw:209-47"],
      evidenceRefs: [SHARED_REF],
    });
    const ev = makeCanonical("designationevent::city::event-b", "DesignationEvent", "Dérogation 2026", {
      memberMentionIds: ["mention:de:event-b"],
      evidenceRefs: [SHARED_REF],
    });
    const g = projectStateToGraph(makeState([bylaw, ev], [
      makeMention("mention:bylaw:209-47", "Bylaw", "Règlement 209-47", [SHARED_REF]),
      makeMention("mention:de:event-b", "DesignationEvent", "Dérogation 2026", [SHARED_REF]),
    ]));
    const concerns = g.links?.filter((l) => l.relation === "concerns") ?? [];
    expect(concerns).toHaveLength(1);
    expect(concerns[0]!.source).toBe("designationevent::city::event-b");
    expect(concerns[0]!.target).toBe("bylaw::city::209-47");
  });

  it("multi-member canonical → reconciled_as edges from orphan mentions", () => {
    // Two mentions collapsed into one canonical (reconciled across sources).
    const REF_A = "raw/role/lots.xml";
    const REF_B = "raw/avis/avis.html";
    const canonical = makeCanonical("lot::city::4193751", "Lot", "Lot 4193751", {
      memberMentionIds: ["mention:lot:4193751-a", "mention:lot:4193751-b"],
      evidenceRefs: [REF_A, REF_B],
      status: "validated",
    });
    // Mentions are canonical members → they ARE excluded as orphan nodes.
    const mentionA = makeMention("mention:lot:4193751-a", "Lot", "Lot 4193751", [REF_A]);
    const mentionB = makeMention("mention:lot:4193751-b", "Lot", "lot 4193751", [REF_B]);
    const g = projectStateToGraph(makeState([canonical], [mentionA, mentionB]));

    // canonical node IS present
    const nodeIds = g.nodes.map((n) => n.id);
    expect(nodeIds).toContain("lot::city::4193751");
    // member mention nodes ARE emitted for multi-member canonicals
    // so that reconciled_as edges have valid endpoints
    expect(nodeIds).toContain("mention:lot:4193751-a");
    expect(nodeIds).toContain("mention:lot:4193751-b");

    // reconciled_as edges for each member mention → canonical
    const reconEdges = g.links?.filter((l) => l.relation === "reconciled_as") ?? [];
    expect(reconEdges).toHaveLength(2);
    for (const e of reconEdges) {
      expect(e.target).toBe("lot::city::4193751");
    }
  });

  it("entity_match candidate between two canonicals → entity_match edge", () => {
    const LOT_MENTION = "mention:lot:4193751";
    const LOT2_MENTION = "mention:lot:4193752";
    const lot1 = makeCanonical("lot::city::4193751", "Lot", "Lot 4193751", {
      memberMentionIds: [LOT_MENTION],
      evidenceRefs: ["raw/a.xml"],
    });
    const lot2 = makeCanonical("lot::city::4193752", "Lot", "Lot 4193752", {
      memberMentionIds: [LOT2_MENTION],
      evidenceRefs: ["raw/b.xml"],
    });
    const candidates: OntologyProjectState["candidates"] = [
      {
        id: "cand-1",
        kind: "entity_match",
        status: "candidate",
        score: 0.9,
        candidate_id: LOT_MENTION,
        canonical_id: LOT2_MENTION,
        shared_terms: ["4193751"],
        evidence_refs: ["raw/a.xml"],
        reasons: ["shared_term"],
        proposed_patch_operation: "accept_match",
      },
    ];
    const g = projectStateToGraph(makeState([lot1, lot2], [
      makeMention(LOT_MENTION, "Lot", "Lot 4193751", ["raw/a.xml"]),
      makeMention(LOT2_MENTION, "Lot", "Lot 4193752", ["raw/b.xml"]),
    ], candidates));
    const entityMatchEdges = g.links?.filter((l) => l.relation === "entity_match") ?? [];
    expect(entityMatchEdges).toHaveLength(1);
    expect(entityMatchEdges[0]!.confidence).toBe("CANDIDATE");
    expect(entityMatchEdges[0]!.confidence_score).toBe(0.9);
  });

  it("is deterministic: same state → identical nodes and links", () => {
    const SHARED_REF = "raw/avis/avis.html";
    const bylaw = makeCanonical("bylaw::city::209-47", "Bylaw", "Règlement 209-47", {
      memberMentionIds: ["mention:bylaw:209-47"],
      evidenceRefs: [SHARED_REF],
    });
    const ev = makeCanonical("designationevent::city::event-c", "DesignationEvent", "Event C", {
      memberMentionIds: ["mention:de:event-c"],
      evidenceRefs: [SHARED_REF],
    });
    const state = makeState([bylaw, ev], [
      makeMention("mention:bylaw:209-47", "Bylaw", "Règlement 209-47", [SHARED_REF]),
      makeMention("mention:de:event-c", "DesignationEvent", "Event C", [SHARED_REF]),
    ]);
    const g1 = projectStateToGraph(state);
    const g2 = projectStateToGraph(state);
    expect(g1.nodes.map((n) => n.id).sort()).toEqual(g2.nodes.map((n) => n.id).sort());
    expect(g1.links?.map((l) => `${l.source}|${l.target}|${l.relation}`).sort()).toEqual(
      g2.links?.map((l) => `${l.source}|${l.target}|${l.relation}`).sort(),
    );
  });

  it("deduplicates edges with same (source, target, relation)", () => {
    const SHARED_REF = "raw/avis/avis.html";
    // Two DesignationEvents that BOTH reference the same Bylaw AND the same ref.
    const bylaw = makeCanonical("bylaw::city::209-47", "Bylaw", "Règlement 209-47", {
      memberMentionIds: ["mention:bylaw:209-47"],
      evidenceRefs: [SHARED_REF],
    });
    const ev1 = makeCanonical("designationevent::city::ev1", "DesignationEvent", "Ev 1", {
      memberMentionIds: ["mention:de:ev1"],
      evidenceRefs: [SHARED_REF],
    });
    const ev2 = makeCanonical("designationevent::city::ev2", "DesignationEvent", "Ev 2", {
      memberMentionIds: ["mention:de:ev2"],
      evidenceRefs: [SHARED_REF],
    });
    const g = projectStateToGraph(makeState([bylaw, ev1, ev2], [
      makeMention("mention:bylaw:209-47", "Bylaw", "Règlement 209-47", [SHARED_REF]),
      makeMention("mention:de:ev1", "DesignationEvent", "Ev 1", [SHARED_REF]),
      makeMention("mention:de:ev2", "DesignationEvent", "Ev 2", [SHARED_REF]),
    ]));
    // ev1→bylaw and ev2→bylaw are DISTINCT pairs → both present, no dup
    const concerns = g.links?.filter((l) => l.relation === "concerns") ?? [];
    expect(concerns).toHaveLength(2);
    const keys = concerns.map((e) => `${e.source}|${e.target}`);
    expect(new Set(keys).size).toBe(2); // no duplicates
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Real Valleyfield seed — always run (committed bytes, no network)
// ─────────────────────────────────────────────────────────────────────────────

describe("projectStateToGraph — real Valleyfield seed state", () => {
  async function buildVfState() {
    const { seedCityOntology } = await import("../sources/seed-ontology.js");
    const store = new MemoryStore();
    const res = await seedCityOntology(store, "salaberry-de-valleyfield", FIXED);
    return res.exploitation.state;
  }

  it("produces ≥1 node for each entity type in the VF state", async () => {
    const state = await buildVfState();
    const g = projectStateToGraph(state);

    expect(g.nodes.length).toBeGreaterThan(0);

    // Must have Lot nodes
    const lotNodes = g.nodes.filter((n) => n.file_type === "lot");
    expect(lotNodes.length).toBeGreaterThan(0);

    // Must have Bylaw nodes (from avis + règlements)
    const bylawNodes = g.nodes.filter((n) => n.file_type === "bylaw");
    expect(bylawNodes.length).toBeGreaterThan(0);

    // Must have DesignationEvent nodes
    const eventNodes = g.nodes.filter((n) => n.file_type === "designationevent");
    expect(eventNodes.length).toBeGreaterThan(0);

    // Must have Zone nodes (from règlement 150-51)
    const zoneNodes = g.nodes.filter((n) => n.file_type === "zone");
    expect(zoneNodes.length).toBeGreaterThan(0);

    // Must have Adresse nodes
    const adresseNodes = g.nodes.filter((n) => n.file_type === "adresse");
    expect(adresseNodes.length).toBeGreaterThan(0);
  });

  it("VF: each canonical entity type maps to a canonical node with correct id format", async () => {
    const state = await buildVfState();
    const g = projectStateToGraph(state);

    // canonical lot 4193751
    const lotNode = g.nodes.find((n) => n.id.startsWith("lot::salaberry-de-valleyfield::"));
    expect(lotNode).toBeDefined();
    expect(lotNode!.file_type).toBe("lot");

    // canonical bylaw 150-51 (from règlement)
    const bylawNode = g.nodes.find(
      (n) => n.id.startsWith("bylaw::salaberry-de-valleyfield::") && n.label.includes("150-51"),
    );
    expect(bylawNode).toBeDefined();
    expect(bylawNode!.file_type).toBe("bylaw");

    // canonical DesignationEvent (PPCMOI)
    const ppcmoiNode = g.nodes.find(
      (n) => n.file_type === "designationevent" && n.label.toLowerCase().includes("ppcmoi"),
    );
    expect(ppcmoiNode).toBeDefined();
  });

  it("VF: concerns edges exist for DesignationEvent↔Bylaw sharing evidence refs", async () => {
    const state = await buildVfState();
    const g = projectStateToGraph(state);

    // Check that at least one concerns edge exists when there are DesignationEvents + Bylaws
    const events = state.canonicals.filter((c) => c.type === "DesignationEvent");
    const bylaws = state.canonicals.filter((c) => c.type === "Bylaw");

    if (events.length > 0 && bylaws.length > 0) {
      // There should be at least one concerns edge for the real VF state
      const concernsEdges = g.links?.filter((l) => l.relation === "concerns") ?? [];
      // Only assert ≥1 when there are shared refs (honest check)
      const hasCrossRef = events.some((ev) =>
        bylaws.some((bl) => bl.evidenceRefs.some((r) => ev.evidenceRefs.includes(r))),
      );
      if (hasCrossRef) {
        expect(concernsEdges.length).toBeGreaterThan(0);
        for (const e of concernsEdges) {
          expect(e.relation).toBe("concerns");
          // source must be a DesignationEvent canonical id
          const srcCanon = state.canonicals.find((c) => c.id === e.source);
          expect(srcCanon?.type).toBe("DesignationEvent");
          // target must be a Bylaw canonical id
          const dstCanon = state.canonicals.find((c) => c.id === e.target);
          expect(dstCanon?.type).toBe("Bylaw");
        }
      }
    }
  });

  it("VF: node ids match canonical ids exactly (no fabrication)", async () => {
    const state = await buildVfState();
    const g = projectStateToGraph(state);

    const canonicalIds = new Set(state.canonicals.map((c) => c.id));
    const graphCanonicalNodes = g.nodes.filter((n) => canonicalIds.has(n.id));
    // All canonical ids appear as nodes
    expect(graphCanonicalNodes.length).toBe(state.canonicals.length);
  });

  it("VF: graph is idempotent — converting twice yields same shape", async () => {
    const state = await buildVfState();
    const g1 = projectStateToGraph(state);
    const g2 = projectStateToGraph(state);

    expect(g1.nodes.map((n) => n.id).sort()).toEqual(g2.nodes.map((n) => n.id).sort());
    const edges1 = (g1.links ?? []).map((l) => `${l.source}|${l.target}|${l.relation}`).sort();
    const edges2 = (g2.links ?? []).map((l) => `${l.source}|${l.target}|${l.relation}`).sort();
    expect(edges1).toEqual(edges2);
  });

  it("VF: no PII in nodes or edges (Loi 25)", async () => {
    const state = await buildVfState();
    const g = projectStateToGraph(state);

    // Owner name is never in the seed (role parser hard-codes "non-disponible")
    const graphStr = JSON.stringify(g);
    // No owner field, no name that could be a PII placeholder
    expect(graphStr).not.toMatch(/propriétaire|owner|nom_proprio/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. DB-bound: upsertGraph with converter output (gated on GRAPH_DB_TESTS=1)
// ─────────────────────────────────────────────────────────────────────────────

const DB_AVAILABLE = process.env.GRAPH_DB_TESTS === "1";

describe.skipIf(!DB_AVAILABLE)("DB-bound: upsertGraph with projectStateToGraph output", () => {
  async function getDb() {
    const { createDb } = await import("../../db/client.js");
    const { loadConfig } = await import("../../config.js");
    const config = loadConfig({
      POSTGRES_HOST: process.env.POSTGRES_HOST ?? "postgres",
      POSTGRES_PORT: process.env.POSTGRES_PORT ?? "5432",
      POSTGRES_USER: process.env.POSTGRES_USER ?? "radar",
      POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD ?? "changeme-dev-only",
      POSTGRES_DB: process.env.POSTGRES_DB ?? "radar",
    });
    return createDb(config).db;
  }

  it("upserts VF project-state graph — nodeCount > 0, edgeCount ≥ 0", async () => {
    const { seedCityOntology } = await import("../sources/seed-ontology.js");
    const store = new MemoryStore();
    const res = await seedCityOntology(store, "salaberry-de-valleyfield", FIXED);
    const state = res.exploitation.state;

    const db = await getDb();
    const g = projectStateToGraph(state);
    const result = await upsertGraph(db, "salaberry-de-valleyfield", g);

    expect(result.nodeCount).toBeGreaterThan(0);
    expect(result.edgeCount).toBeGreaterThanOrEqual(0);
  });

  it("upsert is idempotent: same state upserted twice → same counts, no duplicates", async () => {
    const { seedCityOntology } = await import("../sources/seed-ontology.js");
    const store = new MemoryStore();
    const res = await seedCityOntology(store, "salaberry-de-valleyfield", FIXED);
    const g = projectStateToGraph(res.exploitation.state);

    const db = await getDb();
    const r1 = await upsertGraph(db, "salaberry-de-valleyfield", g);
    const r2 = await upsertGraph(db, "salaberry-de-valleyfield", g);

    expect(r1.nodeCount).toBe(r2.nodeCount);
    expect(r1.edgeCount).toBe(r2.edgeCount);
  });
});
