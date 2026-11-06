import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createArtifactTransport, routeArtifactRequest } from "./artifact-transport";
import { fetchWorkspaces, parseWorkspacesResponse } from "$lib/signals/workspace-client";
import { fetchGraphSignalsByCity } from "$lib/signals/graph-signals-by-city-client";
import { fetchGraphSignalDetail } from "$lib/signals/graph-signal-detail-client";
import { fetchZones } from "$lib/maps/zones-client";
import { fetchLots } from "$lib/maps/lots-client";
import { fetchGeoZones } from "$lib/maps/geo-zones-client";
import { fetchCptaqConstraints } from "$lib/maps/cptaq-client";

const ORIGIN = "https://123e4567-e89b-12d3-a456-426614174000.pages.example.test";
const WS = "11111111-1111-4111-8111-111111111111";
const SHA = "a".repeat(64);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Reader host double: answers ops in their app wire shape, records every call. */
function readerHost(overrides: Record<string, (url: URL) => Response> = {}) {
  const calls: Array<{ url: URL; init: RequestInit | undefined }> = [];
  const network = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, ORIGIN);
    calls.push({ url, init });
    const op = url.pathname.replace("/__reader/api/", "");
    if (overrides[url.pathname]) return overrides[url.pathname]!(url);
    if (url.pathname === "/__reader/renew") return json(200, { grant: "renewed-grant" });
    if (op === "app.me.v1") {
      return json(200, { authenticated: true, user: { sub: `usr_${"x".repeat(32)}`, name: "Lecteur", status: "approved" } });
    }
    if (op === "workspaces.list.v1") {
      return json(200, { ok: true, workspaces: [{ id: WS, slug: "team", label: "Team",
        signals: { availability: { state: "open" } },
        workspace: { id: WS, slug: "team", label: "Team" }, moderateArchive: false, manageMembers: false }] });
    }
    if (op === "signals.by-city.v1") return json(200, { ok: true, totalCount: 0, cities: [] });
    if (op === "signals.coherent-city.v1") {
      return json(200, { ok: true, workspaceId: WS, citySlug: "valleyfield", mode: "signal", token: "t".repeat(64),
        heads: [], signals: [{ id: "sig-1", type: "Signal", label: "Signal", citySlug: "valleyfield", sourceRef: null,
          createdAt: null, props: {}, docRefs: [{ docSha: SHA,
            documentUrl: `/__reader/api/documents.pv.v1?workspaceId=${WS}&citySlug=valleyfield&type=Signal&id=sig-1&docSha=${SHA}` }] }],
        legacyProjection: { version: "legacy-zmp-v1", a: { count: 0, signalIds: [] } },
        counts: { total: 1, hidden: 0, visible: 1, selected: 0 } });
    }
    return json(404, { error: "unknown_operation" });
  });
  return { network, calls };
}

function install(host = readerHost(), href = `${ORIGIN}/?grant=initial-grant&view=signaux`, apiBase = "") {
  const location = { href, origin: ORIGIN, assign: vi.fn() };
  const replaceUrl = vi.fn();
  const transport = createArtifactTransport({ fetch: host.network as typeof fetch, location, replaceUrl, apiBase,
    now: () => 1_000 });
  vi.stubGlobal("fetch", transport);
  return { ...host, location, replaceUrl, transport };
}

