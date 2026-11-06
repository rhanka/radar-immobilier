import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceError } from "../services/workspaces/types.js";
import { createReaderDocumentRead, documentsPvParams, isPdfBytes } from "./reader-documents.js";
import type { ApiReaderContext } from "./reader-context.js";

vi.mock("../services/facets/workspace-reader.js", () => ({ readWorkspaceArchiveCity: vi.fn() }));
import { readWorkspaceArchiveCity } from "../services/facets/workspace-reader.js";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const CITY = "valleyfield";
const SHA = "a".repeat(64);
const OTHER_SHA = "d".repeat(64);
const CAS = `raw/proces-verbaux-${CITY}/cas/${SHA}.pdf`;
const PDF = new TextEncoder().encode("%PDF-1.7\n%fixture\n");
const context = { readerSub: "reader-alice", artifactId: "artifact-1" } as ApiReaderContext;
const params = { workspaceId: WORKSPACE, citySlug: CITY, type: "Signal" as const, id: "sig-1", docSha: SHA };

function node(refs: unknown[]) {
  return { id: "sig-1", type: "Signal", label: "Signal", citySlug: CITY, sourceRef: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"), props: { refs } };
}

function setup(rows: unknown[], read = vi.fn(async () => ({ kind: "ok" as const, bytes: PDF, contentType: "application/pdf" }))) {
  const where = vi.fn(async () => rows);
  const db = { select: vi.fn(() => ({ from: () => ({ where }) })) };
  const resolve = createReaderDocumentRead({ db: db as never, store: undefined as never, readRaw: read as never });
  return { resolve, read, db };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readWorkspaceArchiveCity).mockResolvedValue([] as never);
});

describe("documents.pv.v1 resolution (§11.3)", () => {
  it("should resolve the PDF from the stored doc-ref of a visible signal", async () => {
    const { resolve, read } = setup([node([{ docSha: SHA, rawRef: CAS, sourceUrl: "https://ville.example.qc.ca/pv.pdf" }])]);
    expect(await resolve(params, context)).toEqual({ kind: "pdf", bytes: PDF });
    expect(read).toHaveBeenCalledWith(CAS, "https://ville.example.qc.ca/pv.pdf");
    expect(vi.mocked(readWorkspaceArchiveCity).mock.calls[0]!.slice(1)).toEqual(["reader-alice", WORKSPACE, CITY]);
  });

  it("should answer the same 404 for another signal's, unattached or ambiguous docSha", async () => {
    for (const refs of [
      [{ docSha: OTHER_SHA, rawRef: `raw/proces-verbaux-${CITY}/cas/${OTHER_SHA}.pdf` }],
      [],
      [{ docSha: SHA, rawRef: CAS }, { docSha: SHA, rawRef: `raw/other/${SHA}.pdf` }],
    ]) {
      const { resolve, read } = setup([node(refs)]);
      expect(await resolve(params, context)).toEqual({ kind: "not_found" });
      expect(read).not.toHaveBeenCalled();
    }
    const missing = setup([]);
    expect(await missing.resolve(params, context)).toEqual({ kind: "not_found" });
    expect(missing.read).not.toHaveBeenCalled();
  });

  it("should answer 404 for an archived target without loading the node", async () => {
    vi.mocked(readWorkspaceArchiveCity).mockResolvedValue([
      { target: { citySlug: CITY, type: "Signal", id: "sig-1" }, effectiveDiscarded: true },
    ] as never);
    const { resolve, read, db } = setup([node([{ docSha: SHA, rawRef: CAS }])]);
    expect(await resolve(params, context)).toEqual({ kind: "not_found" });
    expect(db.select).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("should refuse any non-PDF content type or missing magic bytes", async () => {
    for (const [contentType, bytes] of [
      ["text/html", new TextEncoder().encode("<html>")],
      ["application/pdf", new TextEncoder().encode("<html>not a pdf")],
      ["application/xml", PDF],
    ] as const) {
      const { resolve } = setup([node([{ docSha: SHA, rawRef: CAS }])],
        vi.fn(async () => ({ kind: "ok" as const, bytes, contentType })));
      expect(await resolve(params, context)).toEqual({ kind: "unsupported_media" });
    }
    expect(isPdfBytes(PDF)).toBe(true);
  });

  it("should map workspace refusals to closed typed answers", async () => {
    vi.mocked(readWorkspaceArchiveCity).mockRejectedValue(new WorkspaceError(403, "workspace_not_authorized"));
    const { resolve, read, db } = setup([node([{ docSha: SHA, rawRef: CAS }])]);
    const refused = await resolve(params, context);
    expect(refused.kind).toBe("refused");
    expect(refused.kind === "refused" && refused.cause.message).toBe("workspace_not_authorized");
    expect(db.select).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("should accept exactly the five §11.3 params", () => {
    expect(documentsPvParams.safeParse(params).success).toBe(true);
    for (const extra of [{ rawRef: CAS }, { sourceUrl: "https://x.example/a.pdf" }, { grant: "g" }]) {
      expect(documentsPvParams.safeParse({ ...params, ...extra }).success).toBe(false);
    }
    expect(documentsPvParams.safeParse({ ...params, docSha: "A".repeat(64) }).success).toBe(false);
    expect(documentsPvParams.safeParse({ ...params, type: "Lot" }).success).toBe(false);
  });

  it("should journal a failing doc-ref enrichment without city, node or storage key (B2)", async () => {
    const where = vi.fn(async () => [node([{ docSha: SHA, rawRef: CAS }])]);
    const db = { select: vi.fn(() => ({ from: () => ({ where }) })) };
    const failing = { head: async (key: string) => { throw new Error(`S3 HEAD failed for ${key}`); },
      get: async (key: string) => { throw new Error(`S3 GET failed for ${key}`); } };
    const read = vi.fn(async () => ({ kind: "ok" as const, bytes: PDF, contentType: "application/pdf" }));
    const logs: string[] = [];
    const spies = (["log", "info", "warn", "error"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(" ")); }));
    try {
      const resolve = createReaderDocumentRead({ db: db as never, store: failing as never, readRaw: read as never });
      expect(await resolve(params, context)).toEqual({ kind: "pdf", bytes: PDF });
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((line) => line === "[reader-op] documents.pv.v1 doc-ref enrichment failed")).toBe(true);
    for (const leak of [CITY, "sig-1", "raw/", SHA]) expect(logs.join("\n")).not.toContain(leak);
  });
});
