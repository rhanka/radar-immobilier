import { describe, expect, it } from "vitest";

import type { LiveScrapeCityRecap } from "../sources/live-scrape.js";
import type { ObjectInfo, ObjectStore } from "../../storage/object-store.js";
import { refreshCorpusInputHash } from "./refresh-corpus.js";
import { acquireRefreshPdfCandidates, orderRefreshPdfCandidates,
  refreshSourceDelayMs, writeRefreshPdfManifest } from "./refresh-run.js";

class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, Uint8Array>();

  async get(key: string): Promise<Uint8Array> {
    const body = this.objects.get(key);
    if (!body) throw new Error(`missing ${key}`);
    return body;
  }

  async head(key: string): Promise<ObjectInfo | null> {
    const body = this.objects.get(key);
    return body ? { key, size: body.byteLength } : null;
  }

  async put(key: string, body: Uint8Array | Buffer | string): Promise<ObjectInfo> {
    const bytes = typeof body === "string" ? new TextEncoder().encode(body) : new Uint8Array(body);
    this.objects.set(key, bytes);
    return { key, size: bytes.byteLength };
  }
}

const sha = (digit: string) => digit.repeat(64);

describe("acquireRefreshPdfCandidates", () => {
  it("applies the required two-second pacing jitter bounds", () => {
    expect(refreshSourceDelayMs(() => 0)).toBe(1_700);
    expect(refreshSourceDelayMs(() => 0.5)).toBe(2_000);
    expect(refreshSourceDelayMs(() => 0.999999)).toBe(2_300);
  });

  it("offers every exact PDF as a candidate while retaining valid non-PDF evidence", async () => {
    const store = new MemoryStore();
    const sourceId = "proces-verbaux-city";
    const htmlKey = `raw/${sourceId}/cas/${sha("a")}.html`;
    const pdfKey = `raw/${sourceId}/cas/${sha("b")}.pdf`;
    const laterPdfKey = `raw/${sourceId}/cas/${sha("c")}.pdf`;

    const { candidates } = await acquireRefreshPdfCandidates({ citySlug: "city", store,
      acquire: async () => [{ city: "city", sourceId, status: "new",
        casKeys: [htmlKey, pdfKey, laterPdfKey], count: 3 }] });

    // Both PDFs remain reachable — that is what lets a later run advance to the
    // second one instead of declaring the city up to date.
    expect(candidates.map((candidate) => candidate.representationKey))
      .toEqual([pdfKey, laterPdfKey]);
    // The manifest still freezes exactly ONE document.
    const manifest = new TextDecoder().decode(
      await store.get(await writeRefreshPdfManifest(store, candidates[0]!)));
    expect(manifest).toContain(pdfKey);
    expect(manifest).not.toContain(htmlKey);
    expect(manifest).not.toContain(laterPdfKey);
  });

  it("fails before manifest publication when acquisition has no exact PDF", async () => {
    const store = new MemoryStore();
    const sourceId = "proces-verbaux-city";
    const htmlKey = `raw/${sourceId}/cas/${sha("a")}.html`;

    await expect(acquireRefreshPdfCandidates({ citySlug: "city", store, acquire: async () => [{
      city: "city", sourceId, status: "seen", casKeys: [htmlKey], count: 1,
    }] })).rejects.toThrow("Selected city acquisition produced no exact PDF: city");
    expect(store.objects.size).toBe(0);
  });

  it("codes its refusals so a whole-list sweep can tell them apart without parsing messages",
    async () => {
      const store = new MemoryStore();
      await expect(acquireRefreshPdfCandidates({ citySlug: "city", store, acquire: async () => [] }))
        .rejects.toMatchObject({ code: "REFRESH_NO_ACQUISITION" });
      await expect(acquireRefreshPdfCandidates({ citySlug: "city", store, acquire: async () => [{
        city: "city", sourceId: "proces-verbaux-city", status: "seen",
        casKeys: [`raw/proces-verbaux-city/cas/${sha("a")}.html`], count: 1,
      }] })).rejects.toMatchObject({ code: "REFRESH_NO_PDF" });
    });
});

describe("orderRefreshPdfCandidates", () => {
  const sourceId = "proces-verbaux-city";
  const key = (digit: string) => `raw/${sourceId}/cas/${sha(digit)}.pdf`;

  function recap(documents: { casKey: string; publishedAt?: string }[]): LiveScrapeCityRecap {
    return {
      city: "city", sourceId, status: "seen", count: documents.length,
      casKeys: documents.map((document) => document.casKey),
      documents: documents.map((document) => ({
        casKey: document.casKey, sha256: document.casKey.slice(-68, -4), status: "seen" as const,
        ...(document.publishedAt ? { publishedAt: document.publishedAt } : {}),
      })),
    };
  }

  it("puts the most recently published document first, whatever order the index page used", () => {
    // An index page that lists its minutes oldest-first is exactly the case the
    // previous positional selection got wrong: it pinned the cycle on the oldest
    // document of the window and never reached the new one.
    const ordered = orderRefreshPdfCandidates(recap([
      { casKey: key("a"), publishedAt: "2026-04-14" },
      { casKey: key("b"), publishedAt: "2026-09-15" },
      { casKey: key("c"), publishedAt: "2026-06-09" },
    ]));

    expect(ordered.map((candidate) => candidate.publishedAt))
      .toEqual(["2026-09-15", "2026-06-09", "2026-04-14"]);
  });

  it("keeps the index order for undated documents and puts them after the dated ones", () => {
    const ordered = orderRefreshPdfCandidates(recap([
      { casKey: key("a") },
      { casKey: key("b"), publishedAt: "2026-01-20" },
      { casKey: key("c") },
    ]));

    expect(ordered.map((candidate) => candidate.representationKey))
      .toEqual([key("b"), key("a"), key("c")]);
  });

  it("keeps only exact PDFs and carries the identity the run state is keyed on", () => {
    const ordered = orderRefreshPdfCandidates(recap([
      { casKey: `raw/${sourceId}/cas/${sha("d")}.html` },
      { casKey: key("e") },
    ]));

    expect(ordered).toHaveLength(1);
    expect(ordered[0]).toMatchObject({ sourceId, citySlug: "city", sha: sha("e"),
      representationKey: key("e"), sidecarKey: `${key("e")}.meta.json` });
    // The identity MUST be the one the corpus recomputes after extraction,
    // otherwise a document would be re-extracted forever under a second identity.
    expect(ordered[0]!.inputHash).toBe(refreshCorpusInputHash([{ sourceId, citySlug: "city",
      sha256: sha("e"), representationKey: key("e") }]));
  });

  it("still works when the recap carries no per-document metadata", () => {
    const ordered = orderRefreshPdfCandidates({ city: "city", sourceId, status: "seen",
      casKeys: [key("a"), key("b")], count: 2 });

    expect(ordered.map((candidate) => candidate.representationKey)).toEqual([key("a"), key("b")]);
  });
});
