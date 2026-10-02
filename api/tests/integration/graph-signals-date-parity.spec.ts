/**
 * #786 — aggregate (rail counter) and city detail must apply the same date
 * clock and the same display exclusions. Reproduces the Val-des-Monts shape:
 * four results citing the 2026-09-29 agenda, two citing the 2026-07-28 agenda
 * collected in September, every node inserted in September.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import {
  DEFAULT_VIVIER_B_EXCLUSIONS,
  isHiddenByVivierBExclusions,
  matchesDocumentDateWindow,
  type DocumentDateWindow,
} from "@radar/domain";
import { loadConfig } from "../../src/config.js";
import { createDb } from "../../src/db/client.js";
import { graphNodes } from "../../src/db/schema.js";
import { graphSignalsRoute } from "../../src/routes/graph-signals.js";
import { createObjectStore } from "../../src/storage/s3-object-store.js";

const config = loadConfig();
const { db, pool } = createDb(config);
const store = createObjectStore(config);
const city = "val-des-monts-786-parity";
// Stock refs (published before #788): no documentary date on the ref, only the stage date read in the document.
const stageCity = "val-des-monts-786-stage-only";

const september = {
  docSha: "a".repeat(64),
  documentDate: { status: "known", value: "2026-09-29", precision: "day", kind: "document", method: "header" },
  publishedAt: "2026-09-29",
  // 21:30 in Quebec on 2026-09-29.
  fetchedAt: "2026-09-30T01:30:00.000Z",
};
const july = {
  docSha: "b".repeat(64),
  documentDate: { status: "known", value: "2026-07-28", precision: "day", kind: "document", method: "manifest" },
  publishedAt: "2026-07-28",
  fetchedAt: "2026-09-29T14:00:00.000Z",
};

function node(id: string, ref: Record<string, unknown>, properties: Record<string, unknown> = {},
  citySlug = city) {
  return {
    id: `${citySlug}-${id}`,
    type: "Signal",
    label: `Avis de motion — projet de ${id} logements`,
    citySlug,
    props: {
      refs: [{ ...ref, excerpt: "Projet de huit logements" }],
      properties: { category: "rezonage", etape: "avis_motion", nb_unites_max: "8", ...properties },
    },
    sourceRef: null,
    // Node creation is never a period clock.
    createdAt: new Date("2026-09-29T15:00:00.000Z"),
  };
}

const rows = [
  node("s1", september, { etape_date: "2026-09-29" }),
  node("s2", september, { etape_date: "2026-09-29" }),
  node("s3", september),
  { ...node("s4", september, { category: "derogation" }), label: "Dérogation mineure — quatre logements" },
  // Legacy business-date fields in September must not pull July documents in.
  node("j1", july, { etape_date: "2026-09-29" }),
  node("j2", july),
];

const undated = { docSha: "c".repeat(64), rawRef: `raw/proces-verbaux-x/cas/${"c".repeat(64)}.pdf`,
  fetchedAt: "2026-09-30T14:00:00.000Z" };
const stageRows = [
  // Stage date only: placed by the stage date in document mode, by fetchedAt in scrape mode.
  node("st1", undated, { etape_date: "2026-09-29" }, stageCity),
  node("st2", undated, { etapeDate: "2026-07-15" }, stageCity),
  // No stage date and no documentary date: excluded from every bounded document window.
  node("st3", undated, {}, stageCity),
];
const allRows = [...rows, ...stageRows];

beforeAll(async () => {
  await store.ensureBucket();
  await db.delete(graphNodes).where(inArray(graphNodes.id, allRows.map((row) => row.id)));
  await db.insert(graphNodes).values(allRows);
});

afterAll(async () => {
  await db.delete(graphNodes).where(inArray(graphNodes.id, allRows.map((row) => row.id)));
  await pool.end();
});

interface DetailNode {
  label: string;
  description?: string | null;
  props: Record<string, unknown>;
  classification: { instrument: string | null };
}

async function compare(window: DocumentDateWindow, exclusions = DEFAULT_VIVIER_B_EXCLUSIONS, target = city) {
  const app = graphSignalsRoute({ db, store });
  const query = new URLSearchParams({
    ...(window.dateFrom ? { dateFrom: window.dateFrom } : {}),
    ...(window.dateTo ? { dateTo: window.dateTo } : {}),
    ...(window.dateBasis === "scrap" ? { dateBasis: "scrap" } : {}),
    ...(exclusions.piiaSansProjetResidentiel ? { excludePiia: "1" } : {}),
    ...(exclusions.derogationsMineures ? { excludeDerogations: "1" } : {}),
  });
  const aggregateRes = await app.request(`/api/graph-signals/by-city?${query}`);
  expect(aggregateRes.status).toBe(200);
  const aggregate = (await aggregateRes.json()) as {
    cities: { citySlug: string; signalCount: number; vivierV2Counts: { total: number } }[];
  };
  const counts = aggregate.cities.find((entry) => entry.citySlug === target);

  const detailRes = await app.request(`/api/graph-signals/${target}`);
  expect(detailRes.status).toBe(200);
  const detail = (await detailRes.json()) as { nodes: DetailNode[] };
  // Same predicates as the UI detail pipeline (filterNodesByDocumentDate, then B exclusions).
  const dated = detail.nodes.filter((entry) => matchesDocumentDateWindow(entry.props, window));
  const visibleInB = dated.filter((entry) => !isHiddenByVivierBExclusions(entry, exclusions));
  return {
    aggregateA: counts?.signalCount ?? 0,
    aggregateB: counts?.vivierV2Counts.total ?? 0,
    detailA: dated.length,
    detailB: visibleInB.length,
  };
}

describe("graph signal aggregate/detail date parity (#786)", () => {
  it("counts only the September document in document mode, identically in both views", async () => {
    const result = await compare({ dateBasis: "document", dateFrom: "2026-09-29", dateTo: "2026-09-30" });
    expect(result).toEqual({ aggregateA: 4, detailA: 4, aggregateB: 3, detailB: 3 });
  });

  it("keeps July documents in July in document mode", async () => {
    const result = await compare({ dateBasis: "document", dateFrom: "2026-07-01", dateTo: "2026-07-31" });
    expect(result).toEqual({ aggregateA: 2, detailA: 2, aggregateB: 2, detailB: 2 });
  });

  it("uses the Quebec collection day in scrape mode, identically in both views", async () => {
    const both = await compare({ dateBasis: "scrap", dateFrom: "2026-09-29", dateTo: "2026-09-30" });
    expect(both).toEqual({ aggregateA: 6, detailA: 6, aggregateB: 5, detailB: 5 });
    const nextDay = await compare({ dateBasis: "scrap", dateFrom: "2026-09-30", dateTo: "2026-09-30" });
    expect(nextDay).toEqual({ aggregateA: 0, detailA: 0, aggregateB: 0, detailB: 0 });
  });

  it("matches without display exclusions and without a period", async () => {
    const none = { piiaSansProjetResidentiel: false, derogationsMineures: false };
    expect(await compare({ dateBasis: "document", dateFrom: "2026-09-29", dateTo: "2026-09-30" }, none))
      .toEqual({ aggregateA: 4, detailA: 4, aggregateB: 4, detailB: 4 });
    expect(await compare({}, none)).toEqual({ aggregateA: 6, detailA: 6, aggregateB: 6, detailB: 6 });
  });

  it("falls back to the stage date for undated refs, identically in both views", async () => {
    const none = { piiaSansProjetResidentiel: false, derogationsMineures: false };
    expect(await compare({ dateBasis: "document", dateFrom: "2026-09-29", dateTo: "2026-09-30" }, none, stageCity))
      .toEqual({ aggregateA: 1, detailA: 1, aggregateB: 1, detailB: 1 });
    expect(await compare({ dateBasis: "document", dateFrom: "2026-07-01", dateTo: "2026-07-31" }, none, stageCity))
      .toEqual({ aggregateA: 1, detailA: 1, aggregateB: 1, detailB: 1 });
    // Scrape mode ignores the stage date: all three were collected on 2026-09-30.
    expect(await compare({ dateBasis: "scrap", dateFrom: "2026-09-29", dateTo: "2026-09-29" }, none, stageCity))
      .toEqual({ aggregateA: 0, detailA: 0, aggregateB: 0, detailB: 0 });
    expect(await compare({ dateBasis: "scrap", dateFrom: "2026-09-30", dateTo: "2026-09-30" }, none, stageCity))
      .toEqual({ aggregateA: 3, detailA: 3, aggregateB: 3, detailB: 3 });
  });
});
