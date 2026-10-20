/**
 * Tests for the signal-facets client (lot 4, C1).
 *
 * Synthetic taxonomy only: the profile below deliberately gives codes whose
 * PREFIX contradicts their verdict, proving the UI filters on the exact
 * verdict and never on the prefix.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFacetTarget, codesForVerdict, createCommandKey, facetErrorMessage, fetchCityFacets, fetchReasonCodes, indexFacetHeads, postFacetCommand, SignalFacetError, type FacetHead } from "./signal-facets-client.js";
import type { GraphSignalNode } from "./graph-signal-detail-client.js";

function signalNode(overrides: Partial<GraphSignalNode> = {}): GraphSignalNode {
  return {
    id: "sig-1",
    type: "Signal",
    label: "Synthetic signal",
    citySlug: "ville-synth",
    sourceRef: null,
    createdAt: null,
    props: {},
    ...overrides,
  };
}

/** Prefix contradicts verdict on purpose: filtering must follow verdict. */
const CODES = [
  { code: "P-DENSITE", verdict: "pertinent" },
  { code: "P-BIDON", verdict: "non_pertinent" },
  { code: "N-ADMIN", verdict: "non_pertinent" },
  { code: "N-LEURRE", verdict: "a_surveiller" },
  { code: "S-VEILLE", verdict: "a_surveiller" },
];

function head(overrides: Partial<FacetHead>): FacetHead {
  return {
    id: "event-1",
    target: { citySlug: "ville-synth", type: "Signal", id: "sig-1" },
    facet: "selection",
    basket: "pertinent",
    state: "active",
    reasonCode: null,
    verdict: "pertinent",
    createdAt: "2026-10-19T12:00:00.000Z",
    targetAvailable: true,
    changedSinceArchive: null,
    ...overrides,
  };
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response): {
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  });
  return { calls };
}

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("buildFacetTarget", () => {
  it("targets the native identity (citySlug, type, id)", () => {
    expect(buildFacetTarget(signalNode())).toEqual({
      citySlug: "ville-synth",
      type: "Signal",
      id: "sig-1",
    });
  });

  it("carries the graph id verbatim, never a positional id", () => {
    const target = buildFacetTarget(signalNode({ id: "evt-42-native" }));
    expect(target?.id).toBe("evt-42-native");
  });

  it("returns null without citySlug: no controls for such a node", () => {
    expect(buildFacetTarget(signalNode({ citySlug: null }))).toBeNull();
    expect(buildFacetTarget(signalNode({ citySlug: "  " }))).toBeNull();
  });

  it("returns null for unknown node types and empty ids", () => {
    expect(buildFacetTarget(signalNode({ type: "Lot" }))).toBeNull();
    expect(buildFacetTarget(signalNode({ id: "" }))).toBeNull();
  });
});

describe("codesForVerdict", () => {
  it("filters on the exact verdict when the prefix contradicts it", () => {
    expect(codesForVerdict(CODES, "pertinent").map((row) => row.code)).toEqual([
      "P-DENSITE",
    ]);
    expect(codesForVerdict(CODES, "non_pertinent").map((row) => row.code)).toEqual([
      "P-BIDON",
      "N-ADMIN",
    ]);
    expect(codesForVerdict(CODES, "a_surveiller").map((row) => row.code)).toEqual([
      "N-LEURRE",
      "S-VEILLE",
    ]);
  });
});

describe("indexFacetHeads", () => {
  it("aggregates active selection and archive heads per target", () => {
    const byTarget = indexFacetHeads([
      head({ basket: "pertinent", reasonCode: "P-DENSITE" }),
      head({ id: "event-2", basket: "a_surveiller", reasonCode: null }),
      head({
        id: "event-3",
        facet: "archive",
        basket: null,
        state: "active",
        reasonCode: "N-ADMIN",
        verdict: "non_pertinent",
        changedSinceArchive: true,
      }),
    ]);
    expect(byTarget.get("Signal/sig-1")).toEqual({
      pertinent: true,
      pertinentCode: "P-DENSITE",
      watching: true,
      watchingCode: null,
      archived: true,
      archiveCode: "N-ADMIN",
      changedSinceArchive: true,
      targetAvailable: true,
    });
  });

  it("ignores inactive heads and unknown facets", () => {
    const byTarget = indexFacetHeads([
      head({ state: "inactive" }),
      head({ id: "event-2", facet: "unknown", basket: null }),
    ]);
    expect(byTarget.get("Signal/sig-1")).toEqual({
      pertinent: false,
      pertinentCode: null,
      watching: false,
      watchingCode: null,
      archived: false,
      archiveCode: null,
      changedSinceArchive: false,
      targetAvailable: true,
    });
  });
});

