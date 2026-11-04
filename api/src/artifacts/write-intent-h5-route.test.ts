// PW-A PWA-07: H5 receiver stays closed without deps and has no command path.
import { describe, expect, it, vi } from "vitest";
import { writeIntentH5Route, type H5WriteDeps } from "./write-intent-h5-route.js";
import { mintWriteGrant } from "./write-grant.js";

const UUID = "11111111-1111-4111-8111-111111111111";
const SECRET = "0123456789abcdef0123456789abcdef";
const GRANT = { issuer: "https://h5.example.test", audience: "radar-artifact-write",
  tier: "preprod", identityIssuer: "https://auth.example.test",
  jti: UUID, sessionId: "page-session", sub: "reader", readerSub: "reader",
  artifactId: "artifact-1", releaseId: "release-1", host: "h5.example.test",
  profileName: "h5-signal-write-v2", profileFingerprint: "fp-1", policyRevision: "policy-1",
  workspaceId: UUID, citySlug: "demo-town",
  operations: ["facets.signals.personal.select.v1"] };
const PAGE = { grant: GRANT, pageInstanceId: "instance-1", csrfToken: "c".repeat(40),
  pageExpiresAtMs: 60_000, delegationExpiresAtMs: 60_000, authorityReferences: {} };
const BODY = { operation: "facets.signals.personal.select.v1", workspaceId: UUID,
  target: { citySlug: "demo-town", type: "Signal", id: "sig-1" }, basket: "pertinent",
  expectedHeadId: null, displayedFingerprint: "a".repeat(64), expectedProjectionToken: "b".repeat(64) };

function depsFor(gate: (readerSub: string, artifactId: string, scopeId: string) => Promise<boolean>) {
  return { grantIssuer: GRANT, grantKeyId: "key-1", grantSecret: SECRET,
    resolvePage: async () => PAGE, db: null, nowMs: () => 1000,
    basketConsent: { hasLiveConsent: gate } } as unknown as H5WriteDeps;
}

async function prepareRequest(grant: string) {
  return new Request("https://h5.example.test/write-intents", { method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": UUID,
      "x-preview-write-grant": grant }, body: JSON.stringify(BODY) });
}

describe("h5 write receiver", () => {
  it("should stay closed without authority and refuse command methods", async () => {
    const app = writeIntentH5Route(null);
    const closed = await app.request("/write-intents", { method: "POST" });
    expect(closed.status).toBe(503);
    expect(await closed.json()).toMatchObject({ operation: "facets.write-intents.prepare.v1",
      error: { code: "write_transport_closed", action: "contact_operator" } });
    expect(closed.headers.get("cache-control")).toBe("private, no-store");
    expect((await app.request("/write-intents", { method: "GET" })).status).toBe(405);
    expect((await app.request("/write-intents/some-id", { method: "POST" })).status).toBe(405);
  });

  it("should refuse prepare without a live write-prepare consent, before any intent (Gate B)", async () => {
    const gate = vi.fn(async () => false);
    const app = writeIntentH5Route(depsFor(gate));
    const grant = await mintWriteGrant(GRANT, SECRET, 1000);
    const refused = await app.request(await prepareRequest(grant));
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ ok: false,
      error: { code: "basket_consent_required", action: "consent_baskets" } });
    expect(gate).toHaveBeenCalledWith("reader", "artifact-1", "baskets.write.prepare");
  });
});
