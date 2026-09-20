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
 *
 * MEASURED, and reproducible: the fixture survey parses every `*_HTML` export of
 * every `proces-verbaux-*.fixture.ts` with `parsePvIndex`, which yields 427
 * document anchors. Undated goes from 140 (`origin/main`) to 68, no anchor loses
 * a date, and the only 29 whose date changes go from `YYYY-MM` to the
 * `YYYY-MM-DD` written in their own file name (mirabel, chateauguay). On the
 * real drummondville index of 2026-09-20 (one GET, 421 630 bytes, 496 links):
 * 255 documents in the 183-day window before, 73 after, and the dead 2016 link
 * is dated 2016-01-18 and therefore OUT of the window — which is #723 closed.
 */
import { describe, expect, it } from "vitest";

import {
  extractIsoFromLabel,
  filterPvByWindow,
  parsePvIndex,
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

// ─────────────────────────────────────────────────────────────────────────────
// REFUSALS. Recognising a date is half the job; the other half is refusing the
// strings that merely LOOK like one. A missing date costs one download (an
// undated item is kept by the window, therefore collected). A wrong date costs
// the document itself: placed outside the window it is never fetched, and
// nothing in the log says so.
// ─────────────────────────────────────────────────────────────────────────────

describe("extractIsoFromLabel — what it must REFUSE", () => {
  it.each([
    // Day-first, year last. There is no rule for it, on purpose: `15-06-2026`
    // is only "15 June" if one assumes the municipality writes JJ-MM-AAAA, and
    // that was measured on ONE index out of 553.
    ["ODJ_15-06-2026.pdf"],
    // The same shape on things that are not dates at all — this is what a
    // day-first rule actually fires on.
    ["annexe-v1-2-2026.pdf"],
    ["note-v2.5.2024.pdf"],
    // Lavaltrie's real bylaw number, verbatim from this repo's own fixture.
    ["Règlement RRU3-2-2026 sur les usages conditionnels"],
    // Version string: the same separator is required on both sides.
    ["annexe-v1.2-2026.pdf"],
    // Out-of-range components: no month 99, no day 99.
    ["rapport-2025-99-99.pdf"],
    // A day that does not exist. The structure fits; the calendar does not.
    ["pv-31-02-2026.pdf"],
    ["20260231.pdf"],
    // Year outside 20xx: a bylaw number, not a date.
    ["reglement-1234-10-25.pdf"],
    ["PV_mars_1234.pdf"],
    // A year with no readable month.
    ["Politique_confidentialite_ville_2023.pdf"],
  ])("refuses %s", (label) => {
    expect(extractIsoFromLabel(label)).toBe(PV_NON_DISPONIBLE);
  });

  it("never lets an impossible DAY through, even when a month survives", () => {
    // `2026-02-31` fails the calendar check, so the full-date rule does not
    // fire. What remains is the month, which IS verbatim in the name — a
    // month-only date, never a fabricated 31 February in `publishedAt`.
    expect(extractIsoFromLabel("pv-2026-02-31.pdf")).toBe("2026-02");
  });
});

describe("parsePvIndex — a WordPress upload path is not a session date", () => {
  const anchors = (...urls: string[]) =>
    parsePvIndex(
      urls.map((u) => `<a href="${u}">Ordre du jour</a>`).join(""),
      "https://www.drummondville.ca/mairie-et-vie-municipale/seances-du-conseil/",
    );

  it("dates a document by its FILE NAME, never by the directories above it", () => {
    // `/uploads/2015/10/` is when the file was uploaded, not when the council
    // sat, and this value goes to `publishedAt` — the valid-time axis. Handing
    // the whole URL to the extractor made "2015/10/18" of
    // `…/uploads/2015/10/18-01-2016-pv.pdf` a date, and fabricated 2026-03-10
    // out of an upload month plus a leading number in the next name.
    const items = anchors(
      "https://www.drummondville.ca/wp-content/uploads/2015/10/18-01-2016-pv.pdf",
      "https://www.drummondville.ca/wp-content/uploads/2026/03/10-proces-verbal.pdf",
      "https://www.drummondville.ca/wp-content/uploads/2019/02/04_PV_seance.pdf",
    );
    expect(items.map((i) => i.dateIso)).toEqual([
      PV_NON_DISPONIBLE, PV_NON_DISPONIBLE, PV_NON_DISPONIBLE,
    ]);
  });

  it("ignores a cache-busting query string", () => {
    const [item] = anchors(
      "https://www.drummondville.ca/wp-content/uploads/2026/09/pv.pdf?ver=20240115",
    );
    expect(item?.dateIso).toBe(PV_NON_DISPONIBLE);
  });

  it("still reads the file name itself — the #723 dead link is dated 2016", () => {
    const [item] = anchors(
      "https://www.drummondville.ca/wp-content/uploads/2015/10/Proces_verbal_2016_01_18.pdf",
    );
    expect(item?.dateIso).toBe("2016-01-18");
  });
});

describe("filterPvByWindow — what the fixed dates change", () => {
  const since = "2026-03-21";
  const until = "2026-09-20";
  // Built through `parsePvIndex`, not by re-implementing its date-source rule:
  // a copy of that rule here would stay green while the parser changed under it.
  const item = (title: string, url: string): PvIndexItemT => {
    const [parsed] = parsePvIndex(`<a href="${url}">${title}</a>`, url);
    if (!parsed) throw new Error(`parsePvIndex yielded nothing for ${url}`);
    return parsed;
  };

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
