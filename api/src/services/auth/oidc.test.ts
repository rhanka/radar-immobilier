import { describe, expect, it } from "vitest";
import { SignJWT, generateKeyPair, exportJWK, type JWK } from "jose";
import { createLocalJWKSet } from "jose";
import {
  buildAuthorizeUrl,
  codeChallengeS256,
  createAuthFlowState,
  exchangeCode,
  fetchDiscovery,
  verifyIdToken,
  type FetchLike,
  type OidcDiscovery,
} from "./oidc.js";
import type { AuthConfig } from "../../config.js";

const AUTH: AuthConfig = {
  enabled: true,
  issuer: "https://auth.example.test",
  clientId: "radar-immobilier",
  clientSecret: "super-secret",
  redirectUri: "https://immo.example.test/api/v1/auth/oauth/callback",
  scopes: "openid profile email",
  appBaseUrl: "https://immo.example.test",
  sessionSecret: "session-secret",
  sessionTtlSeconds: 3600,
};

const DISCOVERY: OidcDiscovery = {
  issuer: AUTH.issuer,
  authorization_endpoint: `${AUTH.issuer}/api/v1/auth/oauth/authorize`,
  token_endpoint: `${AUTH.issuer}/api/v1/auth/oauth/token`,
  jwks_uri: `${AUTH.issuer}/.well-known/jwks.json`,
};

/** Build a FetchLike that returns canned responses per URL. */
function mockFetch(
  handlers: Record<
    string,
    {
      ok?: boolean;
      status?: number;
      json?: unknown;
      text?: string;
      assert?: (init?: Parameters<FetchLike>[1]) => void;
    }
  >,
): FetchLike {
  return async (url, init) => {
    const h = handlers[url];
    if (!h) throw new Error(`unexpected fetch: ${url}`);
    h.assert?.(init);
    return {
      ok: h.ok ?? true,
      status: h.status ?? 200,
      json: async () => h.json,
      text: async () => h.text ?? "",
    };
  };
}

