// OIDC relying-party glue against the shared sentropic IdP (auth.sent-tech.ca).
// Implements RP_SESSION_GLUE.md steps 1–4: discovery → authorize URL (code +
// PKCE) → token exchange (client_secret_basic) → id_token verification against
// the IdP JWKS (EdDSA). Step 5 (minting radar's own session) lives in
// session.ts. Every outbound call goes through an injectable `fetch` and an
// injectable JWKS resolver so unit tests run fully offline.

import {
  jwtVerify,
  createRemoteJWKSet,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";
import { createHash, randomBytes } from "node:crypto";
import type { AuthConfig } from "../../config.js";

/** OIDC endpoints we need from discovery (`/.well-known/openid-configuration`). */
export interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

/** Per-login transient state, stashed in a short-lived cookie until callback. */
export interface AuthFlowState {
  /** CSRF token echoed back as the `state` query param. */
  state: string;
  /** Replay-binding nonce, checked against the id_token `nonce` claim. */
  nonce: string;
  /** PKCE code_verifier; its S256 hash is sent as code_challenge. */
  codeVerifier: string;
}

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Generate fresh state + nonce + PKCE verifier for one login attempt. */
export function createAuthFlowState(): AuthFlowState {
  return {
    state: base64url(randomBytes(32)),
    nonce: base64url(randomBytes(32)),
    codeVerifier: base64url(randomBytes(32)),
  };
}

/** PKCE S256 challenge for a verifier (RFC 7636). */
export function codeChallengeS256(codeVerifier: string): string {
  return base64url(createHash("sha256").update(codeVerifier).digest());
}

/** Minimal `fetch` shape we depend on (Node 24 global / injectable in tests). */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

/**
 * Fetch the IdP discovery document. The issuer is trusted from config; we only
 * sanity-check that the returned issuer matches to avoid endpoint confusion.
 */
export async function fetchDiscovery(
  auth: AuthConfig,
  fetchImpl: FetchLike,
): Promise<OidcDiscovery> {
  const url = `${auth.issuer}/.well-known/openid-configuration`;
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`discovery failed: ${res.status}`);
  }
  const doc = (await res.json()) as Partial<OidcDiscovery>;
  if (
    !doc.authorization_endpoint ||
    !doc.token_endpoint ||
    !doc.jwks_uri ||
    !doc.issuer
  ) {
    throw new Error("discovery document missing required endpoints");
  }
  if (doc.issuer.replace(/\/$/, "") !== auth.issuer) {
    throw new Error(
      `discovery issuer mismatch: ${doc.issuer} != ${auth.issuer}`,
    );
  }
  return {
    issuer: auth.issuer,
    authorization_endpoint: doc.authorization_endpoint,
    token_endpoint: doc.token_endpoint,
    jwks_uri: doc.jwks_uri,
  };
}

/**
 * Build the 302 target to the IdP authorize endpoint (code + PKCE).
 *
 * `prompt` (OIDC `prompt` parameter, RFC 6749 / OpenID Connect Core §3.1.2.1):
 * when set to `"login"` the IdP MUST re-authenticate the End-User even if it
 * holds an active SSO session, instead of silently re-issuing an id_token for
 * whoever is currently signed in at the IdP. This is what makes
 * "logout → reconnect" land on a fresh login screen (not the previous user)
 * and makes an invitation link force a real device authentication (not reuse a
 * residual admin SSO session at the IdP). Without it, deleting radar's own
 * cookie is not enough — the IdP's session would silently re-authorize the
 * last user. Omitted (no `prompt`) for ordinary first logins where SSO reuse
 * is desirable.
 */
export function buildAuthorizeUrl(
  auth: AuthConfig,
  discovery: OidcDiscovery,
  flow: AuthFlowState,
  opts: { prompt?: "login" | "select_account" | "none" | "consent" } = {},
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: auth.clientId,
    redirect_uri: auth.redirectUri,
    scope: auth.scopes,
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: codeChallengeS256(flow.codeVerifier),
    code_challenge_method: "S256",
  });
  if (opts.prompt) params.set("prompt", opts.prompt);
  return `${discovery.authorization_endpoint}?${params.toString()}`;
}

/** Raw token response from the IdP token endpoint. */
export interface TokenResponse {
  id_token: string;
  access_token?: string;
  token_type?: string;
  expires_in?: number;
}

/**
 * Exchange an authorization code for tokens. Confidential client:
 * client_secret_basic (HTTP Basic with client_id:client_secret), plus the
 * PKCE code_verifier so the IdP can confirm the challenge.
 */
export async function exchangeCode(
  auth: AuthConfig,
  discovery: OidcDiscovery,
  code: string,
  codeVerifier: string,
  fetchImpl: FetchLike,
): Promise<TokenResponse> {
  const basic = Buffer.from(
    `${encodeURIComponent(auth.clientId)}:${encodeURIComponent(auth.clientSecret)}`,
  ).toString("base64");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: auth.redirectUri,
    code_verifier: codeVerifier,
  });
  const res = await fetchImpl(discovery.token_endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${basic}`,
      accept: "application/json",
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`token exchange failed: ${res.status} ${detail}`.trim());
  }
  const json = (await res.json()) as Partial<TokenResponse>;
  if (!json.id_token) {
    throw new Error("token response missing id_token");
  }
  return json as TokenResponse;
}

/** Verified id_token claims we care about (Phase A0: sub/name/email). */
export interface VerifiedIdToken {
  sub: string;
  name?: string;
  email?: string;
}

/**
 * Verify the id_token signature against the IdP JWKS and check
 * iss / aud / exp / nonce. The JWKS key-getter is injectable so tests pass a
 * local key set instead of hitting the network; production defaults to
 * `createRemoteJWKSet(jwks_uri)` (which caches and rotates keys).
 */
export async function verifyIdToken(
  idToken: string,
  opts: {
    auth: AuthConfig;
    discovery: OidcDiscovery;
    expectedNonce: string;
    getKey?: JWTVerifyGetKey;
    now?: number;
  },
): Promise<VerifiedIdToken> {
  const getKey =
    opts.getKey ?? createRemoteJWKSet(new URL(opts.discovery.jwks_uri));
  const { payload } = await jwtVerify(idToken, getKey, {
    issuer: opts.auth.issuer,
    audience: opts.auth.clientId,
    // Only set `currentDate` when an explicit clock is injected (tests); the
    // project's exactOptionalPropertyTypes forbids passing an explicit
    // `undefined`, so we omit the key entirely otherwise (jose uses Date.now()).
    ...(opts.now !== undefined ? { currentDate: new Date(opts.now) } : {}),
  });
  const claims = payload as JWTPayload & {
    name?: unknown;
    email?: unknown;
    nonce?: unknown;
  };
  if (claims.nonce !== opts.expectedNonce) {
    throw new Error("id_token nonce mismatch");
  }
  if (typeof claims.sub !== "string" || claims.sub === "") {
    throw new Error("id_token missing sub");
  }
  const out: VerifiedIdToken = { sub: claims.sub };
  if (typeof claims.name === "string") out.name = claims.name;
  if (typeof claims.email === "string") out.email = claims.email;
  return out;
}
