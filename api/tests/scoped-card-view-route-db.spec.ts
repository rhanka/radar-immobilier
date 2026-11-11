import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { expect, it, vi } from "vitest";
import { buildRawDocumentRecord, rawMetaKey } from "@radar/sources";
import { graphNodes } from "../src/db/schema.js";
import { scopedProjectionRevisionsRoute } from "../src/routes/scoped-projection-revisions.js";
import { describeDb } from "../src/services/facets/scope-db-fixture.js";
import { revisionFixture } from "../src/services/facets/projection-revisions-fixture.js";
import type { Database } from "../src/db/client.js";
import type { ObjectStore } from "../src/storage/object-store.js";

function spyStore() {
  const get = vi.fn(async () => null);
  const store = { get } as unknown as ObjectStore;
  return { store, get };
}

function appFor(f: { db: Database; workspaceId: string }, session: { sub: string }, store: ObjectStore) {
  const app = new Hono();
  app.use("*", async (c, next) => { c.set("session" as never, session as never); await next(); });
  app.route("/", scopedProjectionRevisionsRoute({ db: f.db, auth: { enabled: true }, store }));
  return app;
}

describeDb("coherent-city view contract (lot 1)", () => {
  it("view=card skips the object store, view absent keeps the historical props", async () => {
    const f = await revisionFixture();
    const citySlug = `synthetic-card-${randomUUID().slice(0, 8)}`;
    const props = {
      properties: {
        category: "rezonage", etape: "avis_motion", demandeur: "Y",
        refs: [{ publishedAt: "2026-01-05", excerpt: "preuve" }],
      },
      secretKey: "drop",
    };
    await f.db.insert(graphNodes).values({
      id: randomUUID(), type: "Signal", citySlug, label: "Synthetic card signal", props,
    });
    const { store, get } = spyStore();
    const app = appFor(f, { sub: f.contributor.sub }, store);
    const base = `/api/v1/workspaces/${f.workspaceId}/signal-facets/coherent-city?citySlug=${citySlug}&mode=signal`;

    const fullRes = await app.request(base);
    expect(fullRes.status).toBe(200);
    const full = await fullRes.json() as {
      counts: unknown; signals: Array<{ props: Record<string, unknown> }>;
    };

    get.mockClear();
    const cardRes = await app.request(`${base}&view=card`);
    expect(cardRes.status).toBe(200);
    const card = await cardRes.json() as {
      counts: unknown; signals: Array<{ props: Record<string, unknown> }>;
    };

    // The thin view never touches the object store.
    expect(get).not.toHaveBeenCalled();
    // Envelope counters are identical between the two views.
    expect(card.counts).toEqual(full.counts);
    // Historical path serves the stored props; card path serves the
    // closed projection, nested refs included.
    expect(full.signals[0]!.props).toEqual(props);
    expect(card.signals[0]!.props).toEqual({
      properties: {
        category: "rezonage", etape: "avis_motion",
        refs: [{ publishedAt: "2026-01-05", excerpt: "preuve" }],
      },
    });
    // An invalid view value is rejected.
    expect((await app.request(`${base}&view=foo`)).status).toBe(400);
  });

  it("view=card restores S3-only publication dates, view absent unchanged", async () => {
    const f = await revisionFixture();
    const citySlug = `synthetic-card-${randomUUID().slice(0, 8)}`;
    const record = buildRawDocumentRecord({
      source: "proces-verbaux-westmount",
      sourceUrl: "https://westmount.ca/pv/2026-11-02.pdf",
      title: "Proces-verbal",
      publishedAt: "2026-11-02",
      body: new TextEncoder().encode("%PDF-1.4"),
      fetchedAt: "2026-11-03T12:00:00.000Z",
      contentType: "application/pdf",
      provenance: { version: "1.0.0", userAgent: "radar/test", viaObscura: false },
    });
    const props = {
      secretKey: "drop",
      refs: [{ docSha: record.sha256, rawRef: record.storageKey, excerpt: "preuve", page: 2 }],
    };
    await f.db.insert(graphNodes).values({
      id: randomUUID(), type: "Signal", citySlug, label: "Undated graph signal", props,
    });
    const metaKey = rawMetaKey(record.storageKey);
    const metaBytes = new TextEncoder().encode(JSON.stringify(record));
    const head = vi.fn(async (key: string) =>
      key === metaKey ? { key, size: metaBytes.byteLength } : null);
    const get = vi.fn(async (key: string) => {
      if (key !== metaKey) throw new Error(`missing ${key}`);
      return metaBytes;
    });
    const store = { head, get } as unknown as ObjectStore;
    const app = appFor(f, { sub: f.contributor.sub }, store);
    const base = `/api/v1/workspaces/${f.workspaceId}/signal-facets/coherent-city?citySlug=${citySlug}&mode=signal`;

    const full = await (await app.request(base)).json() as {
      signals: Array<{ publishedAt: string | null; props: Record<string, unknown> }>;
    };
    expect(full.signals[0]!.props).toEqual(props);

    const cardRes = await app.request(`${base}&view=card`);
    expect(cardRes.status).toBe(200);
    const card = await cardRes.json() as {
      signals: Array<{
        publishedAt: string | null;
        docRefs: Array<{ publishedAt?: string }>;
        evidence: { documentDate: string | null };
        props: Record<string, unknown>;
      }>;
    };
    expect(card.signals[0]!.publishedAt).toBe("2026-11-02");
    expect(card.signals[0]!.docRefs[0]!.publishedAt).toBe("2026-11-02");
    expect(card.signals[0]!.evidence.documentDate).toBe("2026-11-02");
    expect(card.signals[0]!.props).not.toHaveProperty("secretKey");
  });
});
