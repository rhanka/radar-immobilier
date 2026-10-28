import { expect, it, vi } from "vitest";
import { pageWriteListenerRoute, type PageListenerDeps } from "./write-intent-page-listener.js";
import { buildPagePrepareBody } from "./write-intent-page-gesture.js";
import { prepared, UUID, HEX64 } from "./write-intent-page-harness.js";

const host = `${UUID}.pages.example.test`, origin = `https://${host}`, csrf = "c".repeat(40);
const body = buildPagePrepareBody({ operation: "facets.signals.personal.select.v1", workspaceId: UUID,
  target: { citySlug: "demo-town", type: "Signal", id: "sig-1" }, basket: "pertinent",
  expectedHeadId: null, displayedFingerprint: HEX64, expectedProjectionToken: HEX64 });
function fixture() {
  const grant = { issuer: "https://h5.example.test", audience: "radar-artifact-write", tier: "preprod",
    identityIssuer: "https://auth.example.test", jti: UUID, sessionId: "P-1", sub: "reader", readerSub: "reader",
    artifactId: UUID, releaseId: UUID, host, profileName: "h5-signal-write-v2", profileFingerprint: HEX64,
    policyRevision: "v1", workspaceId: UUID, citySlug: "demo-town", operations: ["facets.signals.personal.select.v1"] };
  const forward = vi.fn(async (_request: Request) => Response.json(prepared(UUID).body, { status: 201, headers: { "set-cookie": "private=never" } }));
  const deps: PageListenerDeps = { applicationOrigin: "https://app.example.test", contentBase: "pages.example.test",
    grantIssuer: grant, grantKeyId: "key-1", grantSecret: "k".repeat(40), nowMs: () => 1000,
    resolvePage: async () => ({ grant, csrfToken: csrf, pageInstanceId: "instance-P-1", pageExpiresAtMs: 60_000,
      delegationExpiresAtMs: 60_000, authorityReferences: {} }), forward };
  const request = (changes: Record<string, string | null> = {}) => {
    const headers = new Headers({ host, origin, "x-reader-instance": "instance-P-1", "x-reader-csrf": csrf,
      "content-type": "application/json", "idempotency-key": UUID });
    for (const [name, value] of Object.entries(changes)) { if (value === null) headers.delete(name); else headers.set(name, value); }
    return new Request(`http://${host}/__reader/api/facets.write-intents.prepare.v1`, {
      method: "POST", headers, body: JSON.stringify(body) });
  };
  return { app: pageWriteListenerRoute(deps), forward, request };
}
it("should accept canonical HTTPS prepare over internal HTTP without trusting forwarding metadata", async () => {
  const h = fixture(), response = await h.app.request(h.request({ "x-forwarded-proto": "http", "x-forwarded-host": "foreign.test" }));
  expect(response.status).toBe(201); expect(h.forward).toHaveBeenCalledOnce();
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(h.forward.mock.calls[0]![0].headers.get("x-forwarded-host")).toBeNull();
});
it.each(["origin", "x-reader-instance", "x-reader-csrf"])("should require the exact %s before mint/forward", async (name) => {
  for (const value of [null, "foreign-P-2"]) {
    const h = fixture(), response = await h.app.request(h.request({ [name]: value }));
    expect(response.status).toBe(403); expect(h.forward).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ error: { code: "csrf_refused", attemptOutcome: "not_executed" } });
  }
});