beforeEach(() => { vi.unstubAllGlobals(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("artifact transport routing (J1.2d/e wagon 7)", () => {
  it("should map the app paths to named reader ops only", () => {
    const route = (path: string, method = "GET", base = "") => routeArtifactRequest(path, method, ORIGIN, base);
    expect(route("/api/v1/auth/me")).toMatchObject({ kind: "op", op: "app.me.v1" });
    expect(route("/api/v1/workspaces")).toMatchObject({ kind: "op", op: "workspaces.list.v1" });
    expect(route(`/api/v1/workspaces/${WS}/signal-facets/by-city?excludePiia=1`))
      .toMatchObject({ kind: "op", op: "signals.by-city.v1" });
    expect(route(`/__app/api/v1/workspaces/${WS}/signal-facets/coherent-city?citySlug=x&mode=signal`, "GET", "/__app"))
      .toMatchObject({ kind: "op", op: "signals.coherent-city.v1" });
    expect(route("/api/v1/workspaces", "POST")).toEqual({ kind: "refused", status: 405, code: "method_not_allowed" });
    expect(route(`/api/v1/workspaces/${WS}/memberships`, "POST")).toMatchObject({ kind: "refused", status: 404 });
    expect(route("/api/v1/auth/login")).toMatchObject({ kind: "refused", status: 404 });
    expect(route(`/__reader/api/documents.pv.v1?docSha=${SHA}`)).toEqual({ kind: "passthrough" });
    expect(route("/assets/app.js")).toEqual({ kind: "passthrough" });
  });

  it("should fail typed on any /api/documents/raw URL, whatever its base", () => {
    for (const path of ["/api/documents/raw?rawRef=raw/x/cas/a.pdf", "/__app/api/documents/raw?rawRef=raw/x.pdf"]) {
      expect(routeArtifactRequest(path, "GET", ORIGIN, "/__app"))
        .toEqual({ kind: "refused", status: 400, code: "raw_document_refused" });
    }
  });

  it("should route zoning to the governed op and name the three remaining geo gaps", () => {
    const route = (path: string) => routeArtifactRequest(path, "GET", ORIGIN, "");
    expect(route("/api/geo/collections/qc-zonage-valleyfield/items?limit=10"))
      .toEqual({ kind: "zoning", path: "/api/geo/collections/qc-zonage-valleyfield/items?limit=10" });
    expect(routeArtifactRequest("/__app/api/geo/collections/qc-zonage-valleyfield/items", "GET", ORIGIN, "/__app"))
      .toEqual({ kind: "zoning", path: "/api/geo/collections/qc-zonage-valleyfield/items" });
    expect(routeArtifactRequest("/api/geo/collections/qc-zonage-valleyfield/items", "POST", ORIGIN, ""))
      .toMatchObject({ kind: "refused", status: 405 });
    expect(route("/api/geo/collections/qc-lots-valleyfield/items")).toEqual({ kind: "gap", gap: "lots" });
    expect(route("/api/geo/valleyfield/zones")).toEqual({ kind: "gap", gap: "zones" });
    expect(route("/api/geo/collections/ca-qc-constraints-valleyfield/items")).toEqual({ kind: "gap", gap: "cptaq" });
    expect(route("https://geo.example.org/ogc/collections/ca-qc-constraints-valleyfield/items?bbox=1,2,3,4"))
      .toEqual({ kind: "gap", gap: "cptaq" });
  });
});

describe("artifact transport through the real API clients", () => {
  it("should boot me + workspaces through the bridge grant and drop the grant from the URL", async () => {
    const { calls, replaceUrl } = install();
    expect(replaceUrl).toHaveBeenCalledWith("/?view=signaux");
    const me = await (await fetch("/api/v1/auth/me", { cache: "no-store" })).json();
    expect(me).toEqual({ authenticated: true, user: { sub: `usr_${"x".repeat(32)}`, name: "Lecteur", status: "approved" } });
    const workspaces = await fetchWorkspaces();
    expect(workspaces).toEqual([{ id: WS, slug: "team", label: "Team", moderateArchive: false, manageMembers: false }]);
    expect(calls.map((call) => call.url.pathname)).toEqual(["/__reader/api/app.me.v1", "/__reader/api/workspaces.list.v1"]);
    for (const call of calls) {
      expect((call.init?.headers as Record<string, string>)["x-preview-grant"]).toBe("initial-grant");
      expect(call.init?.method).toBe("GET");
    }
  });

  it("should map by-city and coherent-city with the workspace as an explicit param", async () => {
    const { calls } = install();
    await fetchGraphSignalsByCity({ workspaceId: WS }, { dateFrom: "2026-01-01", excludePiia: true });
    const detail = await fetchGraphSignalDetail({ workspaceId: WS }, "valleyfield");
    expect(calls[0]!.url.pathname).toBe("/__reader/api/signals.by-city.v1");
    expect(Object.fromEntries(calls[0]!.url.searchParams)).toEqual({ dateFrom: "2026-01-01", excludePiia: "1", workspaceId: WS });
    expect(calls[1]!.url.pathname).toBe("/__reader/api/signals.coherent-city.v1");
    expect(Object.fromEntries(calls[1]!.url.searchParams)).toEqual({ citySlug: "valleyfield", mode: "signal", workspaceId: WS });
    expect(detail.nodes[0]!.sourceRef).toBeNull();
    expect(JSON.stringify(detail)).toContain("/__reader/api/documents.pv.v1?");
  });

  it("should answer the zones, lots and CPTAQ gaps locally with zero network call", async () => {
    const { network } = install();
    await expect(fetchLots("valleyfield")).rejects.toThrow("lots HTTP 503");
    await expect(fetchGeoZones("valleyfield")).rejects.toThrow("geo-zones HTTP 503");
    await expect(fetchCptaqConstraints("valleyfield", { baseUrl: "https://geo.example.org/ogc" }))
      .rejects.toThrow("cptaq HTTP 503");
    const gap = await fetch("/api/geo/collections/qc-lots-valleyfield/items");
    expect(await gap.json()).toEqual({ ok: false, error: "artifact_source_gap", gap: "lots" });
    expect(network).not.toHaveBeenCalled();
  });

  it("should read the zoning layer through geo.collection-items.v1 pages with the bridge grant", async () => {
    const zone = (code: string) => ({ type: "Feature", geometry: { type: "Polygon",
      coordinates: [[[-74, 45], [-74, 45.1], [-73.9, 45.1], [-74, 45]]] }, properties: { zoneCode: code } });
    const page = (offset: number, codes: string[], nextOffset: number | null) => json(200, {
      type: "FeatureCollection", features: codes.map(zone), numberMatched: 3, numberReturned: codes.length,
      nextOffset, projection: "zoning-v1", collectionId: "qc-zonage-valleyfield",
      license: { id: "cc-by-4.0", title: "CC BY 4.0", href: null, attribution: "Ville" } });
    const host = readerHost({ "/__reader/api/geo.collection-items.v1": (url) =>
      url.searchParams.get("offset") === "2" ? page(2, ["C-1"], null) : page(0, ["H-1", "H-2"], 2) });
    const { calls } = install(host);
    const zones = await fetchZones("valleyfield");
    expect(zones.ok).toBe(true);
    expect(zones.numberReturned).toBe(3);
    expect(calls.map((call) => Object.fromEntries(call.url.searchParams))).toEqual([
      { collectionId: "qc-zonage-valleyfield", limit: "200" },
      { collectionId: "qc-zonage-valleyfield", limit: "200", offset: "2" },
    ]);
    for (const call of calls) {
      expect(call.url.pathname).toBe("/__reader/api/geo.collection-items.v1");
      expect((call.init?.headers as Record<string, string>)["x-preview-grant"]).toBe("initial-grant");
    }
  });

  it("should report a governance refusal of zoning as an absent collection, never a fake zero", async () => {
    install(readerHost({ "/__reader/api/geo.collection-items.v1": () =>
      json(403, { error: "geo_governed_not_served" }) }));
    const zones = await fetchZones("valleyfield");
    expect(zones.ok).toBe(false);
  });

  it("should refuse a raw document URL locally and pass the op PDF URL through untouched", async () => {
    const { network, calls } = install(readerHost({
      "/__reader/api/documents.pv.v1": () => new Response("%PDF-1.7", { headers: { "Content-Type": "application/pdf" } }),
    }));
    const refused = await fetch(`/api/documents/raw?rawRef=raw/proces-verbaux-x/cas/${SHA}.pdf`);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ ok: false, error: "raw_document_refused" });
    expect(network).not.toHaveBeenCalled();
    const pdfUrl = `/__reader/api/documents.pv.v1?workspaceId=${WS}&citySlug=valleyfield&type=Signal&id=sig-1&docSha=${SHA}`;
    const pdf = await fetch(pdfUrl);
    expect(await pdf.text()).toBe("%PDF-1.7");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init).toBeUndefined();
  });

  it("should navigate once to the consent screen on basket_consent_required", async () => {
    const consent = () => json(403, { ok: false, error: { code: "basket_consent_required" }, requestId: "r" });
    const { location } = install(readerHost({ "/__reader/api/workspaces.list.v1": consent }));
    await expect(fetchWorkspaces()).rejects.toThrow();
    await expect(fetchWorkspaces()).rejects.toThrow();
    expect(location.assign).toHaveBeenCalledTimes(1);
    expect(location.assign).toHaveBeenCalledWith("/__reader/consent");
  });

  it("should renew through the bridge on 401 and reopen (never the app login) when renewal fails", async () => {
    let first = true;
    const host = readerHost({
      "/__reader/api/app.me.v1": () => {
        if (first) { first = false; return json(401, { error: "unauthenticated" }); }
        return json(200, { authenticated: true, user: { sub: `usr_${"y".repeat(32)}`, name: "Lecteur", status: "approved" } });
      },
    });
    const { calls, location } = install(host);
    expect((await fetch("/api/v1/auth/me")).status).toBe(200);
    expect(calls.map((call) => call.url.pathname)).toEqual(
      ["/__reader/api/app.me.v1", "/__reader/renew", "/__reader/api/app.me.v1"]);
    expect((calls[2]!.init?.headers as Record<string, string>)["x-preview-grant"]).toBe("renewed-grant");
    expect(location.assign).not.toHaveBeenCalled();

    const dead = install(readerHost({
      "/__reader/api/app.me.v1": () => json(401, { error: "unauthenticated" }),
      "/__reader/renew": () => json(401, { error: "unauthenticated" }),
    }));
    expect((await fetch("/api/v1/auth/me")).status).toBe(401);
    expect(dead.location.assign).toHaveBeenCalledWith("/__reader/start");
  });

  it("should accept the op workspaces superset with the real app parser", () => {
    expect(parseWorkspacesResponse({ ok: true, workspaces: [{ id: WS, slug: "team", label: "Team",
      signals: { availability: { state: "open" } },
      workspace: { id: WS, slug: "team", label: "Team" }, moderateArchive: false, manageMembers: false }] }))
      .toEqual([{ id: WS, slug: "team", label: "Team", moderateArchive: false, manageMembers: false }]);
  });
});
