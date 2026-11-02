import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ARTIFACT_STRICT, ARTIFACT_PART1, ARTIFACT_PROFILE_DESCRIPTOR, HOST_ARTIFACT_PROFILE, createArtifactControl } from "@radar/artifacts-host";
import { PRECONDITION_REQUIRED_MESSAGE } from "@sentropic/artifacts/mcp-core";
import { p0bFixture } from "../../../artifacts-host/src/p0b.test-support.js";
import { controlRoute } from "../../../../api/src/artifacts/control-route.js";
import { signSession } from "../../../../api/src/services/auth/session.js";
import type { AuthConfig } from "../../../../api/src/config.js";

const auth: AuthConfig = { enabled: true, issuer: "https://auth.test", clientId: "test", clientSecret: "synthetic",
  redirectUri: "https://app.test/callback", scopes: "openid", appBaseUrl: "https://app.test",
  sessionSecret: "p0c-test-only-32-byte-session-secret", sessionTtlSeconds: 3600, sessionAbsoluteTtlSeconds: 7200,
  jwksUri: "https://auth.test/keys", bearerAudiences: ["https://app.test"] };

describe.skipIf(!ARTIFACT_STRICT || !process.env.P0B_DATABASE_URL)("strict cookie HTTP binding with PostgreSQL", () => {
  let h: Awaited<ReturnType<typeof p0bFixture>>;
  beforeAll(async () => { h = await p0bFixture(HOST_ARTIFACT_PROFILE); });
  afterAll(async () => { await h?.close(); });
  it("should preserve exact 428 details and reject early validation in the selected envelope", async () => {
    const app = controlRoute({ auth, accounts: h.pool, backend: createArtifactControl(h.host, "p0b", "pages.test") });
    const token = await signSession({ sub: "alice" }, { sessionSecret: auth.sessionSecret, ttlSeconds: 3600 });
    const headers = { cookie: `radar_session=${token}`, origin: auth.appBaseUrl, "content-type": "application/json" };
    const post = (op: string, body: unknown) => app.request(`https://app.test/${op}`, { method: "POST", headers, body: JSON.stringify(body) });
    const ensured = await (await post("ensure", { bindingName: randomUUID(), idempotencyKey: randomUUID() })).json();
    const artifactId = (ARTIFACT_PART1 ? ensured.output : ensured).artifactId;
    const omitted = await post("publish", { artifactId, files: [{ path: "index.html", mimeType: "text/html", text: "x" }], idempotencyKey: randomUUID() });
    expect(omitted.status).toBe(428);
    const result = await omitted.json();
    const error = ARTIFACT_PART1 ? result.error : result;
    expect(ARTIFACT_PART1 ? error.code : error.error).toBe("precondition_required");
    expect(error.message).toBe(PRECONDITION_REQUIRED_MESSAGE);
    expect(error.details).toEqual({ profileRevisionId: ARTIFACT_PROFILE_DESCRIPTOR.profileRevisionId,
      resultEnvelopeVersion: ARTIFACT_PROFILE_DESCRIPTOR.resultEnvelopeVersion, requiredField: "expectedCurrentReleaseId", readTools: ["artifacts_get", "artifacts_list"] });
    const invalid = await app.request("https://app.test/publish", { method: "POST", headers, body: "{" });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject(ARTIFACT_PART1
      ? { ok: false, commitState: "not_committed", error: { code: "invalid_json", retriable: false } } : { error: "invalid_json" });
  });
});
