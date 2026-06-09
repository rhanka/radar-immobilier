import { describe, expect, it } from "vitest";

import { ciblageRoute } from "./ciblage.js";
import type { ObjectInfo, ObjectStore } from "../storage/object-store.js";
import type { CiblagePlanT } from "@radar/domain";

/** In-memory ObjectStore so the CIBLAGE routes are testable without MinIO. */
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
    if (!v) throw new Error(`missing ${key}`);
    return v;
  }

  async head(key: string): Promise<ObjectInfo | null> {
    const v = this.objects.get(key);
    return v ? { key, size: v.byteLength } : null;
  }
}

const freshApp = () => ciblageRoute({ store: new MemoryStore() });

const json = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const VALID_INPUT = {
  label: "Veille Valleyfield",
  citySlugs: ["salaberry-de-valleyfield"],
  sourceBindingIds: ["avis-publics-valleyfield"],
  cadence: "initial",
  enabled: true,
};

describe("GET /api/ciblage", () => {
  it("returns an empty plan list + the REAL source catalogue", async () => {
    const res = await freshApp().request("/api/ciblage");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      plans: CiblagePlanT[];
      sourceBindings: { sourceId: string }[];
    };
    expect(body.ok).toBe(true);
    expect(body.plans).toEqual([]);
    // Anti-invention: every offered binding is a real prioritySources id.
    expect(body.sourceBindings.length).toBeGreaterThan(0);
    expect(
      body.sourceBindings.some((b) => b.sourceId === "avis-publics-valleyfield"),
    ).toBe(true);
  });
});

