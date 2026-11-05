/* eslint-disable @typescript-eslint/no-explicit-any -- assertions probe the served JSON shape */
// J1.2d/e wagon 8 — parity of the named reader ops against the app routes
// (field review J1.2b §14.3): same cities, counters, visible signals and
// evidence pages as the app, for the same reader and the same filters, on
// one PostgreSQL fixture (including the effect of personal and workspace
// triage). Requires LOT_MIGRATION_DB_TEST=1 like every scoped DB spec.
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { graphNodes } from "../../src/db/schema.js";
import type { ObjectStore } from "../../src/storage/object-store.js";
import { EMPTY_DISCARDED_SIGNALS } from "../../src/services/graph/discarded-signals.js";
import { describeDb, workspaceFixture, workspaceSignal } from "../../src/services/facets/workspace-archive-fixture.js";
import { createBasketReadOperation } from "../../src/artifacts/reader-baskets.js";
import { validateReaderResponse } from "../../src/artifacts/reader-responses.js";
import { createReaderDocumentRead } from "../../src/artifacts/reader-documents.js";
import type { ApiReaderContext } from "../../src/artifacts/reader-context.js";
import { baseAuth, baseCookie } from "./base-api-fixture.js";

const CITY = "synthetic-city";
const PDF = new TextEncoder().encode("%PDF-1.7\n%parity\n");

type Body = Record<string, any>;

async function parityFixture() {
  const data = await workspaceFixture();
  // Metadata-less store: no S3 enrichment on either side (same degraded cards).
  const store = { head: async () => null } as unknown as ObjectStore;
  const app = createApp({ checkDb: async () => ({ ok: true }), checkObjectStore: async () => ({ ok: true }),
    store, db: data.db, discarded: EMPTY_DISCARDED_SIGNALS, auth: baseAuth });
  const shaA = randomUUID().replace(/-/g, "").padEnd(64, "a").slice(0, 64);
  const shaB = randomUUID().replace(/-/g, "").padEnd(64, "b").slice(0, 64);
  const proof = await data.db.insert(graphNodes).values({ id: randomUUID(), type: "Signal", citySlug: CITY,
    label: "Avis de motion — zone H-12", sourceRef: `raw/proces-verbaux-${CITY}/cas/${shaA}.pdf`,
    props: { description: "Avis de motion visant la zone H-12.", status: "avis-motion",
      refs: [
        { docSha: shaA, rawRef: `raw/proces-verbaux-${CITY}/cas/${shaA}.pdf`, excerpt: "Extrait page 4.", page: 4,
          fetchedAt: "2026-02-01T00:00:00.000Z", publishedAt: "2026-01-20" },
        { docSha: shaB, rawRef: `raw/proces-verbaux-${CITY}/cas/${shaB}.pdf`, excerpt: "Extrait page 9.", page: 9 },
      ],
      properties: { category: "zonage", etape: "avis_motion", zone_ref: ["H-12"], adresse: "123 rue Secrète" } },
  }).returning();
  const discarded = await workspaceSignal(data, "Signal archivé personnellement");
  const moderated = await workspaceSignal(data, "Signal archivé par le workspace");
  await workspaceSignal(data, "Signal visible sans preuve");
  await data.db.insert(graphNodes).values({ id: randomUUID(), type: "DesignationEvent", citySlug: "synthetic-other",
    label: "Désignation", props: { properties: { category: "zonage", etape: "adoption" } } });
  const path = (suffix: string) => `/api/v1/workspaces/${data.workspaceId}/signal-facets/${suffix}`;
  const request = async (url: string, sub: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("cookie", await baseCookie(sub));
    return app.request(url, { ...init, headers });
  };
  const discard = async (family: "personal" | "workspace", signal: Awaited<ReturnType<typeof workspaceSignal>>,
    sub: string) => {
    const res = await request(path(`${family}/discard`), sub, { method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": randomUUID() },
      body: JSON.stringify({ target: signal.target, displayedFingerprint: signal.fingerprint,
        expectedHeadId: null, reasonCode: "N-NON-RES" }) });
    expect(res.status).toBe(200);
  };
  await discard("personal", discarded, data.contributor.sub);
  await discard("workspace", moderated, data.moderator.sub);
  const read = createBasketReadOperation({ db: data.db, store });
  const op = async (name: "signals.by-city.v1" | "signals.coherent-city.v1", params: Record<string, string>, sub: string) =>
    validateReaderResponse(name, await read(name, { workspaceId: data.workspaceId, ...params },
      { readerSub: sub, artifactId: "parity-artifact" } as ApiReaderContext), sub) as Body;
  return { data, proof: proof[0]!, shaA, shaB, discarded, moderated, path, request, op, store };
}

