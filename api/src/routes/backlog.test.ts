import { describe, expect, it } from "vitest";
import { backlogRoute, createBacklogStore, type BacklogItem } from "./backlog.js";

const freshApp = () => backlogRoute(createBacklogStore());

describe("GET /api/backlog", () => {
  it("returns the seed evolutions", async () => {
    const res = await freshApp().request("/api/backlog");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: BacklogItem[] };
    expect(body.items.length).toBeGreaterThan(0);
    // Seed is faithful: ÉV1 realised via PR #18, ÉV15 en-cours.
    const ev1 = body.items.find((i) => i.id === "ev1-socle-states-scoring");
    expect(ev1?.statut).toBe("realise");
    expect(ev1?.pr).toBe(18);
    const ev15 = body.items.find((i) => i.id === "ev15-backlog");
    expect(ev15?.statut).toBe("en-cours");
  });

  it("seed has the three statuses represented", async () => {
    const res = await freshApp().request("/api/backlog");
    const body = (await res.json()) as { items: BacklogItem[] };
    const statuses = new Set(body.items.map((i) => i.statut));
    expect(statuses).toEqual(new Set(["a-faire", "en-cours", "realise"]));
  });
});

describe("POST /api/backlog/items", () => {
  it("adds a request as 'a-faire' and lists it", async () => {
    const app = freshApp();
    const res = await app.request("/api/backlog/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ titre: "Carte interactive", description: "MapLibre" }),
    });
    expect(res.status).toBe(201);
    const { item } = (await res.json()) as { item: BacklogItem };
    expect(item.statut).toBe("a-faire");
    expect(item.titre).toBe("Carte interactive");
    expect(item.id).toBe("carte-interactive");

    const list = (await (await app.request("/api/backlog")).json()) as {
      items: BacklogItem[];
    };
    expect(list.items.some((i) => i.id === "carte-interactive")).toBe(true);
  });

  it("rejects an empty title with 400", async () => {
    const res = await freshApp().request("/api/backlog/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ titre: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("disambiguates colliding ids", async () => {
    const app = freshApp();
    const post = () =>
      app.request("/api/backlog/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ titre: "Même titre" }),
      });
    const a = (await (await post()).json()) as { item: BacklogItem };
    const b = (await (await post()).json()) as { item: BacklogItem };
    expect(a.item.id).not.toBe(b.item.id);
  });
});

describe("POST /api/backlog/items/:id/process", () => {
  it("moves a runtime item to 'en-cours'", async () => {
    const app = freshApp();
    const created = (await (
      await app.request("/api/backlog/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ titre: "Authentification passkey" }),
      })
    ).json()) as { item: BacklogItem };

    const res = await app.request(
      `/api/backlog/items/${created.item.id}/process`,
      { method: "POST" },
    );
    expect(res.status).toBe(200);
    const { item } = (await res.json()) as { item: BacklogItem };
    expect(item.statut).toBe("en-cours");
  });

  it("returns 404 for an unknown id (seed items are read-only)", async () => {
    const res = await freshApp().request(
      "/api/backlog/items/ev1-socle-states-scoring/process",
      { method: "POST" },
    );
    expect(res.status).toBe(404);
  });
});
