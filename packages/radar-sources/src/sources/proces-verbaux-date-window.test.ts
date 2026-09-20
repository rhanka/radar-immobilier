/**
 * proces-verbaux-date-window.test.ts — issue #723, defect 2 of 3.
 *
 * `extractIsoFromLabel` could not read a date out of a file name that glues its
 * parts with an underscore, because `_` is a word character and `\b` therefore
 * never fires before the year in `Proces_verbal_2016_01_18.pdf`. An undated
 * item is kept by `filterPvByWindow` whatever the window, so the 183-day window
 * bounded almost nothing: measured on the real drummondville index of
 * 2026-09-20, 255 documents were fetched per run, 240 of them undatable, and
 * one was a dead 2016 link that cost the whole city.
 *
 * Every form asserted below is taken VERBATIM from that index or from this
 * repository's own PV fixtures — none is invented for the test.
 */
import { describe, expect, it } from "vitest";

import {
  extractIsoFromLabel,
  filterPvByWindow,
  PV_NON_DISPONIBLE,
  type PvIndexItemT,
} from "./proces-verbaux-parser.js";

describe("extractIsoFromLabel — separators used in the real parc", () => {
  it("reads a date out of an underscore-glued file name (the #723 regression)", () => {
    expect(
      extractIsoFromLabel(
        "ordre du jour https://www.drummondville.ca/wp-content/uploads/2015/10/Proces_verbal_2016_01_18.pdf",
      ),
    ).toBe("2016-01-18");
  });

  it.each([
    // year-first, every separator observed
    ["PV_2026-04-20.pdf", "2026-04-20"],
    ["pv_ass_2026_06_09.pdf", "2026-06-09"],
    ["PV.2026.03.10.pdf", "2026-03-10"],
    ["seance-2026/03/10", "2026-03-10"],
    // compact year-first (81 of 438 document names in the repo's PV fixtures)
    ["PV20260310.pdf", "2026-03-10"],
    // day-first, year last (48 names on the drummondville index)
    ["ODJ_15-06-2026.pdf", "2026-06-15"],
    ["Ordre-du-jour-extraordinaire-23-07-2026-2.pdf", "2026-07-23"],
    ["ODJ_20-01-2025pdf.pdf", "2025-01-20"],
    // French month glued by hyphens or underscores
    ["Ordre-du-jour-9-aout-2021.pdf", "2021-08-09"],
    ["Tableau-de-suivi-de-la-periode-de-questions-24-aout-2026.pdf", "2026-08-24"],
    // forms that already worked, kept as a non-regression net
    ["séance du 10 mars 2025", "2025-03-10"],
    ["1er octobre 2025", "2025-10-01"],
    ["2025-03-10", "2025-03-10"],
    ["Mars 2025", "2025-03"],
    ["pv-2025-03.pdf", "2025-03"],
  ])("reads %s as %s", (label, expected) => {
    expect(extractIsoFromLabel(label)).toBe(expected);
  });

  it("does not read a version string as a date: the same separator is required on both sides", () => {
    expect(extractIsoFromLabel("annexe-v1.2-2026.pdf")).toBe(PV_NON_DISPONIBLE);
  });

  it("rejects an out-of-range numeric date rather than inventing a month", () => {
    expect(extractIsoFromLabel("rapport-2025-99-99.pdf")).toBe(PV_NON_DISPONIBLE);
  });

  it("does NOT date a document by its WordPress upload path, which is not the session date", () => {
    // `/uploads/2015/10/` is when the file was uploaded, not when the council
    // sat. It must not silently become `publishedAt` (the valid-time axis).
    expect(
      extractIsoFromLabel("ordre du jour https://ville.qc.ca/wp-content/uploads/2015/10/ordrejour.pdf"),
    ).toBe(PV_NON_DISPONIBLE);
  });

  it("stays undated when the label carries a year but no readable month", () => {
    expect(extractIsoFromLabel("Politique_confidentialite_ville_2023.pdf"))
      .toBe(PV_NON_DISPONIBLE);
  });

  it("does not read a day out of the middle of a longer number", () => {
    // `1234-mai-2020` must not become "day 34 of May 2020": the month-year rule
    // takes over and yields the month only.
    expect(extractIsoFromLabel("reglement-1234-mai-2020.pdf")).toBe("2020-05");
  });

  it("keeps looking when the first structural match is not a month name", () => {
    // "du-jour" fits the shape `digits glue word glue year` in many names; a
    // single `.match()` would stop there and lose the real date behind it.
    expect(extractIsoFromLabel("Ordre du jour 3 - assemblee 5 mai 2026"))
      .toBe("2026-05-05");
  });
});

describe("filterPvByWindow — what the fixed dates change", () => {
  const since = "2026-03-21";
  const until = "2026-09-20";
  const item = (title: string, url: string): PvIndexItemT => ({
    title,
    url,
    dateIso: extractIsoFromLabel(
      /\d{4}/.test(title) ? title : `${title} ${url}`,
    ),
    dateLabel: title,
    docType: "ordre-du-jour",
  });

  it("excludes the 2016 dead link that used to be fetched on every run", () => {
    const dead = item(
      "Ordre du jour",
      "https://www.drummondville.ca/wp-content/uploads/2015/10/Proces_verbal_2016_01_18.pdf",
    );
    expect(dead.dateIso).toBe("2016-01-18");
    expect(filterPvByWindow([dead], since, until)).toEqual([]);
  });

  it("still keeps a genuinely undated item, because a NEW PV may carry no date", () => {
    const undated = item("Ordre du jour", "https://ville.qc.ca/docs/ordrejour.pdf");
    expect(undated.dateIso).toBe(PV_NON_DISPONIBLE);
    expect(filterPvByWindow([undated], since, until)).toEqual([undated]);
  });
});