describe("POST /api/ciblage (create)", () => {
  it("creates a plan, assigns id/createdAt, and lists it", async () => {
    const app = freshApp();
    const res = await app.request("/api/ciblage", json(VALID_INPUT));
    expect(res.status).toBe(201);
    const { plan } = (await res.json()) as { plan: CiblagePlanT };
    expect(plan.id).toBe("veille-valleyfield");
    expect(plan.label).toBe("Veille Valleyfield");
    expect(plan.cadence).toBe("initial");
    expect(plan.createdAt).toBeTruthy();
    expect(plan.updatedAt).toBe(plan.createdAt);

    const list = (await (await app.request("/api/ciblage")).json()) as {
      plans: CiblagePlanT[];
    };
    expect(list.plans).toHaveLength(1);
    expect(list.plans[0]!.id).toBe("veille-valleyfield");
  });

  it("disambiguates colliding ids from the same label", async () => {
    const app = freshApp();
    const a = (await (
      await app.request("/api/ciblage", json(VALID_INPUT))
    ).json()) as { plan: CiblagePlanT };
    const b = (await (
      await app.request("/api/ciblage", json(VALID_INPUT))
    ).json()) as { plan: CiblagePlanT };
    expect(a.plan.id).not.toBe(b.plan.id);
  });

  it("rejects an empty label with 400", async () => {
    const res = await freshApp().request(
      "/api/ciblage",
      json({ ...VALID_INPUT, label: "" }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid-plan");
  });

  it("rejects an invalid cadence with 400", async () => {
    const res = await freshApp().request(
      "/api/ciblage",
      json({ ...VALID_INPUT, cadence: "weekly" }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a fabricated source binding (anti-invention) with 400", async () => {
    const res = await freshApp().request(
      "/api/ciblage",
      json({ ...VALID_INPUT, sourceBindingIds: ["made-up-source"] }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; unknown: string[] };
    expect(body.error).toBe("unknown-source-binding");
    expect(body.unknown).toEqual(["made-up-source"]);
  });
});

describe("GET /api/ciblage/:id", () => {
  it("returns a created plan", async () => {
    const app = freshApp();
    const { plan } = (await (
      await app.request("/api/ciblage", json(VALID_INPUT))
    ).json()) as { plan: CiblagePlanT };
    const res = await app.request(`/api/ciblage/${plan.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { plan: CiblagePlanT };
    expect(body.plan.id).toBe(plan.id);
  });

  it("returns 404 for an unknown id", async () => {
    const res = await freshApp().request("/api/ciblage/nope");
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/ciblage/:id (edit)", () => {
  it("toggles enabled and re-stamps updatedAt", async () => {
    const app = freshApp();
    const { plan } = (await (
      await app.request("/api/ciblage", json(VALID_INPUT))
    ).json()) as { plan: CiblagePlanT };
    const res = await app.request(`/api/ciblage/${plan.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { plan: CiblagePlanT };
    expect(body.plan.enabled).toBe(false);
    expect(body.plan.createdAt).toBe(plan.createdAt); // unchanged
  });

  it("rejects a patch with a fabricated source binding", async () => {
    const app = freshApp();
    const { plan } = (await (
      await app.request("/api/ciblage", json(VALID_INPUT))
    ).json()) as { plan: CiblagePlanT };
    const res = await app.request(`/api/ciblage/${plan.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceBindingIds: ["ghost-source"] }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unknown-source-binding");
  });

  it("returns 404 patching an unknown id", async () => {
    const res = await freshApp().request("/api/ciblage/nope", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/ciblage/:id", () => {
  it("removes a plan", async () => {
    const app = freshApp();
    const { plan } = (await (
      await app.request("/api/ciblage", json(VALID_INPUT))
    ).json()) as { plan: CiblagePlanT };
    const del = await app.request(`/api/ciblage/${plan.id}`, {
      method: "DELETE",
    });
    expect(del.status).toBe(200);
    const after = (await (await app.request("/api/ciblage")).json()) as {
      plans: CiblagePlanT[];
    };
    expect(after.plans).toEqual([]);
  });

  it("returns 404 deleting an unknown id", async () => {
    const res = await freshApp().request("/api/ciblage/nope", {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/ciblage/:id/run", () => {
  it("runs an enabled plan and returns the Job (fixture runner)", async () => {
    const store = new MemoryStore();
    // Inject a fixture runner so the route is tested without any network.
    const app = ciblageRoute({ store }, undefined, async (planId) => ({
      ok: true as const,
      job: {
        id: "job-run-1",
        planId,
        planLabel: "Veille Valleyfield",
        status: "succeeded" as const,
        mode: "real" as const,
        startedAt: "2026-06-08T08:00:00.000Z",
        finishedAt: "2026-06-08T08:00:02.000Z",
        steps: [
          {
            sourceId: "avis-publics-valleyfield",
            city: "salaberry-de-valleyfield",
            status: "succeeded" as const,
            rawDocIds: ["raw-1"],
            mentionCount: 2,
          },
        ],
        totals: {
          sources: 1,
          succeeded: 1,
          failed: 0,
          skipped: 0,
          rawDocs: 1,
          mentions: 2,
        },
      },
    }));

    const { plan } = (await (
      await app.request("/api/ciblage", json(VALID_INPUT))
    ).json()) as { plan: CiblagePlanT };

    const res = await app.request(`/api/ciblage/${plan.id}/run`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      job: { id: string; planId: string; status: string };
    };
    expect(body.ok).toBe(true);
    expect(body.job.planId).toBe(plan.id);
    expect(body.job.status).toBe("succeeded");
  });

  it("maps plan-not-found → 404, plan-disabled → 409", async () => {
    const store = new MemoryStore();
    const app = ciblageRoute({ store }, undefined, async (planId) =>
      planId === "missing"
        ? { ok: false as const, error: "plan-not-found" as const, detail: "x" }
        : { ok: false as const, error: "plan-disabled" as const, detail: "y" },
    );

    const notFound = await app.request("/api/ciblage/missing/run", {
      method: "POST",
    });
    expect(notFound.status).toBe(404);

    const disabled = await app.request("/api/ciblage/anything/run", {
      method: "POST",
    });
    expect(disabled.status).toBe(409);
  });
});
