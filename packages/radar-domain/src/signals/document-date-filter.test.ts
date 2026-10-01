import { describe, expect, it } from "vitest";
import { documentRefCivilDate, matchesDocumentDateWindow } from "./document-date-filter.js";

const period = { dateFrom: "2026-09-29", dateTo: "2026-09-30" };
const september = { publishedAt: "2026-09-29", fetchedAt: "2026-09-29T12:00:00.000Z" };
const july = { publishedAt: "2026-07-28", fetchedAt: "2026-09-30T12:00:00.000Z" };

describe("document date window", () => {
  it("uses the document clock by default and the scrape clock only when selected", () => {
    const props = { refs: [july], etape_date: "2026-09-29", createdAt: "2026-09-30" };
    expect(matchesDocumentDateWindow(props, period)).toBe(false);
    expect(matchesDocumentDateWindow(props, { ...period, dateBasis: "scrap" })).toBe(true);
  });

  it("admits all four September results and excludes both July results", () => {
    const rows = ["event-lot", "signal-lot", "event-parcs", "signal-parcs"].map((id) =>
      ({ id, props: { refs: [september] } }));
    rows.push({ id: "event-july", props: { refs: [july] } }, { id: "signal-july", props: { refs: [july] } });
    expect(rows.filter(({ props }) => matchesDocumentDateWindow(props, period)).map(({ id }) => id))
      .toEqual(["event-lot", "signal-lot", "event-parcs", "signal-parcs"]);
  });

  it("does not read event dates, node creation, or S3-enriched DTO dates", () => {
    expect(matchesDocumentDateWindow({ etape_date: "2026-09-29", createdAt: "2026-09-29",
      docRefs: [september], publishedAt: "2026-09-29" }, period)).toBe(false);
    expect(matchesDocumentDateWindow({ refs: [{ publishedAt: "2026-07-28" }],
      docRefs: [september] }, period)).toBe(false);
  });

  it("excludes unknown, partial, invalid or ambiguous dates in a bounded window", () => {
    for (const ref of [{}, { publishedAt: "2026-09" }, { publishedAt: "2026-02-31" },
      { publishedAt: "2026-09-29", documentDate: { status: "unknown" } },
      { publishedAt: "2026-09-29", documentDate: { status: "ambiguous", candidates: ["2026-09-29"] } },
      { documentDate: { status: "known", value: "2026-09", precision: "month" } }]) {
      expect(matchesDocumentDateWindow({ refs: [ref] }, period)).toBe(false);
    }
  });

  it("accepts proven day metadata and rejects contradictory projections", () => {
    const documentDate = { status: "known", value: "2026-09-29", precision: "day" };
    expect(matchesDocumentDateWindow({ refs: [{ documentDate }] }, period)).toBe(true);
    expect(matchesDocumentDateWindow({ refs: [{ documentDate, publishedAt: "2026-07-28" }] }, period)).toBe(false);
  });

  it("compares scrape instants against Quebec civil days independently of machine timezone", () => {
    const beforeMidnight = { fetchedAt: "2026-09-29T00:49:00.000Z" };
    const afterMidnight = { fetchedAt: "2026-09-29T04:00:00.000Z" };
    expect(documentRefCivilDate(beforeMidnight, "scrap")).toBe("2026-09-28");
    expect(documentRefCivilDate(afterMidnight, "scrap")).toBe("2026-09-29");
    expect(matchesDocumentDateWindow({ refs: [beforeMidnight] }, { ...period, dateBasis: "scrap" })).toBe(false);
    expect(matchesDocumentDateWindow({ refs: [afterMidnight] }, { ...period, dateBasis: "scrap" })).toBe(true);
    expect(documentRefCivilDate({ fetchedAt: "2026-11-01T05:30:00Z" }, "scrap")).toBe("2026-11-01");
    expect(documentRefCivilDate({ fetchedAt: "2026-11-01T06:30:00Z" }, "scrap")).toBe("2026-11-01");
  });

  it("keeps an undated document in scrape mode without inventing its document date", () => {
    const props = { refs: [{ fetchedAt: september.fetchedAt }] };
    expect(matchesDocumentDateWindow(props, period)).toBe(false);
    expect(matchesDocumentDateWindow(props, { ...period, dateBasis: "scrap" })).toBe(true);
    expect(documentRefCivilDate({ fetchedAt: "2026-09-29" }, "scrap")).toBeNull();
  });

  it("counts a multi-document result once if any reference matches, including nested refs", () => {
    const props = { refs: [july, {}], properties: { refs: [september, september] } };
    expect(matchesDocumentDateWindow(props, period)).toBe(true);
    expect(matchesDocumentDateWindow({ refs: [july, {}] }, period)).toBe(false);
  });

  it("supports inclusive one-sided bounds and rejects malformed bounded periods", () => {
    expect(matchesDocumentDateWindow({ refs: [september] }, { dateFrom: "2026-09-29" })).toBe(true);
    expect(matchesDocumentDateWindow({ refs: [september] }, { dateTo: "2026-09-29" })).toBe(true);
    expect(matchesDocumentDateWindow({ refs: [september] }, { dateFrom: "2026-09-30" })).toBe(false);
    expect(matchesDocumentDateWindow({ refs: [september] }, { dateFrom: "2026-09-31" })).toBe(false);
    expect(matchesDocumentDateWindow({ refs: [september] }, { dateFrom: "2026-09-30", dateTo: "2026-09-29" })).toBe(false);
  });

  it("keeps all results without bounds, including unknown and ambiguous dates", () => {
    for (const props of [null, {}, { refs: [{}] }, { refs: [{ documentDate: { status: "ambiguous" } }] }]) {
      expect(matchesDocumentDateWindow(props)).toBe(true);
      expect(matchesDocumentDateWindow(props, { dateBasis: "scrap" })).toBe(true);
    }
  });
});
