import { describe, expect, it, vi } from "vitest";
import { createReaderContentApp, type ContentServeDeps } from "./content-serve.js";
import { createFixtureAuthority, fingerprintReaderProfile } from "./reader-profile.js";
import { createMemoryReleaseFiles } from "./release-files.js";
import { mintSessionCookie } from "./preview-session.js";
import type { ReaderDocumentResult } from "./reader-documents.js";
import { ScopeError } from "../services/facets/scope.js";
import { WorkspaceError } from "../services/workspaces/types.js";
import { GRANT_SECRET, SESSION_SECRET, ISSUER, HOST } from "./reader-test-fixture.js";

const ARTIFACT = "123e4567-e89b-12d3-a456-426614174000";
const RELEASE = "123e4567-e89b-12d3-a456-426614174001";
const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const CITY = "valleyfield";
const SHA = "a".repeat(64);
const PDF = new TextEncoder().encode("%PDF-1.7\n%fixture\n");
const profile = { name: "demo", policyRevision: "pol-001",
  capabilities: ["geo.read", "signals.protected-read"] as const };

/** The sealed session of the bound host: what pdf.js presents (cookie only, no grant). */
function sealedCookie(readerSub = "reader-alice", basketScope = true): string {
  const resource = { ...ISSUER, host: HOST, artifactId: ARTIFACT, releaseId: RELEASE, readerSub,
    sessionId: "session-1", profileName: profile.name, policyRevision: profile.policyRevision,
    profileFingerprint: fingerprintReaderProfile(profile), ...(basketScope ? { basketScope: true as const } : {}) };
  return mintSessionCookie({ sid: "session-1", readerSub, artifactId: ARTIFACT, createdAt: 1_000,
    expiresAt: 901_000, resource, ...(basketScope ? { basketScope: true as const } : {}) },
  SESSION_SECRET).split(";")[0]!;
}

function setup(overrides: Partial<ContentServeDeps> = {}) {
  const readDocument = vi.fn(async (_params: unknown, _context: unknown): Promise<ReaderDocumentResult> =>
    ({ kind: "pdf", bytes: PDF }));
  const readOperation = vi.fn(async () => ({}));
  const app = createReaderContentApp({ contentBase: "pages.example.test", grantSecret: GRANT_SECRET,
    sessionSecret: SESSION_SECRET, issuer: ISSUER, authority: createFixtureAuthority(),
    now: () => 1_000, readOperation, readDocument,
    releaseFiles: createMemoryReleaseFiles([
      { artifactId: ARTIFACT, releaseId: RELEASE, path: "/index.html", body: "<!doctype html><html><body>x</body></html>" },
    ]),
    basketConsent: { hasLiveConsent: async () => true }, ...overrides });
  return { app, readDocument, readOperation };
}

const opPath = "/__reader/api/documents.pv.v1";
const query = `?workspaceId=${WORKSPACE}&citySlug=${CITY}&type=Signal&id=sig-1&docSha=${SHA}`;
const get = (app: ReturnType<typeof setup>["app"], qs = query, auth: Record<string, string> = { host: HOST }) =>
  app.request(`https://${HOST}${opPath}${qs}`, { headers: auth as never });

