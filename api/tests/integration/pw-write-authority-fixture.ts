import { randomUUID } from "node:crypto";
import { createApp } from "../../src/app.js";
import type { ObjectStore } from "../../src/storage/object-store.js";
import { EMPTY_DISCARDED_SIGNALS } from "../../src/services/graph/discarded-signals.js";
import { workspaceFixture } from "../../src/services/facets/workspace-archive-fixture.js";
import { preparedSelect } from "../../src/services/facets/signal-write-fixture.js";
import { confirmPwSignalWrite } from "../../src/services/facets/pw-write-confirm.js";
import { revokePwIntent } from "../../src/services/facets/pw-write-fences.js";
import type { SignalWriteInput } from "../../src/services/facets/signal-write-operations.js";
import { signSession } from "../../src/services/auth/session.js";
import { mintPageWriteGrant, type PageWriteAuthority } from "../../src/artifacts/write-intent-page-authority.js";
import type { WriteAppDeps } from "../../src/artifacts/write-intent-app-route.js";
import type { H5WriteDeps } from "../../src/artifacts/write-intent-h5-route.js";
import { baseAuth } from "./base-api-fixture.js";

export const H5 = "/api/v1/artifacts/reader/facets/write-intents";
export const APP = "/api/v1/artifacts/write-intents";
export async function authorityFixture() {
  const f = await workspaceFixture();
  const input = await preparedSelect(f);
  const { commandKey, expiresAtMs: _, ...body } = input;
  const clock = { now: Date.now() };
  const domain = { identityIssuer: baseAuth.issuer, tier: "preprod" as const,
    appOrigin: baseAuth.appBaseUrl, clientId: baseAuth.clientId };
  const page: PageWriteAuthority = {
    grant: { issuer: "https://h5.example.test", audience: "radar-artifact-write", tier: "preprod",
      jti: randomUUID(), sessionId: randomUUID(), sub: f.contributor.sub, readerSub: f.contributor.sub,
      identityIssuer: domain.identityIssuer, artifactId: randomUUID(), releaseId: randomUUID(),
      host: "content.pages.example.test", profileName: "h5-signal-write-v2", profileFingerprint: "c".repeat(64),
      policyRevision: "policy-1", workspaceId: f.workspaceId, citySlug: input.target.citySlug,
      operations: [input.operation] },
    pageInstanceId: randomUUID(), pageExpiresAtMs: clock.now + 60_000,
    delegationExpiresAtMs: clock.now + 90_000, authorityReferences: {},
  };
  page.grant = { ...page.grant, host: `${page.grant.artifactId}.pages.example.test` };
  page.authorityReferences = { tier: "preprod", policy: page.grant.policyRevision,
    release: page.grant.releaseId, delegation: randomUUID(), reader: f.contributor.id,
    grant: page.grant.jti, page_session: page.grant.sessionId };
  const writeH5: H5WriteDeps = { db: f.db, challengeKeyId: "key-1",
    grantKeyId: "write-key-1",
    grantSecret: "synthetic-write-grant-secret-32-characters",
    grantIssuer: { issuer: page.grant.issuer, audience: page.grant.audience,
      tier: page.grant.tier, identityIssuer: domain.identityIssuer },
    resolvePage: async (req) => req.headers.get("x-synthetic-page-proof") === page.grant.sessionId ? page : null,
    nowMs: () => clock.now, confirmationBaseUrl: `${domain.appOrigin}/artifact-write/intents`,
    managementBaseUrl: `${domain.appOrigin}/artifact-write/intents`, statusBaseUrl: `${domain.appOrigin}${APP}` };
  let confirms = 0;
  let sessionExpiry = 0;
  const writeApp: WriteAppDeps = { db: f.db, auth: baseAuth, domain,
    accounts: f.pool, sessionSecret: baseAuth.sessionSecret, nowMs: () => clock.now,
    challengeKeys: new Map([["key-1", Buffer.alloc(32, 7)]]),
    renderSummary: (c, row, bootstrap) => c.json({ intentId: row.intentId, ...bootstrap }),
    confirm: async (row, proof) => {
      confirms++;
      sessionExpiry = proof.sessionExpiresAtMs;
      return confirmPwSignalWrite(f.db, proof.principal.sub, row.intentId,
        row.command as SignalWriteInput, { confirmation: proof, clockMs: () => clock.now });
    },
    revoke: (row, principal) => f.db.transaction((tx) => revokePwIntent(tx, row.intentId, row.actorId, principal)),
  };
  const app = createApp({ checkDb: async () => ({ ok: true }), checkObjectStore: async () => ({ ok: true }),
    store: {} as ObjectStore, db: f.db, discarded: EMPTY_DISCARDED_SIGNALS, auth: baseAuth,
    contentHost: { enabled: true, contentBase: "pages.example.test" }, writeH5, writeApp });
  const cookie = async (sub = f.contributor.sub, ttl = 3600) => `radar_session=${await signSession({ sub },
    { sessionSecret: baseAuth.sessionSecret, ttlSeconds: ttl, now: clock.now })}`;
  const request = (path: string, init: RequestInit = {}) => app.request(`${domain.appOrigin}${path}`, {
    ...init, headers: { host: new URL(domain.appOrigin).host, ...Object.fromEntries(new Headers(init.headers)) } });
  const prepare = async (extra: Record<string, unknown> = {}, key = commandKey, token?: string) => request(H5, {
    method: "POST", headers: { "content-type": "application/json", "idempotency-key": key,
      "x-preview-write-grant": token ?? await mintPageWriteGrant(page, writeH5, clock.now),
      "x-synthetic-page-proof": page.grant.sessionId }, body: JSON.stringify({ ...body, ...extra }) });
  return { f, body, input, page, clock, writeH5, writeApp, app, cookie, request, prepare,
    counters: () => ({ confirms, sessionExpiry }) };
}
