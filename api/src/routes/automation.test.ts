import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { automationRoute } from "./automation.js";
import { AVIS_PUBLICS_FIXTURE_HTML } from "../services/automation/avis-publics-valleyfield.fixture.js";

describe("POST /api/automation/collect/:source", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("returns 404 for an unknown source", async () => {
    const app = automationRoute();
    const res = await app.request("/api/automation/collect/does-not-exist", {
      method: "POST",
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("unknown-source");
  });

  describe("avis-publics-valleyfield (fetch stubbed)", () => {
    beforeEach(() => {
      globalThis.fetch = vi.fn(
        async () =>
          new Response(AVIS_PUBLICS_FIXTURE_HTML, {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
      ) as unknown as typeof fetch;
    });

    it("returns the parsed real-shaped items on success", async () => {
      const app = automationRoute();
      const res = await app.request("/api/automation/collect/avis-publics-valleyfield", {
        method: "POST",
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        source: string;
        count: number;
        items: { title: string }[];
      };
      expect(body.ok).toBe(true);
      expect(body.source).toBe("avis-publics-valleyfield");
      expect(body.count).toBe(4);
      expect(body.items[0]?.title).toBe("Dérogations mineures du 20 mai 2026");
    });
  });

  it("returns 502 when the upstream source fails (fetch rejects)", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ENOTFOUND");
    }) as unknown as typeof fetch;
    const app = automationRoute();
    const res = await app.request("/api/automation/collect/avis-publics-valleyfield", {
      method: "POST",
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("network");
  });
});
