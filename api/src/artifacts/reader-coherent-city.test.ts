/* eslint-disable @typescript-eslint/no-explicit-any -- assertions probe the served JSON shape */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toDegradedSignalCard } from "../routes/graph-signals.js";
import { buildCoherentCityResponse, parseCoherentCityResponse, projectProps } from "./reader-coherent-city.js";
import { createBasketReadOperation } from "./reader-baskets.js";
import { validateOperationParams } from "./reader-operations.js";
import { validateReaderResponse } from "./reader-responses.js";
import type { ApiReaderContext } from "./reader-context.js";

vi.mock("../services/facets/projection-revisions.js", () => ({ readCoherentProjection: vi.fn() }));
vi.mock("../services/facets/scoped-reader.js", () => ({ readScopedPersonalHeads: vi.fn() }));
vi.mock("../services/facets/workspace-reader.js", () => ({ readWorkspaceArchiveCity: vi.fn() }));
vi.mock("../services/graph/graph-store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/graph/graph-store.js")>()), getSignalNodesForCity: vi.fn() }));
import { readCoherentProjection } from "../services/facets/projection-revisions.js";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const KEY = Buffer.alloc(32, 7);
const CITY = "valleyfield";
const SHA = "a".repeat(64);
const SHA2 = "b".repeat(64);
const CAS = `raw/proces-verbaux-${CITY}/cas/${SHA}.pdf`;

type Node = Parameters<typeof toDegradedSignalCard>[0];

/** Adversarial node: storage keys, identities and personal data at every level. */
function trapNode(id: string, overrides: Partial<Node> = {}): Node {
  return {
    id, type: "Signal", label: `Avis de motion ${id}`, citySlug: CITY,
    sourceRef: CAS,
    createdAt: new Date("2026-01-02T03:04:05.000Z"),
    props: {
      community: 7, community_name: "communauté interne", source_file: "raw/secret/source-file.json",
      status: "adopte", description: "Avis de motion visant la zone H-12.",
      refs: [
        { docSha: SHA, rawRef: CAS, s3Key: "raw/secret/s3-key.pdf", excerpt: "Extrait du PV.", page: 3,
          sourceUrl: "https://ville.example.qc.ca/pv/2026-01.pdf", fetchedAt: "2026-01-03T00:00:00.000Z" },
        { docSha: SHA2, rawRef: `raw/proces-verbaux-${CITY}/cas/${SHA2}.pdf`, excerpt: "Deuxième.",
          sourceUrl: "https://ville.example.qc.ca/pv.pdf?token=leaky-signed-token" },
      ],
      properties: {
        rawRef: "raw/secret/properties-raw.pdf", adresse: "123 rue Secrète", demandeurNom: "Jean Secret",
        etape: "avis_motion", zone_ref: ["H-12"], reglement_number: "2026-01", extrait: "Extrait imbriqué.",
        url: "https://internal.example/leak", community: 9,
      },
    },
    ...overrides,
  } as Node;
}

function assemble(nodes: Node[], extra: { total?: number; hidden?: number; selected?: number } = {}) {
  const cards = nodes.map((node) => toDegradedSignalCard(node));
  return buildCoherentCityResponse({
    artifactId: "artifact-1", readerSub: "reader-alice", workspaceId: WORKSPACE, citySlug: CITY,
    serverToken: "server-token-with-account-id", tokenKey: KEY, total: extra.total ?? nodes.length,
    hidden: extra.hidden ?? 0, selected: extra.selected ?? 0,
    legacyProjection: { version: "legacy-zmp-v1", a: { count: 0, signalIds: [] } },
    sources: nodes.map((node, index) => ({ node, card: cards[index]! })),
  });
}

beforeEach(() => { vi.resetAllMocks(); });

