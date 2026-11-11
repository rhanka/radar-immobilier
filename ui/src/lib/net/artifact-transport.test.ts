import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createArtifactTransport, routeArtifactRequest } from "./artifact-transport";
import { fetchWorkspaces, parseWorkspacesResponse } from "$lib/signals/workspace-client";
import { fetchGraphSignalsByCity } from "$lib/signals/graph-signals-by-city-client";
import { fetchGraphSignalDetail } from "$lib/signals/graph-signal-detail-client";
import { fetchZones } from "$lib/maps/zones-client";
import { fetchLots } from "$lib/maps/lots-client";

const ORIGIN = "https://123e4567-e89b-12d3-a456-426614174000.pages.example.test";
const WS = "11111111-1111-4111-8111-111111111111";
const SHA = "a".repeat(64);
const RELAY = "/__reader/app";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** App double behind the generic relay: answers app paths, records every call. */
function relayHost(overrides: Record<string, (url: URL, init: RequestInit | undefined) => Response> = {}) {
  const calls: Array<{ url: URL; init: RequestInit | undefined }> = [];
  const network = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, ORIGIN);
    calls.push({ url, init });
    if (overrides[url.pathname]) return overrides[url.pathname]!(url, init);
    if (url.pathname === "/__reader/renew") return json(200, { grant: "renewed-grant" });
    const appPath = url.pathname.replace(RELAY, "");
    if (appPath === "/api/v1/auth/me") {
      return json(200, { authenticated: true, user: { sub: "user-1", name: "Lectrice", status: "approved" } });
    }
    if (appPath === "/api/v1/workspaces") {
      return json(200, { ok: true, workspaces: [{ id: WS, slug: "team", label: "Team",
        signals: { availability: { state: "open" } },
        workspace: { id: WS, slug: "team", label: "Team" }, moderateArchive: false, manageMembers: false }] });
    }
    if (appPath.endsWith("/signal-facets/by-city")) return json(200, { ok: true, totalCount: 0, cities: [] });
    if (appPath.endsWith("/signal-facets/coherent-city")) {
      return json(200, { ok: true, workspaceId: WS, citySlug: "valleyfield", mode: "signal", token: "t".repeat(64),
        heads: [], signals: [{ id: "sig-1", type: "Signal", label: "Signal", citySlug: "valleyfield", sourceRef: null,
          createdAt: null, props: {}, docRefs: [{ docSha: SHA,
            documentUrl: `/__reader/api/documents.pv.v1?workspaceId=${WS}&citySlug=valleyfield&type=Signal&id=sig-1&docSha=${SHA}` }] }],
        legacyProjection: { version: "legacy-zmp-v1", a: { count: 0, signalIds: [] } },
        counts: { total: 1, hidden: 0, visible: 1, selected: 0 } });
    }
    return json(404, { error: "not_found" });
  });
  return { network, calls };
}

function install(host = relayHost(), href = `${ORIGIN}/?grant=initial-grant&view=signaux`, apiBase = "") {
  const location = { href, origin: ORIGIN, assign: vi.fn() };
  const replaceUrl = vi.fn();
  const transport = createArtifactTransport({ fetch: host.network as typeof fetch, location, replaceUrl, apiBase,
    now: () => 1_000 });
  vi.stubGlobal("fetch", transport);
  return { ...host, location, replaceUrl, transport };
}

