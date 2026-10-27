import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { authRoute } from "../../src/routes/auth.js";
import { verifySession } from "../../src/services/auth/session.js";
import { canonicalAppPrincipal, type PwIdentityDomain } from "../../src/artifacts/write-intent-principal.js";
import type { FetchLike } from "../../src/services/auth/oidc.js";
import type { Database } from "../../src/db/client.js";
import { baseAuth } from "./base-api-fixture.js";

/** Synthetic IdP boundary; the RP flow cookie and session are never forged. */
export async function normalLogin(domain: PwIdentityDomain, db: Database, sub: string) {
  const now = Date.now();
  const auth = { ...baseAuth, issuer: domain.identityIssuer, clientId: domain.clientId,
    appBaseUrl: domain.appOrigin, redirectUri: `${domain.appOrigin}/api/v1/auth/oauth/callback`,
    jwksUri: `${domain.identityIssuer}/jwks`, clientSecret: randomBytes(32).toString("hex"),
    sessionSecret: randomBytes(32).toString("hex") };
  const pair = await generateKeyPair("EdDSA");
  const kid = randomUUID();
  const getKey = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid, alg: "EdDSA" }] });
  const discovery = { issuer: auth.issuer, authorization_endpoint: `${auth.issuer}/authorize`,
    token_endpoint: `${auth.issuer}/token`, jwks_uri: auth.jwksUri };
  const codes = new Map<string, { nonce: string; challenge: string }>();
  let exchanges = 0;
  const fetchImpl: FetchLike = async (url, init) => {
    if (url === `${auth.issuer}/.well-known/openid-configuration`) return Response.json(discovery);
    assert.equal(url, discovery.token_endpoint);
    assert.equal(init?.method, "POST");
    assert.ok((init?.headers?.Authorization ?? init?.headers?.authorization) ===
      `Basic ${Buffer.from(`${auth.clientId}:${auth.clientSecret}`).toString("base64")}`,
    "Token exchange must authenticate its configured client");
    const body = new URLSearchParams(init?.body);
    const code = body.get("code") ?? "";
    const record = codes.get(code);
    assert.ok(record, "Only an actual issued authorization code can be exchanged");
    codes.delete(code);
    assert.equal(body.get("grant_type"), "authorization_code");
    assert.equal(body.get("redirect_uri"), auth.redirectUri);
    assert.equal(createHash("sha256").update(body.get("code_verifier") ?? "").digest("base64url"), record.challenge);
    exchanges++;
    const idToken = await new SignJWT({ nonce: record.nonce }).setProtectedHeader({ alg: "EdDSA", kid })
      .setIssuer(auth.issuer).setAudience(auth.clientId).setSubject(sub)
      .setIssuedAt(Math.floor(now / 1000)).setExpirationTime(Math.floor(now / 1000) + 600)
      .sign(pair.privateKey);
    return Response.json({ id_token: idToken, access_token: "synthetic-unused", token_type: "Bearer" });
  };
  const app = authRoute(auth, { db, fetchImpl, getKey, now: () => now });
  const login = await app.request(`${domain.appOrigin}/api/v1/auth/login`);
  assert.equal(login.status, 302);
  const authorize = new URL(login.headers.get("location") ?? "");
  assert.equal(authorize.origin, auth.issuer);
  assert.equal(authorize.searchParams.get("client_id"), auth.clientId);
  assert.equal(authorize.searchParams.get("redirect_uri"), auth.redirectUri);
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
  const code = randomUUID();
  codes.set(code, { nonce: authorize.searchParams.get("nonce")!,
    challenge: authorize.searchParams.get("code_challenge")! });
  const flow = login.headers.getSetCookie().find((value) => value.startsWith("radar_oauth_flow="));
  assert.ok(flow);
  const callback = new URL(auth.redirectUri);
  callback.searchParams.set("code", code);
  callback.searchParams.set("state", authorize.searchParams.get("state")!);
  const response = await app.request(callback.toString(), { headers: { cookie: flow.split(";")[0]! } });
  assert.equal(response.status, 302);
  assert.equal(exchanges, 1);
  const header = response.headers.getSetCookie().find((value) => value.startsWith("radar_session="));
  assert.ok(header);
  assert.match(header, /; Secure/i); assert.match(header, /; HttpOnly/i);
  assert.doesNotMatch(header, /; Domain=/i);
  const cookie = header.split(";")[0]!;
  const session = await verifySession(cookie.slice("radar_session=".length), { sessionSecret: auth.sessionSecret, now });
  assert.ok(session);
  return { auth, cookie, session, principal: canonicalAppPrincipal(session, domain),
    evidence: { login: login.status, callback: response.status, exchanges, normalFlow: true } };
}