describe("signals.coherent-city.v1 projection (§5.2–§5.5)", () => {
  it("should never serve a trap value at any level", () => {
    const body = parseCoherentCityResponse(assemble([trapNode("sig-1")]));
    const wire = JSON.stringify(body);
    for (const leak of ["raw/", "s3-key", "source-file", "properties-raw", "123 rue Secrète", "Jean Secret",
      "communauté interne", "leaky-signed-token", "internal.example", "server-token-with-account-id",
      "facetFingerprint", "revisions", "selection", "community"]) {
      expect(wire).not.toContain(leak);
    }
    const signal = (body.signals as Array<Record<string, any>>)[0]!;
    expect(body.heads).toEqual([]);
    expect(signal.sourceRef).toBeNull();
    expect(signal.classification.provenance.source).toBe("served");
    expect(signal.bPrime.provenance.source).toBe("served");
    expect(signal.evidence).toMatchObject({ rawRef: null, rawObjectKey: null, sourceRef: null });
    expect(signal.createdAt).toBe("2026-01-02T03:04:05.000Z");
  });

  it("should rewrite documentUrl to the opaque op and keep only public source URLs", () => {
    const body = parseCoherentCityResponse(assemble([trapNode("sig-1")]));
    const signal = (body.signals as Array<Record<string, any>>)[0]!;
    const [first, second] = signal.docRefs as Array<Record<string, any>>;
    expect(first!.documentUrl).toBe(`/__reader/api/documents.pv.v1?workspaceId=${WORKSPACE}`
      + `&citySlug=${CITY}&type=Signal&id=sig-1&docSha=${SHA}`);
    expect(first!.sourceUrl).toBe("https://ville.example.qc.ca/pv/2026-01.pdf");
    expect(second!.sourceUrl).toBeUndefined();
    expect(second!.documentUrl).toContain(`docSha=${SHA2}`);
    for (const ref of signal.evidence.refs as Array<Record<string, any>>) {
      expect(ref).toMatchObject({ rawRef: null, rawObjectKey: null });
      if (ref.documentUrl !== null) expect(ref.documentUrl).toMatch(/^\/__reader\/api\/documents\.pv\.v1\?/);
    }
    expect(signal.evidence.completeness.hasPdfLink).toBe(true);
  });

  it("should recalculate completeness from the projected links, not the removed ones", () => {
    // A node whose only document identity is a non-CAS storage key: the ref
    // is dropped (no valid docSha), so the PDF link is no longer attested.
    const node = trapNode("sig-2", { sourceRef: null, props: { refs: [{ rawRef: "raw/other/doc.pdf", excerpt: "x" }] } });
    const signal = (parseCoherentCityResponse(assemble([node])).signals as Array<Record<string, any>>)[0]!;
    expect(signal.docRefs).toEqual([]);
    expect(signal.evidence.documentUrl).toBeNull();
    expect(signal.evidence.completeness.hasPdfLink).toBe(false);
    expect(signal.evidence.completeness.missing).toContain("pdfLink");
  });

  it("should keep only the closed §5.4 props keys", () => {
    const projected = projectProps(trapNode("sig-1").props);
    expect(Object.keys(projected).sort()).toEqual(["description", "properties", "refs", "statut"]);
    expect(projected.statut).toBe("adopte");
    expect(projected.properties).toEqual({ etape: "avis_motion", zone_ref: ["H-12"], reglement_number: "2026-01" });
    expect(projected.refs).toEqual([
      { excerpt: "Extrait du PV.", fetchedAt: "2026-01-03T00:00:00.000Z", page: 3 },
      { excerpt: "Deuxième." },
    ]);
  });

  it("should fail closed on a forbidden key or a broken counter, never transmitting it", () => {
    const tainted = assemble([trapNode("sig-1")]) as Record<string, any>;
    tainted.signals[0].props.adresse = "123 rue Secrète";
    expect(() => parseCoherentCityResponse(tainted)).toThrow("upstream_bad_payload");
    const leaked = assemble([trapNode("sig-1")]) as Record<string, any>;
    leaked.signals[0].evidence.rawRef = CAS;
    expect(() => parseCoherentCityResponse(leaked)).toThrow("upstream_bad_payload");
    const counters = assemble([trapNode("sig-1")], { total: 5, hidden: 0 });
    expect(() => parseCoherentCityResponse(counters)).toThrow("upstream_bad_payload");
  });

  it("should derive a reader-scoped token, distinct across artifacts and readers", () => {
    const base = assemble([trapNode("sig-1")]);
    const other = buildCoherentCityResponse({ artifactId: "artifact-2", readerSub: "reader-alice",
      workspaceId: WORKSPACE, citySlug: CITY, serverToken: "server-token-with-account-id", tokenKey: KEY, total: 0, hidden: 0,
      selected: 0, legacyProjection: { version: "legacy-zmp-v1", a: { count: 0, signalIds: [] } }, sources: [] });
    expect(base.token).toMatch(/^[a-f0-9]{64}$/);
    expect(base.token).not.toBe(other.token);
  });

  it("should accept exactly workspaceId, citySlug and mode=signal", () => {
    expect(validateOperationParams("signals.coherent-city.v1",
      { workspaceId: WORKSPACE, citySlug: CITY, mode: "signal" }).ok).toBe(true);
    for (const params of [
      { workspaceId: WORKSPACE, citySlug: CITY },
      { workspaceId: WORKSPACE, citySlug: CITY, mode: "lot" },
      { workspaceId: WORKSPACE, citySlug: "Valley/../x", mode: "signal" },
      { workspaceId: WORKSPACE, citySlug: CITY, mode: "signal", showDiscarded: "1" },
    ]) {
      expect(validateOperationParams("signals.coherent-city.v1", params).ok).toBe(false);
    }
  });
});

