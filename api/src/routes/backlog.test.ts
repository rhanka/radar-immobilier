import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  backlogRoute,
  createBacklogStore,
  trackItemToBacklog,
  type BacklogItem,
  type TrackBacklogReader,
} from "./backlog.js";
import { foldTrackEvents } from "../services/track/track-reader.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(
  here,
  "..",
  "services",
  "track",
  "__fixtures__",
  "track-events.sample.jsonl",
);
const FIXTURE = readFileSync(FIXTURE_PATH, "utf8");

/** A reader backed by the committed real-events fixture (track available). */
const fixtureReader: TrackBacklogReader = () => ({
  available: true,
  items: foldTrackEvents(FIXTURE).map(trackItemToBacklog),
});

/** A reader that reports the sidecar as missing (forces the ÉV fallback). */
const missingReader: TrackBacklogReader = () => ({ available: false, items: [] });

const trackApp = () => backlogRoute(createBacklogStore(), fixtureReader);
const fallbackApp = () => backlogRoute(createBacklogStore(), missingReader);

const DONE_ID = "01KTMHTE8YCBE0596AB6SJRYE4";
const TODO_ID = "01KTMHWNQZ1EYEDAM2Z7PVK1N3";

describe("GET /api/backlog (track-backed)", () => {
  it("returns the REAL tracked items with source 'track'", async () => {
    const res = await trackApp().request("/api/backlog");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: BacklogItem[]; source: string };
    expect(body.source).toBe("track");

    const done = body.items.find((i) => i.id === DONE_ID);
    expect(done?.statut).toBe("realise");
    expect(done?.source).toBe("track");
    expect(done?.titre).toBe("WP4-A — Investigation données réelles multi-villes");
    expect(done?.groupe).toBe("wp4-sources");
    expect(done?.acceptance).toBe("pass");

    const todo = body.items.find((i) => i.id === TODO_ID);
    expect(todo?.statut).toBe("a-faire");
    expect(todo?.bucket).toBe("TO-DO");
  });

  it("does NOT leak the ÉV fallback seed when track is available", async () => {
    const res = await trackApp().request("/api/backlog");
    const body = (await res.json()) as { items: BacklogItem[] };
    expect(body.items.some((i) => i.id === "ev1-socle-states-scoring")).toBe(false);
  });
});

describe("GET /api/backlog (fallback when sidecar absent)", () => {
  it("falls back to the labeled ÉV seed", async () => {
    const res = await fallbackApp().request("/api/backlog");
    const body = (await res.json()) as { items: BacklogItem[]; source: string };
    expect(body.source).toBe("ev-fallback");
    const ev1 = body.items.find((i) => i.id === "ev1-socle-states-scoring");
    expect(ev1?.statut).toBe("realise");
    expect(ev1?.pr).toBe(18);
    expect(ev1?.source).toBe("ev-fallback");
  });
});

describe("GET /api/backlog/track (raw buckets)", () => {
  it("buckets the real tracked items", async () => {
    const res = await trackApp().request("/api/backlog/track");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      available: boolean;
      buckets: Record<"DONE" | "TO-DO" | "DROPPED", BacklogItem[]>;
    };
    expect(body.available).toBe(true);
    expect((body.buckets.DONE ?? []).some((i) => i.id === DONE_ID)).toBe(true);
    expect((body.buckets["TO-DO"] ?? []).some((i) => i.id === TODO_ID)).toBe(true);
    expect(body.buckets.DROPPED ?? []).toEqual([]);
  });
});

describe("POST /api/backlog/items (runtime requests)", () => {
  it("adds a request as 'a-faire' and merges it on top of the track list", async () => {
    const app = trackApp();
    const res = await app.request("/api/backlog/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ titre: "Carte interactive", description: "MapLibre" }),
    });
    expect(res.status).toBe(201);
    const { item } = (await res.json()) as { item: BacklogItem };
    expect(item.statut).toBe("a-faire");
    expect(item.source).toBe("request");
    expect(item.id).toBe("carte-interactive");

    const list = (await (await app.request("/api/backlog")).json()) as {
      items: BacklogItem[];
    };
    expect(list.items.some((i) => i.id === "carte-interactive")).toBe(true);
    // The tracked items are still present alongside the new request.
    expect(list.items.some((i) => i.id === DONE_ID)).toBe(true);
  });

  it("rejects an empty title with 400", async () => {
    const res = await trackApp().request("/api/backlog/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ titre: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("disambiguates colliding ids", async () => {
    const app = trackApp();
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
    const app = trackApp();
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

  it("returns 404 for an unknown id (tracked items are read-only)", async () => {
    const res = await trackApp().request(
      `/api/backlog/items/${DONE_ID}/process`,
      { method: "POST" },
    );
    expect(res.status).toBe(404);
  });
});