describe("documents.pv.v1 dispatch (§11.3, §15)", () => {
  it("should stream the PDF on the sealed cookie alone with the exact §11.3 headers", async () => {
    const { app, readDocument } = setup();
    const res = await get(app, query, { host: HOST, cookie: sealedCookie() });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe("inline; filename=\"document.pdf\"");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("accept-ranges")).toBeNull();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF);
    expect(readDocument).toHaveBeenCalledTimes(1);
    expect(readDocument.mock.calls[0]![0]).toEqual({ workspaceId: WORKSPACE, citySlug: CITY,
      type: "Signal", id: "sig-1", docSha: SHA });
  });

  it("should refuse gates before any store read", async () => {
    const { app, readDocument, readOperation } = setup();
    const cookie = sealedCookie();
    const refusals: Array<[Response, number]> = [
      [await get(app, query), 401],
      [await get(app, `${query}&grant=anything`, { host: HOST, cookie }), 400],
      [await get(app, query, { host: HOST, cookie, "x-reader-sub": "publisher" }), 400],
      [await get(app, query, { host: HOST, cookie, authorization: "Bearer x" }), 400],
      [await get(app, query, { host: HOST, cookie: sealedCookie("reader-alice", false) }), 403],
      [await get(app, query, { host: HOST, cookie: sealedCookie("reader-mallory") }), 401],
      [await get(app, query, { host: `223e4567-e89b-12d3-a456-426614174000.pages.example.test`, cookie }), 401],
    ];
    for (const [res, status] of refusals) {
      expect(res.status).toBe(status);
      const text = await res.text();
      expect(text).not.toContain(CITY);
      expect(text).not.toContain(SHA);
    }
    expect(readDocument).not.toHaveBeenCalled();
    expect(readOperation).not.toHaveBeenCalled();
  });

  it("should answer 405 on any non-GET without a store read", async () => {
    const { app, readDocument } = setup();
    for (const method of ["POST", "PUT", "DELETE"]) {
      const res = await app.request(`https://${HOST}${opPath}${query}`,
        { method, headers: { host: HOST, cookie: sealedCookie() } });
      expect(res.status).toBe(405);
    }
    expect(readDocument).not.toHaveBeenCalled();
  });

  it("should refuse rawRef, sourceUrl, unknown or duplicated params without a store read", async () => {
    for (const qs of [
      `${query}&rawRef=raw/proces-verbaux-${CITY}/cas/${SHA}.pdf`,
      `${query}&sourceUrl=https://ville.example.qc.ca/pv.pdf`,
      `${query}&docSha=${SHA}`,
      `${query}&unknown=1`,
      `?workspaceId=${WORKSPACE}&citySlug=${CITY}&type=Signal&id=sig-1&docSha=${"A".repeat(64)}`,
      `?rawRef=raw/proces-verbaux-${CITY}/cas/${SHA}.pdf`,
    ]) {
      const { app, readDocument } = setup();
      const res = await get(app, qs, { host: HOST, cookie: sealedCookie() });
      expect(res.status).toBe(400);
      expect(readDocument).not.toHaveBeenCalled();
    }
  });

  it("should map closed resolution outcomes to typed answers without an existence oracle", async () => {
    const outcomes: Array<[ReaderDocumentResult, number, string]> = [
      [{ kind: "not_found" }, 404, "document_not_found"],
      [{ kind: "unsupported_media" }, 415, "unsupported_media_type"],
      [{ kind: "too_large" }, 413, "payload_too_large"],
      [{ kind: "refused", cause: new WorkspaceError(404, "workspace_membership_required") }, 403, "workspace_not_authorized"],
      // M2: a raw service message carrying the workspace id never reaches the body.
      [{ kind: "refused", cause: new ScopeError(503, `scoped_facet_scope_unavailable:${WORKSPACE}`) }, 503,
        "signal_capability_unavailable"],
    ];
    for (const [result, status, code] of outcomes) {
      const { app, readDocument } = setup();
      readDocument.mockResolvedValue(result);
      const res = await get(app, query, { host: HOST, cookie: sealedCookie() });
      expect(res.status).toBe(status);
      const body = await res.json();
      expect(body).toEqual({ error: code });
      expect(JSON.stringify(body)).not.toContain(WORKSPACE);
    }
  });

  it("should count refusals against the §13 budget (anti-enumeration)", async () => {
    const { app, readDocument } = setup();
    const cookie = sealedCookie();
    expect((await get(app, `${query}&unknown=1`, { host: HOST, cookie })).status).toBe(400);
    readDocument.mockResolvedValueOnce({ kind: "not_found" });
    expect((await get(app, query, { host: HOST, cookie })).status).toBe(404);
    const limited = await get(app, query, { host: HOST, cookie });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(readDocument).toHaveBeenCalledTimes(1);
  });

  it("should not serve the PDF again after a revocation", async () => {
    let live = true;
    const { app, readDocument } = setup({ basketConsent: { hasLiveConsent: async () => live } });
    const cookie = sealedCookie();
    expect((await get(app, query, { host: HOST, cookie })).status).toBe(200);
    live = false;
    expect((await get(app, query, { host: HOST, cookie })).status).toBe(403);
    expect(readDocument).toHaveBeenCalledTimes(1);
  });

  it("should withhold the bytes when the authorization changes during the read", async () => {
    let changed = false;
    const authority = { ...createFixtureAuthority(), getAuthorizationVersion: async () => (changed ? "v2" : "v1") };
    const { app, readDocument } = setup({ authority });
    readDocument.mockImplementation(async () => { changed = true; return { kind: "pdf", bytes: PDF }; });
    const res = await get(app, query, { host: HOST, cookie: sealedCookie() });
    expect(res.status).toBe(401);
    expect(readDocument).toHaveBeenCalledTimes(1);
  });

  it("should stay closed (503) when no document reader is wired", async () => {
    const { app } = setup({ readDocument: undefined } as unknown as Partial<ContentServeDeps>);
    const res = await get(app, query, { host: HOST, cookie: sealedCookie() });
    expect(res.status).toBe(503);
  });
});