describe("facet reads", () => {
  it("should preserve distinct native targets when indexing public DTO heads", async () => {
    stubFetch(() => jsonResponse(200, { ok: true, heads: [
      head({ reasonCode: "P-DENSITE", targetAvailable: false }),
      head({
        id: "archive-1",
        target: { citySlug: "ville-synth", type: "DesignationEvent", id: "sig-1" },
        facet: "archive",
        basket: null,
        reasonCode: "N-ADMIN",
        verdict: "non_pertinent",
        changedSinceArchive: true,
      }),
    ] }));
    const { heads } = await fetchCityFacets("", "ville-synth");
    const byTarget = indexFacetHeads(heads);
    expect([...byTarget.keys()]).toEqual(["Signal/sig-1", "DesignationEvent/sig-1"]);
    expect(byTarget.get("Signal/sig-1")).toMatchObject({
      pertinent: true,
      pertinentCode: "P-DENSITE",
      archived: false,
      targetAvailable: false,
    });
    expect(byTarget.get("DesignationEvent/sig-1")).toMatchObject({
      pertinent: false,
      archived: true,
      archiveCode: "N-ADMIN",
      changedSinceArchive: true,
      targetAvailable: true,
    });
  });

  it.each([{}, { codes: null }, { codes: [null] }, { codes: [{ code: "P-BAD", verdict: 1 }] }])(
    "should reject an unreadable codebook returned with HTTP 200: %j",
    async (payload) => {
      stubFetch(() => jsonResponse(200, payload));
      await expect(fetchReasonCodes("")).rejects.toThrow("Invalid reason codes response");
    },
  );

  it("GET reason-codes carries no query string", async () => {
    const { calls } = stubFetch(() =>
      jsonResponse(200, { ok: true, profileId: "immo-steve-2026-09", codes: CODES }),
    );
    const res = await fetchReasonCodes("");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/v1/signal-facets/reason-codes");
    expect(res.codes).toHaveLength(5);
  });

  it("GET cities/:city carries no query string", async () => {
    const { calls } = stubFetch(() =>
      jsonResponse(200, { ok: true, heads: [head({})] }),
    );
    await fetchCityFacets("", "ville-synth");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/v1/signal-facets/cities/ville-synth");
  });
});

describe("facet writes", () => {
  it("POSTs the strict body with the caller idempotency key", async () => {
    const { calls } = stubFetch(() =>
      jsonResponse(200, { ok: true, event: { id: "event-1" } }),
    );
    const key = createCommandKey();
    const event = await postFacetCommand(
      "",
      "discard",
      { target: { citySlug: "ville-synth", type: "Signal", id: "sig-1" }, reasonCode: "N-ADMIN" },
      key,
    );
    expect(event).toEqual({ id: "event-1" });
    const init = calls[0]!.init!;
    expect(calls[0]!.url).toBe("/api/v1/signal-facets/discard");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe(key);
    expect(JSON.parse(init.body as string)).toEqual({
      target: { citySlug: "ville-synth", type: "Signal", id: "sig-1" },
      reasonCode: "N-ADMIN",
    });
  });

  it("maps failures by status and server code", async () => {
    stubFetch((url) => {
      if (url.endsWith("/select")) return jsonResponse(422, { error: "reason_code_required" });
      if (url.endsWith("/discard")) return jsonResponse(422, { error: "invalid_reason_code" });
      if (url.endsWith("/restore")) return jsonResponse(404, { error: "signal_not_found" });
      return jsonResponse(401, { error: "unauthenticated" });
    });
    const body = { target: { citySlug: "ville-synth", type: "Signal" as const, id: "sig-1" } };
    await expect(postFacetCommand("", "select", body, "k1")).rejects.toMatchObject({
      status: 422,
      code: "reason_code_required",
    });
    expect(facetErrorMessage(new SignalFacetError(422, "reason_code_required"))).toContain(
      "Code requis",
    );
    expect(facetErrorMessage(new SignalFacetError(422, "invalid_reason_code"))).toContain(
      "Code invalide",
    );
    expect(facetErrorMessage(new SignalFacetError(422, "basket_required"))).toContain(
      "Code requis ou invalide",
    );
    expect(facetErrorMessage(new SignalFacetError(404, "signal_not_found"))).toContain(
      "Signal introuvable",
    );
    expect(facetErrorMessage(new SignalFacetError(401, "unauthenticated"))).toContain(
      "Connexion requise",
    );
    expect(facetErrorMessage(new SignalFacetError(403, "account_not_approved"))).toContain(
      "Compte non approuvé",
    );
    expect(
      facetErrorMessage(new SignalFacetError(403, "browser_session_required")),
    ).toContain("Session navigateur requise");
    expect(facetErrorMessage(new SignalFacetError(409, "idempotency_key_conflict"))).toContain(
      "Conflit de clé",
    );
  });

  it("reports a network failure as unconfirmed, never as refused", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    const body = { target: { citySlug: "ville-synth", type: "Signal" as const, id: "sig-1" } };
    const failure = await postFacetCommand("", "restore", body, "k1").catch((err) => err);
    expect(failure).toBeInstanceOf(SignalFacetError);
    if (!(failure instanceof SignalFacetError)) throw new Error("Expected a facet failure");
    expect(failure.status).toBeNull();
    expect(facetErrorMessage(failure)).toBe("Écriture non confirmée — Réessayer.");
  });
});
