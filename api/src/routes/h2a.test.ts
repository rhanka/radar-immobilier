import { describe, expect, it } from "vitest";

import { h2aRoute } from "./h2a.js";
import { createJournalStore } from "../services/h2a/journal-store.js";
import type { JournalSnapshot } from "../services/h2a/journal-store.js";

const freshApp = () => h2aRoute(createJournalStore());

describe("GET /api/h2a/journal", () => {
  it("starts empty with a valid (empty) chain and both actors", async () => {
    const res = await freshApp().request("/api/h2a/journal");
    expect(res.status).toBe(200);
    const snap = (await res.json()) as JournalSnapshot;
    expect(snap.entries).toEqual([]);
    expect(snap.chainValid).toBe(true);
    expect(snap.protocol).toBe("sentropic.h2a");
    const roles = snap.actors.map((a) => a.role);
    expect(roles).toContain("PRINCIPAL");
    expect(roles).toContain("CONDUCTOR");
    // The radar POLICY ids are carried at the snapshot level.
    expect(snap.policyIds).toContain("policy:radar:principal-is-human");
  });
});

describe("GET /api/h2a/policy", () => {
  it("returns the real h2a POLICY artifacts under the radar scope", async () => {
    const res = await freshApp().request("/api/h2a/policy");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      scope: string;
      policies: Array<{ kind: string; id: string; adoptionMode: string }>;
    };
    expect(body.scope).toBe("scope:radar");
    expect(body.policies.length).toBe(5);
    expect(body.policies.every((p) => p.kind === "POLICY")).toBe(true);
  });
});

describe("POST /api/h2a/decisions", () => {
  it("records a PRINCIPAL propose + CONDUCTOR accept, both signed and chained", async () => {
    const app = freshApp();
    const res = await app.request("/api/h2a/decisions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "qualifier", entity: "H-609-4", rationale: "test" }),
    });
    expect(res.status).toBe(201);
    const snap = (await res.json()) as JournalSnapshot;

    // Two entries: PRINCIPAL propose, then CONDUCTOR accept.
    expect(snap.entries.length).toBe(2);
    const [propose, accept] = snap.entries;
    expect(propose!.entry.type).toBe("propose");
    expect(propose!.entry.actor.role).toBe("PRINCIPAL");
    expect(accept!.entry.type).toBe("accept");
    expect(accept!.entry.actor.role).toBe("CONDUCTOR");

    // Real hash chain: second entry links to the first.
    expect(accept!.entry.prevHash).toBe(propose!.entry.contentHash);
    expect(accept!.entry.sequence).toBe(1);

    // Every entry carries a verified ed25519 signature and the chain verifies.
    expect(snap.entries.every((v) => v.signatureValid)).toBe(true);
    expect(snap.chainValid).toBe(true);

    // The decision body is journaled faithfully.
    expect((propose!.entry.body as { entity: string }).entity).toBe("H-609-4");
  });

  it("appends across multiple decisions keeping the chain valid", async () => {
    const app = freshApp();
    const post = (kind: string, entity: string) =>
      app.request("/api/h2a/decisions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, entity }),
      });
    await post("qualifier", "H-609-4");
    const last = await post("surveiller", "U-521");
    const snap = (await last.json()) as JournalSnapshot;
    expect(snap.entries.length).toBe(4);
    expect(snap.chainValid).toBe(true);
    expect(snap.entries.every((v) => v.signatureValid)).toBe(true);
  });

  it("rejects an unknown decision kind with 400", async () => {
    const res = await freshApp().request("/api/h2a/decisions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "demolir", entity: "X" }),
    });
    expect(res.status).toBe(400);
  });
});
