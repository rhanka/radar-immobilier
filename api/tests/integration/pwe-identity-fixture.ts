import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createApp } from "../../src/app.js";
import { canonicalWritePrincipal, type PwIdentityDomain } from "../../src/artifacts/write-intent-principal.js";
import { mintPageWriteGrant } from "../../src/artifacts/write-intent-page-authority.js";
import { verifyWriteGrant } from "../../src/artifacts/write-grant.js";
import { prepareWriteIntent } from "../../src/artifacts/write-intent-service.js";
import { createWriteAppSurface } from "../../src/artifacts/write-intent-app-surface.js";
import { loadPwIntentForShare } from "../../src/services/facets/pw-write-store.js";
import { readProjectionScope } from "../../src/services/facets/projection-revisions.js";
import { authorityFixture } from "./pw-write-authority-fixture.js";
import { normalLogin } from "./pwe-normal-login.js";

/** Each identity domain has its own SQL store, session key and H5 write key. */
export async function identityFixture(domain: PwIdentityDomain, sub: string, ttlSeconds = 3600) {
  const h = await authorityFixture();
  await h.f.pool.query("UPDATE account_users SET sub=$1 WHERE id=$2", [sub, h.f.contributor.id]);
  h.f.contributor.sub = sub;
  const login = await normalLogin(domain, h.f.db, sub, ttlSeconds);
  const h5Issuer = `https://h5.${domain.clientId}.example.test`;
  h.page.grant = { ...h.page.grant, issuer: h5Issuer, tier: domain.tier,
    identityIssuer: domain.identityIssuer, sub: login.session.sub, readerSub: login.session.sub };
  h.page.authorityReferences = { ...h.page.authorityReferences, tier: domain.tier };
  h.writeH5.grantIssuer = { issuer: h5Issuer, audience: h.page.grant.audience,
    tier: domain.tier, identityIssuer: domain.identityIssuer };
  h.writeH5.grantKeyId = `pwe-write-${domain.clientId}-v1`;
  h.writeH5.grantSecret = randomBytes(32).toString("hex");
  h.writeH5.challengeKeyId = `pwe-challenge-${domain.clientId}-v1`;
  const token = await mintPageWriteGrant(h.page, h.writeH5, h.clock.now);
  const verified = await verifyWriteGrant(token, h.writeH5.grantIssuer, h.writeH5.grantSecret, h.clock.now);
  assert.ok(verified);
  const current = await readProjectionScope(h.f.db, sub, h.f.workspaceId, h.body.target.citySlug, "signal");
  const intent = await prepareWriteIntent(h.f.db, verified,
    { ...h.body, expectedProjectionToken: current.token }, h.input.commandKey, h.page.pageInstanceId, {
      challengeKeyId: h.writeH5.challengeKeyId, authorityReferences: h.page.authorityReferences,
      nowMs: () => h.clock.now, confirmationBaseUrl: `${domain.appOrigin}/artifact-write/intents`,
      managementBaseUrl: `${domain.appOrigin}/artifact-write/intents`,
      statusBaseUrl: `${domain.appOrigin}/api/v1/artifacts/write-intents`,
    });
  const row = await h.f.db.transaction((tx) => loadPwIntentForShare(tx, intent.intentId));
  const app = createApp({ checkDb: async () => ({ ok: true }), checkObjectStore: async () => ({ ok: true }),
    store: { get: async () => { throw new Error("unexpected object read"); },
      head: async () => { throw new Error("unexpected object probe"); },
      put: async () => { throw new Error("unexpected object write"); } },
    db: h.f.db, auth: login.auth,
    writeApp: createWriteAppSurface({ auth: login.auth, domain, accounts: h.f.pool, nowMs: () => h.clock.now,
      db: h.f.db, sessionSecret: login.auth.sessionSecret,
      challengeKeys: new Map([[h.writeH5.challengeKeyId, randomBytes(32)]]) }) });
  const summary = (cookie = login.cookie) => app.request(intent.confirmationUrl, {
    headers: { host: new URL(domain.appOrigin).host, cookie,
      "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" } });
  return { h, login, row, verified, app, intent, writePrincipal: canonicalWritePrincipal(verified),
    domain, summary, keyRefs: { session: `pwe-session-${domain.clientId}-v1`,
      write: h.writeH5.grantKeyId, challenge: h.writeH5.challengeKeyId } };
}
