import { describe, expect, it } from "vitest";

import {
  BROSSARD_PV_CONFIG,
  ProcesVerbauxGenericAdapter,
} from "./proces-verbaux-generic.js";
import {
  PV_BROSSARD_2022_12_13_HTML,
  PV_BROSSARD_2026_06_16_HTML,
  PV_BROSSARD_SITEMAP_XML,
} from "./proces-verbaux-brossard-sitemap.fixture.js";

const SITEMAP_URL = "https://brossard.ca/council-meeting-sitemap.xml";
const SESSION_2026_URL =
  "https://brossard.ca/conseil-municipal/16-juin-2026/";
const SESSION_2022_URL =
  "https://brossard.ca/conseil-municipal/13-decembre-2022-2/";
const FUTURE_SESSION_URL =
  "https://brossard.ca/conseil-municipal/8-aout-2026/";

function textResponse(body: string) {
  return {
    ok: true as const,
    status: 200,
    headers: { get: (_name: string) => "text/html; charset=utf-8" },
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  };
}

function createFixtureFetch() {
  const pages = new Map([
    [SESSION_2026_URL, PV_BROSSARD_2026_06_16_HTML],
    [SESSION_2022_URL, PV_BROSSARD_2022_12_13_HTML],
    [FUTURE_SESSION_URL, "<html><body>Ordre du jour seulement</body></html>"],
  ]);

  return async (url: string) => {
    if (url === SITEMAP_URL) return textResponse(PV_BROSSARD_SITEMAP_XML);
    const page = pages.get(url);
    if (page === undefined) throw new Error(`Unexpected fixture URL: ${url}`);
    return textResponse(page);
  };
}

describe("ProcesVerbauxGenericAdapter.list() – Brossard sitemap-driven crawl", () => {
  it("filters French session pages and the existing date window", async () => {
    const adapter = new ProcesVerbauxGenericAdapter(BROSSARD_PV_CONFIG, {
      fetchImpl: createFixtureFetch(),
      now: () => new Date("2026-08-03T00:00:00Z"),
      windowDays: 183,
    });

    const refs = [];
    for await (const ref of adapter.list({})) refs.push(ref);

    expect(refs).toHaveLength(1);
    expect(refs[0]?.url).toBe(
      "https://brossard.ca/app/uploads/2026/01/20260616_proces-verbal_Ratifie.pdf",
    );
    expect(refs[0]?.url).not.toContain("/en/");
    expect(refs[0]?.publishedAt).toBe("2026-06-16");
  });

  it("prioritizes the ratified PDF and falls back to the labelled legacy attachment", async () => {
    const adapter = new ProcesVerbauxGenericAdapter(BROSSARD_PV_CONFIG, {
      fetchImpl: createFixtureFetch(),
      now: () => new Date("2026-08-03T00:00:00Z"),
      windowDays: 2_000,
    });

    const refs = [];
    for await (const ref of adapter.list({})) refs.push(ref);

    expect(refs).toHaveLength(2);
    expect(refs.map((ref) => ref.url)).toEqual([
      "https://brossard.ca/app/uploads/2026/01/20260616_proces-verbal_Ratifie.pdf",
      "https://brossard.ca/app/uploads/2025/02/attach_cmsUpload_88f922a1-e14c-4067-8101-b9ce3d48d6fc.pdf",
    ]);
    expect(refs.every((ref) => ref.contentType === "application/pdf")).toBe(
      true,
    );
  });
});
