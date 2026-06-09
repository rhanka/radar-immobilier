import { describe, it, expect, vi } from "vitest";

import {
  CIBLAGE_CADENCES,
  CIBLAGE_CITIES,
  cadenceLabel,
  cityLabel,
  createPlan,
  deletePlan,
  emptyForm,
  fetchCiblage,
  formFromPlan,
  groupBindingsByKind,
  isFormValid,
  runPlan,
  toggleIn,
  updatePlan,
  type CiblageJobV,
  type CiblagePlanV,
  type SourceBindingV,
} from "./ciblage.js";

const PLAN: CiblagePlanV = {
  id: "veille-valleyfield",
  label: "Veille Valleyfield",
  citySlugs: ["salaberry-de-valleyfield"],
  sourceBindingIds: ["avis-publics-valleyfield"],
  cadence: "initial",
  enabled: true,
  notes: "note",
  createdAt: "2026-06-09T00:00:00.000Z",
  updatedAt: "2026-06-09T00:00:00.000Z",
};

const BINDINGS: SourceBindingV[] = [
  { sourceId: "reglements-urbanisme-valleyfield", kind: "reglement", city: "salaberry-de-valleyfield", tier: "A", cadence: "weekly" },
  { sourceId: "avis-publics-valleyfield", kind: "avis-publics", city: "salaberry-de-valleyfield", tier: "A", cadence: "daily" },
  { sourceId: "avis-publics-beauharnois", kind: "avis-publics", city: "beauharnois", tier: "A", cadence: "daily" },
];

describe("static catalogue", () => {
  it("offers the three ÉV7 cadences", () => {
    expect(CIBLAGE_CADENCES.map((c) => c.value)).toEqual([
      "initial",
      "recurrent",
      "approfondissement",
    ]);
  });

  it("offers both pilot cities", () => {
    expect(CIBLAGE_CITIES.map((c) => c.slug)).toEqual([
      "salaberry-de-valleyfield",
      "beauharnois",
    ]);
  });

  it("cadenceLabel + cityLabel resolve, with fallbacks", () => {
    expect(cadenceLabel("initial")).toBe("Initial");
    expect(cityLabel("beauharnois")).toBe("Beauharnois");
    expect(cityLabel("unknown-slug")).toBe("unknown-slug");
  });
});

describe("form helpers", () => {
  it("emptyForm is not submittable; a labelled form with a binding is", () => {
    const f = emptyForm();
    expect(isFormValid(f)).toBe(false);
    f.label = "X";
    expect(isFormValid(f)).toBe(false); // no binding yet
    f.sourceBindingIds = ["avis-publics-valleyfield"];
    expect(isFormValid(f)).toBe(true);
  });

  it("rejects a whitespace-only label", () => {
    expect(isFormValid({ ...emptyForm(), label: "   ", sourceBindingIds: ["x"] })).toBe(
      false,
    );
  });

  it("formFromPlan hydrates the editable surface (notes default '')", () => {
    const f = formFromPlan({ ...PLAN, notes: undefined });
    expect(f.label).toBe("Veille Valleyfield");
    expect(f.cadence).toBe("initial");
    expect(f.notes).toBe("");
    expect(f.sourceBindingIds).toEqual(["avis-publics-valleyfield"]);
  });

  it("toggleIn adds then removes immutably", () => {
    const a = toggleIn([], "x");
    expect(a).toEqual(["x"]);
    expect(toggleIn(a, "x")).toEqual([]);
  });
});

describe("groupBindingsByKind", () => {
  it("groups by kind, sorted by kind then sourceId", () => {
    const groups = groupBindingsByKind(BINDINGS);
    expect(groups.map((g) => g.kind)).toEqual(["avis-publics", "reglement"]);
    expect(groups[0]!.bindings.map((b) => b.sourceId)).toEqual([
      "avis-publics-beauharnois",
      "avis-publics-valleyfield",
    ]);
  });

  it("returns an empty array for no bindings", () => {
    expect(groupBindingsByKind([])).toEqual([]);
  });
});