describe("PKCE + state", () => {
  it("generates distinct random state/nonce/verifier", () => {
    const a = createAuthFlowState();
    const b = createAuthFlowState();
    expect(a.state).not.toBe(b.state);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    // base64url, no padding / unsafe chars.
    expect(a.state).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("derives a stable S256 challenge", () => {
    // RFC 7636 Appendix B test vector.
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(codeChallengeS256(verifier)).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
});

describe("fetchDiscovery", () => {
  it("returns endpoints when the issuer matches", async () => {
    const f = mockFetch({
      [`${AUTH.issuer}/.well-known/openid-configuration`]: { json: DISCOVERY },
    });
    const d = await fetchDiscovery(AUTH, f);
    expect(d.token_endpoint).toBe(DISCOVERY.token_endpoint);
    expect(d.jwks_uri).toBe(DISCOVERY.jwks_uri);
  });

  it("throws on issuer mismatch", async () => {
    const f = mockFetch({
      [`${AUTH.issuer}/.well-known/openid-configuration`]: {
        json: { ...DISCOVERY, issuer: "https://evil.test" },
      },
    });
    await expect(fetchDiscovery(AUTH, f)).rejects.toThrow(/issuer mismatch/);
  });

  it("throws on missing endpoints", async () => {
    const f = mockFetch({
      [`${AUTH.issuer}/.well-known/openid-configuration`]: {
        json: { issuer: AUTH.issuer },
      },
    });
    await expect(fetchDiscovery(AUTH, f)).rejects.toThrow(/missing/);
  });
});

describe("buildAuthorizeUrl", () => {
  it("encodes code+PKCE params", () => {
    const flow = createAuthFlowState();
    const url = new URL(buildAuthorizeUrl(AUTH, DISCOVERY, flow));
    expect(url.origin + url.pathname).toBe(DISCOVERY.authorization_endpoint);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe(AUTH.clientId);
    expect(url.searchParams.get("redirect_uri")).toBe(AUTH.redirectUri);
    expect(url.searchParams.get("scope")).toBe(AUTH.scopes);
    expect(url.searchParams.get("state")).toBe(flow.state);
    expect(url.searchParams.get("nonce")).toBe(flow.nonce);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(
      codeChallengeS256(flow.codeVerifier),
    );
  });

  it("omits `prompt` by default (SSO reuse allowed for first login)", () => {
    const flow = createAuthFlowState();
    const url = new URL(buildAuthorizeUrl(AUTH, DISCOVERY, flow));
    expect(url.searchParams.get("prompt")).toBeNull();
  });

  it("forces re-authentication with prompt=login when requested", () => {
    // prompt=login makes the IdP re-authenticate instead of silently reusing
    // an active SSO session — the fix for "logout → reconnect = previous user"
    // and "invite link → residual admin".
    const flow = createAuthFlowState();
    const url = new URL(
      buildAuthorizeUrl(AUTH, DISCOVERY, flow, { prompt: "login" }),
    );
    expect(url.searchParams.get("prompt")).toBe("login");
  });
});

describe("exchangeCode", () => {
  it("posts client_secret_basic + PKCE verifier and returns tokens", async () => {
    let seenAuth: string | undefined;
    let seenBody: string | undefined;
    const f = mockFetch({
      [DISCOVERY.token_endpoint]: {
        json: { id_token: "the-id-token", token_type: "Bearer" },
        assert: (init) => {
          seenAuth = init?.headers?.authorization;
          seenBody = init?.body;
        },
      },
    });
    const tokens = await exchangeCode(
      AUTH,
      DISCOVERY,
      "auth-code-123",
      "verifier-abc",
      f,
    );
    expect(tokens.id_token).toBe("the-id-token");
    const expectedBasic = Buffer.from(
      `${AUTH.clientId}:${AUTH.clientSecret}`,
    ).toString("base64");
    expect(seenAuth).toBe(`Basic ${expectedBasic}`);
    expect(seenBody).toContain("grant_type=authorization_code");
    expect(seenBody).toContain("code=auth-code-123");
    expect(seenBody).toContain("code_verifier=verifier-abc");
  });

  it("throws when the token endpoint errors", async () => {
    const f = mockFetch({
      [DISCOVERY.token_endpoint]: {
        ok: false,
        status: 401,
        text: "invalid_client",
      },
    });
    await expect(
      exchangeCode(AUTH, DISCOVERY, "c", "v", f),
    ).rejects.toThrow(/token exchange failed: 401/);
  });

  it("throws when id_token is absent", async () => {
    const f = mockFetch({
      [DISCOVERY.token_endpoint]: { json: { access_token: "only-access" } },
    });
    await expect(
      exchangeCode(AUTH, DISCOVERY, "c", "v", f),
    ).rejects.toThrow(/missing id_token/);
  });
});

describe("verifyIdToken (JWKS, EdDSA)", () => {
  async function makeIdToken(opts: {
    nonce?: string;
    sub?: string;
    aud?: string;
    iss?: string;
    name?: string;
    email?: string;
    expiresIn?: string;
  }): Promise<{ token: string; getKey: ReturnType<typeof createLocalJWKSet> }> {
    const { publicKey, privateKey } = await generateKeyPair("EdDSA", {
      crv: "Ed25519",
    });
    const pubJwk: JWK = await exportJWK(publicKey);
    pubJwk.kid = "test-key-1";
    pubJwk.alg = "EdDSA";
    const getKey = createLocalJWKSet({ keys: [pubJwk] });

    const token = await new SignJWT({
      nonce: opts.nonce,
      ...(opts.name !== undefined ? { name: opts.name } : {}),
      ...(opts.email !== undefined ? { email: opts.email } : {}),
    })
      .setProtectedHeader({ alg: "EdDSA", kid: "test-key-1" })
      .setIssuer(opts.iss ?? AUTH.issuer)
      .setAudience(opts.aud ?? AUTH.clientId)
      .setSubject(opts.sub ?? "user-sub-1")
      .setIssuedAt()
      .setExpirationTime(opts.expiresIn ?? "1h")
      .sign(privateKey);

    return { token, getKey };
  }

  it("verifies a well-formed id_token and returns claims", async () => {
    const { token, getKey } = await makeIdToken({
      nonce: "the-nonce",
      sub: "user-42",
      name: "Bob",
      email: "bob@example.test",
    });
    const claims = await verifyIdToken(token, {
      auth: AUTH,
      discovery: DISCOVERY,
      expectedNonce: "the-nonce",
      getKey,
    });
    expect(claims.sub).toBe("user-42");
    expect(claims.name).toBe("Bob");
    expect(claims.email).toBe("bob@example.test");
  });

  it("rejects a nonce mismatch", async () => {
    const { token, getKey } = await makeIdToken({ nonce: "real-nonce" });
    await expect(
      verifyIdToken(token, {
        auth: AUTH,
        discovery: DISCOVERY,
        expectedNonce: "wrong-nonce",
        getKey,
      }),
    ).rejects.toThrow(/nonce mismatch/);
  });

  it("rejects a wrong audience", async () => {
    const { token, getKey } = await makeIdToken({
      nonce: "n",
      aud: "some-other-client",
    });
    await expect(
      verifyIdToken(token, {
        auth: AUTH,
        discovery: DISCOVERY,
        expectedNonce: "n",
        getKey,
      }),
    ).rejects.toThrow();
  });

  it("rejects a wrong issuer", async () => {
    const { token, getKey } = await makeIdToken({
      nonce: "n",
      iss: "https://evil.test",
    });
    await expect(
      verifyIdToken(token, {
        auth: AUTH,
        discovery: DISCOVERY,
        expectedNonce: "n",
        getKey,
      }),
    ).rejects.toThrow();
  });

  it("rejects a token signed by an unknown key", async () => {
    const { token } = await makeIdToken({ nonce: "n" });
    // A different, unrelated JWKS.
    const { publicKey } = await generateKeyPair("EdDSA", { crv: "Ed25519" });
    const otherJwk: JWK = await exportJWK(publicKey);
    otherJwk.kid = "other-key";
    otherJwk.alg = "EdDSA";
    const otherGetKey = createLocalJWKSet({ keys: [otherJwk] });
    await expect(
      verifyIdToken(token, {
        auth: AUTH,
        discovery: DISCOVERY,
        expectedNonce: "n",
        getKey: otherGetKey,
      }),
    ).rejects.toThrow();
  });
});