describeDb("reader ops parity with the app routes (§14.3)", () => {
  it("signals.by-city.v1 serves the app cities and counters for the same reader and filters", async () => {
    const f = await parityFixture();
    const filters: Array<Record<string, string>> = [
      {},
      { dateFrom: "2026-01-01", dateTo: "2026-12-31", excludePiia: "1", excludeDerogations: "1" },
      { dateBasis: "scrap" },
      { dateBasis: "document", dateFrom: "2020-01-01" },
    ];
    for (const sub of [f.data.contributor.sub, f.data.moderator.sub]) {
      for (const filter of filters) {
        const qs = new URLSearchParams(filter).toString();
        const app = await f.request(f.path(`by-city${qs ? `?${qs}` : ""}`), sub);
        expect(app.status).toBe(200);
        const appBody = await app.json() as Body;
        const opBody = await f.op("signals.by-city.v1", filter, sub);
        expect(opBody).toEqual(appBody);
      }
    }
    // Triage effect is the app's: the contributor's personal archive hides one
    // more signal for him only; the workspace archive hides one for both.
    const mine = await f.op("signals.by-city.v1", {}, f.data.contributor.sub);
    const theirs = await f.op("signals.by-city.v1", {}, f.data.moderator.sub);
    const count = (body: Body) => body.cities.find((city: Body) => city.citySlug === CITY)?.signalCount ?? 0;
    expect(count(theirs) - count(mine)).toBe(1);
  });

  it("signals.coherent-city.v1 serves the app visible signals, order, counters and evidence pages", async () => {
    const f = await parityFixture();
    for (const sub of [f.data.contributor.sub, f.data.moderator.sub]) {
      const app = await f.request(f.path(`coherent-city?citySlug=${CITY}&mode=signal`), sub);
      expect(app.status).toBe(200);
      const appBody = await app.json() as Body;
      const opBody = await f.op("signals.coherent-city.v1", { citySlug: CITY, mode: "signal" }, sub);
      // Same visible population, same order, same counters, same legacy A.
      expect(opBody.signals.map((signal: Body) => signal.id)).toEqual(appBody.signals.map((signal: Body) => signal.id));
      expect(opBody.counts).toEqual(appBody.counts);
      expect(opBody.legacyProjection).toEqual(appBody.legacyProjection);
      for (const [index, appSignal] of (appBody.signals as Body[]).entries()) {
        const opSignal = opBody.signals[index] as Body;
        for (const key of ["type", "label", "citySlug", "createdAt", "description", "publishedAt", "etape",
          "regulatoryStatus", "legacySubset"]) {
          expect(opSignal[key]).toEqual(appSignal[key]);
        }
        expect(opSignal.classification).toEqual({ ...appSignal.classification,
          provenance: { extrait: appSignal.classification.provenance.extrait,
            ...(appSignal.classification.provenance.source ? { source: "served" } : {}) } });
        // Evidence pages and excerpts: same documents, same pages, same text.
        expect(opSignal.docRefs.map((ref: Body) => [ref.docSha, ref.page ?? null, ref.excerpt ?? null]))
          .toEqual(appSignal.docRefs.filter((ref: Body) => /^[a-f0-9]{64}$/.test(ref.docSha))
            .map((ref: Body) => [ref.docSha, ref.page ?? null, ref.excerpt ?? null]));
        expect(opSignal.evidence.page).toEqual(appSignal.evidence.page);
        expect(opSignal.evidence.excerpt).toEqual(appSignal.evidence.excerpt);
        expect(opSignal.evidence.refs.map((ref: Body) => ref.page)).toEqual(appSignal.evidence.refs.map((ref: Body) => ref.page));
      }
      // What the op never serves, whatever the app does.
      const wire = JSON.stringify(opBody);
      for (const leak of ["raw/", "123 rue Secrète", "facetFingerprint", "\"revisions\"", "\"selection\""]) {
        expect(wire).not.toContain(leak);
      }
      expect(opBody.heads).toEqual([]);
      expect(appBody.heads.length).toBeGreaterThan(0);
    }
    const contributor = await f.op("signals.coherent-city.v1", { citySlug: CITY, mode: "signal" }, f.data.contributor.sub);
    const ids = contributor.signals.map((signal: Body) => signal.id);
    expect(ids).toContain(f.proof.id);
    expect(ids).not.toContain(f.discarded.node.id);
    expect(ids).not.toContain(f.moderated.node.id);
    expect(JSON.stringify(contributor.legacyProjection)).not.toContain(f.discarded.node.id);
  });

  it("documents.pv.v1 resolves the evidence PDF of a visible signal only, from its stored key", async () => {
    const f = await parityFixture();
    const keys: string[] = [];
    const resolve = createReaderDocumentRead({ db: f.data.db, store: f.store,
      readRaw: async (rawRef) => { keys.push(rawRef); return { kind: "ok", bytes: PDF, contentType: "application/pdf" }; } });
    const ctx = (sub: string) => ({ readerSub: sub, artifactId: "parity-artifact" } as ApiReaderContext);
    const coherent = await f.op("signals.coherent-city.v1", { citySlug: CITY, mode: "signal" }, f.data.contributor.sub);
    const proof = (coherent.signals as Body[]).find((signal) => signal.id === f.proof.id)!;
    // Every evidence page served by the DTO opens through its own op URL.
    for (const ref of proof.docRefs as Body[]) {
      const url = new URL(ref.documentUrl, "https://content.example.test");
      expect(url.pathname).toBe("/__reader/api/documents.pv.v1");
      const params = Object.fromEntries(url.searchParams) as never;
      expect(await resolve(params, ctx(f.data.contributor.sub))).toEqual({ kind: "pdf", bytes: PDF });
    }
    expect(keys).toEqual([`raw/proces-verbaux-${CITY}/cas/${f.shaA}.pdf`, `raw/proces-verbaux-${CITY}/cas/${f.shaB}.pdf`]);
    const base = { workspaceId: f.data.workspaceId, citySlug: CITY, type: "Signal" as const };
    // Another signal's docSha, an archived target, an outsider: closed answers, no store read.
    keys.length = 0;
    expect(await resolve({ ...base, id: f.discarded.node.id, docSha: f.shaA }, ctx(f.data.contributor.sub)))
      .toEqual({ kind: "not_found" });
    expect(await resolve({ ...base, id: f.moderated.node.id, docSha: f.shaA }, ctx(f.data.moderator.sub)))
      .toEqual({ kind: "not_found" });
    const outsider = await resolve({ ...base, id: f.proof.id, docSha: f.shaA }, ctx(f.data.outsider.sub));
    expect(outsider.kind === "refused" || outsider.kind === "not_found").toBe(true);
    expect(keys).toEqual([]);
  });
});