beforeEach(() => { vi.unstubAllGlobals(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("artifact transport routing (generic relay)", () => {
  it("should relay every /api/* call whatever its method, with no local refusal", () => {
    const route = (path: string, base = "") => routeArtifactRequest(path, ORIGIN, base);
    expect(route("/api/v1/auth/me")).toEqual({ kind: "relay", path: "/api/v1/auth/me" });
    expect(route(`/api/v1/workspaces/${WS}/signal-facets/reason-codes`))
      .toEqual({ kind: "relay", path: `/api/v1/workspaces/${WS}/signal-facets/reason-codes` });
    expect(route(`/api/v1/workspaces/${WS}/signal-facets/personal/discard`))
      .toEqual({ kind: "relay", path: `/api/v1/workspaces/${WS}/signal-facets/personal/discard` });
    expect(route("/api/geo/collections/qc-lots-valleyfield/items"))
      .toEqual({ kind: "relay", path: "/api/geo/collections/qc-lots-valleyfield/items" });
    expect(route("/api/geo/valleyfield/zones")).toEqual({ kind: "relay", path: "/api/geo/valleyfield/zones" });
    expect(route("/api/documents/raw?rawRef=raw/x.pdf"))
      .toEqual({ kind: "relay", path: "/api/documents/raw?rawRef=raw/x.pdf" });
    expect(route(`/__app/api/v1/workspaces/${WS}/signal-facets/coherent-city?citySlug=x&mode=signal`, "/__app"))
      .toEqual({ kind: "relay", path: `/api/v1/workspaces/${WS}/signal-facets/coherent-city?citySlug=x&mode=signal` });
    expect(route(`/__reader/api/documents.pv.v1?docSha=${SHA}`)).toEqual({ kind: "passthrough" });
    expect(route("/assets/app.js")).toEqual({ kind: "passthrough" });
    expect(route("https://geo.example.org/ogc/collections/ca-qc-constraints-x/items"))
      .toEqual({ kind: "passthrough" });
  });
});

describe("artifact transport through the real API clients", () => {
  it("should boot me + workspaces through the relay grant and drop the grant from the URL", async () => {
    const { calls, replaceUrl } = install();
    expect(replaceUrl).toHaveBeenCalledWith("/?view=signaux");
    const me = await (await fetch("/api/v1/auth/me", { cache: "no-store" })).json();
    expect(me).toEqual({ authenticated: true, user: { sub: "user-1", name: "Lectrice", status: "approved" } });
    const workspaces = await fetchWorkspaces();
    expect(workspaces).toEqual([{ id: WS, slug: "team", label: "Team", moderateArchive: false, manageMembers: false }]);
    expect(calls.map((call) => call.url.pathname)).toEqual(
      [`${RELAY}/api/v1/auth/me`, `${RELAY}/api/v1/workspaces`]);
    for (const call of calls) {
      expect((call.init?.headers as Headers).get("x-preview-grant")).toBe("initial-grant");
      expect(call.init?.method).toBe("GET");
    }
  });

  it("should relay by-city and coherent-city verbatim (workspace stays in the app path)", async () => {
    const { calls } = install();
    await fetchGraphSignalsByCity({ workspaceId: WS }, { dateFrom: "2026-01-01", excludePiia: true });
    const detail = await fetchGraphSignalDetail({ workspaceId: WS }, "valleyfield");
    expect(calls[0]!.url.pathname).toBe(`${RELAY}/api/v1/workspaces/${WS}/signal-facets/by-city`);
    expect(Object.fromEntries(calls[0]!.url.searchParams)).toEqual({ dateFrom: "2026-01-01", excludePiia: "1" });
    expect(calls[1]!.url.pathname).toBe(`${RELAY}/api/v1/workspaces/${WS}/signal-facets/coherent-city`);
    expect(Object.fromEntries(calls[1]!.url.searchParams)).toEqual({ citySlug: "valleyfield", mode: "signal" });
    expect(detail.nodes[0]!.sourceRef).toBeNull();
    expect(JSON.stringify(detail)).toContain("/__reader/api/documents.pv.v1?");
  });

  it("should relay the zones, lots, geo-zones and CPTAQ reads instead of answering gaps locally", async () => {
    const feature = (code: string) => ({ type: "Feature", geometry: { type: "Polygon",
      coordinates: [[[-74, 45], [-74, 45.1], [-73.9, 45.1], [-74, 45]]] }, properties: { zoneCode: code } });
    const collection = json(200, { type: "FeatureCollection", features: [feature("H-1")],
      numberMatched: 1, numberReturned: 1, nextOffset: null });
    const { calls } = install(relayHost({
      [`${RELAY}/api/geo/collections/qc-zonage-valleyfield/items`]: () => collection.clone(),
      [`${RELAY}/api/geo/collections/qc-lots-valleyfield/items`]: () => collection.clone(),
    }));
    expect((await fetchZones("valleyfield")).ok).toBe(true);
    expect((await fetchLots("valleyfield")).ok).toBe(true);
    await fetch("/api/geo/valleyfield/zones");
    await fetch("/api/geo/collections/ca-qc-constraints-valleyfield/items?bbox=1,2,3,4");
    expect(calls.map((call) => call.url.pathname)).toEqual([
      `${RELAY}/api/geo/collections/qc-zonage-valleyfield/items`,
      `${RELAY}/api/geo/collections/qc-lots-valleyfield/items`,
      `${RELAY}/api/geo/valleyfield/zones`,
      `${RELAY}/api/geo/collections/ca-qc-constraints-valleyfield/items`,
    ]);
  });

  it("should forward a classification write with its method, body and idempotency key", async () => {
    const { calls } = install(relayHost({
      [`${RELAY}/api/v1/workspaces/${WS}/signal-facets/personal/discard`]: () =>
        json(200, { ok: true, event: { id: "evt-1" } }),
    }));
    const res = await fetch(`/api/v1/workspaces/${WS}/signal-facets/personal/discard`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "key-1" },
      body: JSON.stringify({ citySlug: "valleyfield", type: "Signal", id: "sig-1", reasonCode: "N-1" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, event: { id: "evt-1" } });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init?.method).toBe("POST");
    expect((calls[0]!.init?.headers as Headers).get("idempotency-key")).toBe("key-1");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual(
      { citySlug: "valleyfield", type: "Signal", id: "sig-1", reasonCode: "N-1" });
  });

  it("should pass an application refusal through unchanged (refused by the app, not locally)", async () => {
    install(relayHost({
      [`${RELAY}/api/v1/workspaces/${WS}/signal-facets/personal/discard`]: () =>
        json(403, { ok: false, error: { code: "workspace_forbidden" } }),
    }));
    const res = await fetch(`/api/v1/workspaces/${WS}/signal-facets/personal/discard`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: { code: "workspace_forbidden" } });
  });

  it("should relay a raw document URL and pass the op PDF URL through untouched", async () => {
    const { calls } = install(relayHost({
      [`${RELAY}/api/documents/raw`]: () =>
        new Response("%PDF-raw", { headers: { "Content-Type": "application/pdf" } }),
      "/__reader/api/documents.pv.v1": () =>
        new Response("%PDF-1.7", { headers: { "Content-Type": "application/pdf" } }),
    }));
    const raw = await fetch(`/api/documents/raw?rawRef=raw/proces-verbaux-x/cas/${SHA}.pdf`);
    expect(await raw.text()).toBe("%PDF-raw");
    const pdfUrl = `/__reader/api/documents.pv.v1?workspaceId=${WS}&citySlug=valleyfield&type=Signal&id=sig-1&docSha=${SHA}`;
    const pdf = await fetch(pdfUrl);
    expect(await pdf.text()).toBe("%PDF-1.7");
    expect(calls.map((call) => call.url.pathname)).toEqual(
      [`${RELAY}/api/documents/raw`, "/__reader/api/documents.pv.v1"]);
    expect(calls[1]!.init).toBeUndefined();
  });

  it("should navigate once to the consent screen on basket_consent_required", async () => {
    const consent = () => json(403, { ok: false, error: { code: "basket_consent_required" }, requestId: "r" });
    const { location } = install(relayHost({ [`${RELAY}/api/v1/workspaces`]: consent }));
    await expect(fetchWorkspaces()).rejects.toThrow();
    await expect(fetchWorkspaces()).rejects.toThrow();
    expect(location.assign).toHaveBeenCalledTimes(1);
    expect(location.assign).toHaveBeenCalledWith("/__reader/consent");
  });

  it("should renew through the bridge on 401 and reopen (never the app login) when renewal fails", async () => {
    let first = true;
    const host = relayHost({
      [`${RELAY}/api/v1/auth/me`]: () => {
        if (first) { first = false; return json(401, { error: "unauthenticated" }); }
        return json(200, { authenticated: true, user: { sub: "user-1", name: "Lectrice", status: "approved" } });
      },
    });
    const { calls, location } = install(host);
    expect((await fetch("/api/v1/auth/me")).status).toBe(200);
    expect(calls.map((call) => call.url.pathname)).toEqual(
      [`${RELAY}/api/v1/auth/me`, "/__reader/renew", `${RELAY}/api/v1/auth/me`]);
    expect((calls[2]!.init?.headers as Headers).get("x-preview-grant")).toBe("renewed-grant");
    expect(location.assign).not.toHaveBeenCalled();

    const dead = install(relayHost({
      [`${RELAY}/api/v1/auth/me`]: () => json(401, { error: "unauthenticated" }),
      "/__reader/renew": () => json(401, { error: "unauthenticated" }),
    }));
    expect((await fetch("/api/v1/auth/me")).status).toBe(401);
    expect(dead.location.assign).toHaveBeenCalledWith("/__reader/start");
  });

  it("should accept the app workspaces superset with the real app parser", () => {
    expect(parseWorkspacesResponse({ ok: true, workspaces: [{ id: WS, slug: "team", label: "Team",
      signals: { availability: { state: "open" } },
      workspace: { id: WS, slug: "team", label: "Team" }, moderateArchive: false, manageMembers: false }] }))
      .toEqual([{ id: WS, slug: "team", label: "Team", moderateArchive: false, manageMembers: false }]);
  });
});
