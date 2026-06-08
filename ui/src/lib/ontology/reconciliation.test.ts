import { describe, it, expect, vi } from "vitest";

import {
  STUDIO_CITIES,
  NODE_TYPE_ORDER,
  groupEntitiesByType,
  studioCounts,
  candidateSharedTerms,
  mentionProvenance,
  shortRawRef,
  fetchCityState,
  seedCity,
  type CanonicalEntityV,
  type OntologyCityState,
  type CandidateV,
} from "./reconciliation.js";

const lot: CanonicalEntityV = {
  id: "lot::salaberry-de-valleyfield::4193751",
  type: "Lot",
  label: "Lot 4193751",
  aliases: [],
  memberMentionIds: ["mention:lot:4193751"],
  evidenceRefs: ["raw/role-evaluation-mamh-70052/2026/06/08/abc.xml"],
  status: "candidate",
};
const valuation: CanonicalEntityV = {
  id: "valuation::salaberry-de-valleyfield::5114-86-8189",
  type: "Valuation",
  label: "Matricule 5114-86-8189",
  aliases: [],
  memberMentionIds: ["mention:valuation:5114-86-8189"],
  evidenceRefs: ["raw/role-evaluation-mamh-70052/2026/06/08/abc.xml"],
  status: "validated",
};
const zone: CanonicalEntityV = {
  id: "zone::salaberry-de-valleyfield::h-1",
  type: "Zone",
  label: "Zone H-1",
  aliases: [],
  memberMentionIds: [],
  evidenceRefs: [],
  status: "candidate",
};

const STATE: OntologyCityState = {
  citySlug: "salaberry-de-valleyfield",
  profileHash: "a".repeat(64),
  generatedAt: "2026-06-08T00:00:00.000Z",
  entities: [zone, lot, valuation],
  candidates: [],
  rawRefs: ["raw/role-evaluation-mamh-70052/2026/06/08/abc.xml"],
  mentions: [
    {
      id: "mention:lot:4193751",
      type: "Lot",
      label: "Lot 4193751",
      normalized_terms: ["4193751"],
      source_refs: ["raw/role-evaluation-mamh-70052/2026/06/08/abc.xml"],
    },
  ],
};

describe("STUDIO_CITIES", () => {
  it("offers both pilot cities (Valleyfield + Beauharnois)", () => {
    expect(STUDIO_CITIES.map((c) => c.slug)).toEqual([
      "salaberry-de-valleyfield",
      "beauharnois",
    ]);
  });
});

describe("groupEntitiesByType", () => {
  it("groups by node type in profile order (Lot before Valuation before Zone)", () => {
    const groups = groupEntitiesByType(STATE.entities);
    expect(groups.map((g) => g.type)).toEqual(["Lot", "Valuation", "Zone"]);
    expect(NODE_TYPE_ORDER.indexOf("Lot")).toBeLessThan(
      NODE_TYPE_ORDER.indexOf("Zone"),
    );
  });

  it("sorts entities within a group by label", () => {
    const groups = groupEntitiesByType([
      { ...lot, label: "Lot 9" },
      { ...lot, id: "lot::x::1", label: "Lot 1" },
    ]);
    expect(groups[0]!.entities.map((e) => e.label)).toEqual(["Lot 1", "Lot 9"]);
  });

  it("returns an empty array for no entities (empty-state)", () => {
    expect(groupEntitiesByType([])).toEqual([]);
  });
});

describe("studioCounts", () => {
  it("counts entities, candidates, mentions and validated", () => {
    const counts = studioCounts(STATE);
    expect(counts.entityCount).toBe(3);
    expect(counts.candidateCount).toBe(0);
    expect(counts.mentionCount).toBe(1);
    expect(counts.validatedCount).toBe(1); // only the Valuation is validated
  });
});

describe("candidate + provenance helpers", () => {
  it("candidateSharedTerms prefers shared_terms, falls back to normalized_terms", () => {
    const a: CandidateV = {
      id: "c1",
      candidate_id: "m1",
      canonical_id: "m2",
      shared_terms: ["4193751"],
    };
    const b: CandidateV = {
      id: "c2",
      candidate_id: "m3",
      canonical_id: "m4",
      normalized_terms: ["5114-86-8189"],
    };
    expect(candidateSharedTerms(a)).toEqual(["4193751"]);
    expect(candidateSharedTerms(b)).toEqual(["5114-86-8189"]);
    expect(candidateSharedTerms({ id: "c3", candidate_id: "x", canonical_id: "y" })).toEqual([]);
  });

  it("mentionProvenance returns the raw S3 refs (no owner/PII ever)", () => {
    const refs = mentionProvenance(STATE.mentions[0]!);
    expect(refs).toEqual(["raw/role-evaluation-mamh-70052/2026/06/08/abc.xml"]);
  });

  it("shortRawRef keeps only the file name", () => {
    expect(shortRawRef("raw/role-evaluation-mamh-70052/2026/06/08/abc.xml")).toBe(
      "abc.xml",
    );
  });
});

describe("fetchCityState", () => {
  function jsonRes(body: unknown, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response;
  }

  it("assembles ok state from the three endpoints", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/entities")) {
        return jsonRes({
          ok: true,
          citySlug: "salaberry-de-valleyfield",
          profileHash: "a".repeat(64),
          generatedAt: "2026-06-08T00:00:00.000Z",
          entities: [lot],
        });
      }
      if (url.endsWith("/candidates")) return jsonRes({ candidates: [] });
      return jsonRes({ rawRefs: ["raw/x.xml"], mentions: [] });
    });
    const res = await fetchCityState(
      "salaberry-de-valleyfield",
      fetchImpl as unknown as typeof fetch,
    );
    expect(res.kind).toBe("ok");
    if (res.kind === "ok") {
      expect(res.state.entities).toHaveLength(1);
      expect(res.state.entities[0]!.label).toBe("Lot 4193751");
      expect(res.state.rawRefs).toEqual(["raw/x.xml"]);
    }
  });

  it("resolves to empty on a 404 no-project-state (seed CTA)", async () => {
    const fetchImpl = vi.fn(async () => jsonRes({ ok: false }, 404));
    const res = await fetchCityState(
      "beauharnois",
      fetchImpl as unknown as typeof fetch,
    );
    expect(res.kind).toBe("empty");
    if (res.kind === "empty") expect(res.citySlug).toBe("beauharnois");
  });

  it("resolves to error when the fetch throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    const res = await fetchCityState(
      "beauharnois",
      fetchImpl as unknown as typeof fetch,
    );
    expect(res.kind).toBe("error");
    if (res.kind === "error") expect(res.detail).toContain("network down");
  });
});

describe("seedCity", () => {
  it("POSTs to exploit-samples and returns ok", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    })) as unknown as typeof fetch;
    const res = await seedCity("beauharnois", fetchImpl);
    expect(res.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/ontology/beauharnois/exploit-samples",
      { method: "POST" },
    );
  });
});