describe("signals.coherent-city.v1 service wiring", () => {
  const context = { readerSub: "reader-alice", artifactId: "artifact-1" } as ApiReaderContext;
  it("should drop archived targets from signals and legacy ids, with app-equal counters", async () => {
    const visible = trapNode("sig-visible");
    const archived = trapNode("sig-archived");
    vi.mocked(readCoherentProjection).mockResolvedValue({
      scope: { token: "server-token" } as never,
      payload: {
        archive: [{ target: { citySlug: CITY, type: "Signal", id: "sig-archived" }, effectiveDiscarded: true }],
        selection: [{ facet: "selection", state: "active" }, { facet: "selection", state: "inactive" },
          { facet: "archive", state: "active" }],
        signals: [visible, archived],
      },
    } as never);
    const read = createBasketReadOperation({ db: {} as never, store: undefined as never });
    const body = validateReaderResponse("signals.coherent-city.v1",
      await read("signals.coherent-city.v1", { workspaceId: WORKSPACE, citySlug: CITY, mode: "signal" }, context),
      "reader-alice") as Record<string, any>;
    expect(body.signals.map((signal: { id: string }) => signal.id)).toEqual(["sig-visible"]);
    expect(JSON.stringify(body.legacyProjection)).not.toContain("sig-archived");
    expect(JSON.stringify(body)).not.toContain("sig-archived");
    expect(body.counts).toEqual({ total: 2, hidden: 1, visible: 1, selected: 1 });
    expect(vi.mocked(readCoherentProjection).mock.calls[0]!.slice(1, 5))
      .toEqual(["reader-alice", WORKSPACE, CITY, "signal"]);
  });

  it("should journal a failing doc-ref enrichment without city, node or storage key (B2)", async () => {
    const node = trapNode("sig-enrich");
    vi.mocked(readCoherentProjection).mockResolvedValue({
      scope: { token: "server-token" } as never,
      payload: { archive: [], selection: [], signals: [node] },
    } as never);
    const failing = { head: async (key: string) => { throw new Error(`S3 HEAD failed for ${key}`); },
      get: async (key: string) => { throw new Error(`S3 GET failed for ${key}`); } };
    const logs: string[] = [];
    const spies = (["log", "info", "warn", "error"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logs.push(args.map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack ?? ""}` : String(arg))).join(" "));
      }));
    try {
      const read = createBasketReadOperation({ db: {} as never, store: failing as never });
      const body = validateReaderResponse("signals.coherent-city.v1",
        await read("signals.coherent-city.v1", { workspaceId: WORKSPACE, citySlug: CITY, mode: "signal" }, context),
        "reader-alice") as Record<string, any>;
      expect(body.signals).toHaveLength(1);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((line) => line === "[reader-op] signals.coherent-city.v1 doc-ref enrichment failed")).toBe(true);
    const journal = logs.join("\n");
    for (const leak of [CITY, "sig-enrich", "raw/", SHA]) expect(journal).not.toContain(leak);
  });

  it("should keep the reader-scoped token keyed: another server key gives another token (m6)", () => {
    const one = buildCoherentCityResponse({ artifactId: "a", readerSub: "r", workspaceId: WORKSPACE, citySlug: CITY,
      serverToken: "s", tokenKey: KEY, total: 0, hidden: 0, selected: 0,
      legacyProjection: { version: "legacy-zmp-v1", a: { count: 0, signalIds: [] } }, sources: [] });
    const two = buildCoherentCityResponse({ artifactId: "a", readerSub: "r", workspaceId: WORKSPACE, citySlug: CITY,
      serverToken: "s", tokenKey: Buffer.alloc(32, 9), total: 0, hidden: 0, selected: 0,
      legacyProjection: { version: "legacy-zmp-v1", a: { count: 0, signalIds: [] } }, sources: [] });
    expect(one.token).not.toBe(two.token);
  });
});

describe("signals.coherent-city.v1 payload size (§5.5, large fixture)", () => {
  /** A dense but realistic city signal: long PV excerpts, 3 doc-refs, structured props. */
  function denseNode(index: number): Node {
    const sha = (index.toString(16).padStart(8, "0") + "e".repeat(56)).slice(0, 64);
    return trapNode(`sig-${index}`, {
      label: `Règlement 2026-${index} modifiant le zonage — zones H-${index} et C-${index}`.padEnd(160, "."),
      props: {
        status: "avis-motion", description: "Avis de motion. ".repeat(120),
        refs: [0, 1, 2].map((page) => ({ docSha: sha, rawRef: `raw/proces-verbaux-${CITY}/cas/${sha}.pdf`,
          excerpt: "Extrait du procès-verbal. ".repeat(60), page: page + 1, fetchedAt: "2026-02-01T00:00:00.000Z" })),
        properties: { category: "zonage", etape: "avis_motion", zone_ref: [`H-${index}`, `C-${index}`],
          reglement_number: `2026-${index}`, summary: "Résumé. ".repeat(100) },
      },
    });
  }

  it("should measure the serialized DTO per signal and fail typed beyond the 2 MiB ceiling", () => {
    const measure = (count: number) => Buffer.byteLength(JSON.stringify(parseCoherentCityResponse(
      assemble(Array.from({ length: count }, (_, index) => denseNode(index))))));
    const hundred = measure(100);
    const perSignal = hundred / 100;
    // Recorded measure (dense fixture, 3 refs × ~1.5 kB excerpts, each excerpt
    // served in docRefs, evidence.refs and props.refs): ~35 kB per signal, so
    // a dense city crosses the 2 MiB ceiling near 59 signals and then fails
    // typed (projection_payload_too_large). Real per-city sizes: unverified.
    expect(perSignal).toBeGreaterThan(20_000);
    expect(perSignal).toBeLessThan(50_000);
    const fitting = Math.floor(2_097_152 / perSignal);
    expect(measure(Math.max(1, fitting - 10))).toBeLessThanOrEqual(2_097_152);
    expect(measure(fitting + 20)).toBeGreaterThan(2_097_152);
  });
});