// ── API client ───────────────────────────────────────────────────────────────

function jsonRes(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("fetchCiblage", () => {
  it("returns plans + the real source catalogue", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonRes({ ok: true, plans: [PLAN], sourceBindings: BINDINGS }),
    );
    const res = await fetchCiblage(fetchImpl as unknown as typeof fetch);
    expect(res.kind).toBe("ok");
    if (res.kind === "ok") {
      expect(res.plans).toHaveLength(1);
      expect(res.sourceBindings).toHaveLength(3);
    }
  });

  it("resolves to error when the fetch throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    const res = await fetchCiblage(fetchImpl as unknown as typeof fetch);
    expect(res.kind).toBe("error");
    if (res.kind === "error") expect(res.detail).toContain("network down");
  });
});

describe("createPlan / updatePlan / deletePlan", () => {
  it("POSTs a trimmed payload and returns the created plan", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const sent = JSON.parse(String(init?.body)) as { label: string; notes?: string };
      expect(sent.label).toBe("Veille"); // trimmed
      expect(sent.notes).toBeUndefined(); // blank notes omitted
      return jsonRes({ plan: PLAN }, 201);
    });
    const res = await createPlan(
      { ...emptyForm(), label: "  Veille  ", sourceBindingIds: ["avis-publics-valleyfield"] },
      fetchImpl as unknown as typeof fetch,
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.plan.id).toBe("veille-valleyfield");
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/ciblage",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("surfaces the server error detail on a 400", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonRes({ error: "unknown-source-binding", detail: "Not in the catalogue" }, 400),
    );
    const res = await createPlan(
      { ...emptyForm(), label: "X", sourceBindingIds: ["ghost"] },
      fetchImpl as unknown as typeof fetch,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.detail).toBe("Not in the catalogue");
  });

  it("PATCHes an existing plan by id", async () => {
    const fetchImpl = vi.fn(async () => jsonRes({ plan: { ...PLAN, enabled: false } }));
    const res = await updatePlan(
      "veille-valleyfield",
      { ...formFromPlan(PLAN), enabled: false },
      fetchImpl as unknown as typeof fetch,
    );
    expect(res.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/ciblage/veille-valleyfield",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("DELETEs a plan by id", async () => {
    const fetchImpl = vi.fn(async () => jsonRes({ ok: true }));
    const res = await deletePlan("veille-valleyfield", fetchImpl as unknown as typeof fetch);
    expect(res.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/ciblage/veille-valleyfield",
      { method: "DELETE" },
    );
  });
});

describe("runPlan", () => {
  const JOB: CiblageJobV = {
    id: "job-1",
    planId: "veille-valleyfield",
    planLabel: "Veille Valleyfield",
    status: "succeeded",
    mode: "real",
    startedAt: "2026-06-09T00:00:00.000Z",
    finishedAt: "2026-06-09T00:00:02.000Z",
    totals: { sources: 1, succeeded: 1, failed: 0, skipped: 0, rawDocs: 1, mentions: 3 },
  };

  it("POSTs /run and returns the Job", async () => {
    const fetchImpl = vi.fn(async () => jsonRes({ ok: true, job: JOB }));
    const res = await runPlan("veille-valleyfield", fetchImpl as unknown as typeof fetch);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.job.status).toBe("succeeded");
    expect(fetchImpl).toHaveBeenCalledWith("/api/ciblage/veille-valleyfield/run", {
      method: "POST",
    });
  });

  it("surfaces a typed error detail on a failed run", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonRes({ ok: false, error: "plan-disabled", detail: "enable it first" }, 409),
    );
    const res = await runPlan("x", fetchImpl as unknown as typeof fetch);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.detail).toBe("enable it first");
  });

  it("resolves to error when the fetch throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    });
    const res = await runPlan("x", fetchImpl as unknown as typeof fetch);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.detail).toContain("offline");
  });
});
