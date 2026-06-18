import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  fetchSignalDetail,
  resolveSignalDetailUrl,
  type SignalDetailResponse,
} from "./signal-detail-client.js";

describe("resolveSignalDetailUrl", () => {
  it("returns path directly when no baseUrl", () => {
    expect(resolveSignalDetailUrl("saint-constant", "")).toBe(
      "/api/signals/saint-constant/detail",
    );
  });

  it("appends path to baseUrl stripping trailing slash", () => {
    expect(resolveSignalDetailUrl("saint-constant", "http://localhost:3000/")).toBe(
      "http://localhost:3000/api/signals/saint-constant/detail",
    );
  });

  it("URL-encodes the city slug", () => {
    expect(resolveSignalDetailUrl("ville avec espaces", "")).toBe(
      "/api/signals/ville%20avec%20espaces/detail",
    );
  });
});

const MOCK_DETAIL_OK: SignalDetailResponse = {
  ok: true,
  citySlug: "saint-constant",
  events: [
    {
      label: "Avis de motion règlement de zonage 1926-26+1927-26 (zone H-431)",
      reglementNumbers: ["1926-26", "1927-26"],
      zoneRefs: ["H-431"],
      sourceRef:
        "raw/proces-verbaux-saint-constant/2026/05/19/abc123.txt",
      dateObserved: "2026-05-19T12:00:00.000Z",
      evidence: {
        description: null,
        citation: null,
        excerpt: null,
        sourceUrl: null,
        documentUrl: null,
        rawRef: "raw/proces-verbaux-saint-constant/2026/05/19/abc123.txt",
        rawObjectKey: "raw/proces-verbaux-saint-constant/2026/05/19/abc123.txt",
        sourceRef: "raw/proces-verbaux-saint-constant/2026/05/19/abc123.txt",
        documentDate: "2026-05-19",
        page: null,
        bbox: null,
        refs: [
          {
            docSha: null,
            citation: null,
            excerpt: null,
            sourceUrl: null,
            documentUrl: null,
            rawRef:
              "raw/proces-verbaux-saint-constant/2026/05/19/abc123.txt",
            rawObjectKey:
              "raw/proces-verbaux-saint-constant/2026/05/19/abc123.txt",
            page: null,
            bbox: null,
          },
        ],
        completeness: {
          hasDescription: false,
          hasCitationExcerpt: false,
          hasPdfLink: true,
          hasDocumentDate: true,
          hasPage: false,
          hasBbox: false,
          missing: ["description", "citation", "page", "bbox"],
        },
      },
    },
  ],
};

const MOCK_DETAIL_EMPTY: SignalDetailResponse = {
  ok: true,
  citySlug: "sainte-catherine",
  events: [],
};

describe("fetchSignalDetail", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      async () => new Response(JSON.stringify(MOCK_DETAIL_OK), { status: 200 }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns parsed events from the API", async () => {
    const res = await fetchSignalDetail("saint-constant", "");
    expect(res.ok).toBe(true);
    expect(res.citySlug).toBe("saint-constant");
    expect(res.events).toHaveLength(1);

    const event = res.events[0]!;
    expect(event.label).toContain("1926-26");
    expect(event.reglementNumbers).toContain("1926-26");
    expect(event.reglementNumbers).toContain("1927-26");
    expect(event.zoneRefs).toContain("H-431");
    expect(event.sourceRef).toMatch(/^raw\//);
    expect(event.evidence.documentDate).toBe("2026-05-19");
    expect(event.evidence.completeness.missing).toContain("citation");
    expect(event.evidence.completeness.missing).toContain("bbox");
  });

  it("returns empty events list for unseeded city", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify(MOCK_DETAIL_EMPTY), { status: 200 }),
    );
    const res = await fetchSignalDetail("sainte-catherine", "");
    expect(res.ok).toBe(true);
    expect(res.events).toHaveLength(0);
  });

  it("throws on HTTP error", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response("{}", { status: 500 }),
    );
    await expect(fetchSignalDetail("saint-constant", "")).rejects.toThrow(
      "signals/detail HTTP 500",
    );
  });

  it("throws when api returns ok=false", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({ ok: false, citySlug: "x", events: [] }),
          { status: 200 },
        ),
    );
    await expect(fetchSignalDetail("saint-constant", "")).rejects.toThrow(
      "ok=false",
    );
  });
});
