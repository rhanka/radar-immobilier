import { generateKeyPair, SignJWT, decodeJwt } from "jose";
import type { KeyLike } from "jose";
import type { ExchangeConfig } from "./exchange-config.js";
import { ExchangeCache, SingleFlightExchange } from "./exchange-cache.js";
import type { ExchangeRuntimeDeps } from "./authorized-egress.js";

export const TEST_ISSUER = "https://auth.test.local";
export const TEST_RESOURCE = "https://immo.test.local/mcp";
export const TEST_API_AUDIENCE = "https://immo.test.local";
export const TEST_WORKLOAD_SUB = "immo-mcp-workload";
export const TEST_WORKLOAD_CLIENT = "immo-mcp-workload";
export const TEST_WORKLOAD_SECRET = "synthetic:workload/key";
export const TEST_TOKEN_ENDPOINT = "https://exchange.test.local/token";
export const TEST_SCOPES = "immo:read immo:search immo:documents:read";

export interface IsolatedExchangeFixture {
  subjectPublicKey: KeyLike;
  subjectPrivateKey: KeyLike;
  exchangePublicKey: KeyLike;
  exchangePrivateKey: KeyLike;
  subjectKeySource: { resolveKey: () => Promise<KeyLike> };
  exchangeKeySource: { resolveKey: () => Promise<KeyLike> };
  tokenEndpoint: string;
  config: ExchangeConfig;
  issuedExchangedTokens: string[];
  fetchImpl: typeof fetch;
  exchangeFetchCalls: number;
}

export async function createIsolatedExchangeFixture(): Promise<IsolatedExchangeFixture> {
  const subject = await generateKeyPair("RS256");
  const exchange = await generateKeyPair("RS256");
  const config: ExchangeConfig = {
    issuer: TEST_ISSUER,
    apiAudience: TEST_API_AUDIENCE,
    mcpResource: TEST_RESOURCE,
    tokenEndpoint: TEST_TOKEN_ENDPOINT,
    workloadSub: TEST_WORKLOAD_SUB,
    workloadClientId: TEST_WORKLOAD_CLIENT,
    environment: "test-artefacts-mcp-a2",
    policyRevision: "p4-v1",
  };
  const issuedExchangedTokens: string[] = [];
  const state = { calls: 0 };
  const fetchImpl = (async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    if (url !== TEST_TOKEN_ENDPOINT) throw new Error(`unexpected exchange route: ${url}`);
    const expected = Buffer.from(`${encodeURIComponent(TEST_WORKLOAD_CLIENT)}:${encodeURIComponent(TEST_WORKLOAD_SECRET)}`).toString("base64");
    if (new Headers(init?.headers).get("authorization") !== `Basic ${expected}`) return new Response("{}", { status: 401 });
    state.calls += 1;
    const body = new URLSearchParams(String((init?.body as string | undefined) ?? ""));
    const subjectToken = body.get("subject_token") ?? "";
    const scope = body.get("scope") ?? "";
    const audience = body.get("audience") ?? "";
    const now = Math.floor(Date.now() / 1000);
    const decoded = decodeJwt(subjectToken) as Record<string, unknown>;
    const sub = typeof decoded["sub"] === "string" ? decoded["sub"] : "unknown";
    const subjectExp = typeof decoded["exp"] === "number" ? Math.floor(decoded["exp"] as number) : now + 300;
    const exp = Math.min(now + 60, subjectExp);
    const token = await new SignJWT({
      scope,
      client_id: TEST_WORKLOAD_CLIENT,
      act: { sub: TEST_WORKLOAD_SUB },
    })
      .setProtectedHeader({ alg: "RS256", typ: "at+jwt" })
      .setIssuer(TEST_ISSUER)
      .setSubject(sub)
      .setAudience(audience)
      .setIssuedAt(now)
      .setExpirationTime(exp)
      .setJti(`ex-${state.calls}`)
      .sign(exchange.privateKey as KeyLike);
    issuedExchangedTokens.push(token);
    return Response.json({
      access_token: token,
      token_type: "Bearer",
      expires_in: Math.max(1, exp - now),
      scope,
      issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
    });
  }) as unknown as typeof fetch;
  return {
    subjectPublicKey: subject.publicKey as KeyLike,
    subjectPrivateKey: subject.privateKey as KeyLike,
    exchangePublicKey: exchange.publicKey as KeyLike,
    exchangePrivateKey: exchange.privateKey as KeyLike,
    subjectKeySource: { resolveKey: async () => subject.publicKey as KeyLike },
    exchangeKeySource: { resolveKey: async () => exchange.publicKey as KeyLike },
    tokenEndpoint: TEST_TOKEN_ENDPOINT,
    config,
    issuedExchangedTokens,
    fetchImpl,
    exchangeFetchCalls: 0,
  };
}

export async function signSubjectToken(
  privateKey: KeyLike,
  opts: { sub?: string; scope?: string; audience?: string; jti?: string; expS?: number } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const builder = new SignJWT({
    scope: opts.scope ?? TEST_SCOPES,
    client_id: "immo-cli",
    tid: "radar",
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(TEST_ISSUER)
    .setSubject(opts.sub ?? "user-1")
    .setAudience(opts.audience ?? TEST_RESOURCE)
    .setIssuedAt(now);
  if (opts.jti) builder.setJti(opts.jti);
  builder.setExpirationTime(opts.expS ?? now + 300);
  return builder.sign(privateKey);
}

export function exchangeDepsFor(
  fixture: IsolatedExchangeFixture,
  overrides: Partial<ExchangeRuntimeDeps> = {},
): ExchangeRuntimeDeps {
  return {
    config: fixture.config,
    clientSecret: TEST_WORKLOAD_SECRET,
    fetchImpl: fixture.fetchImpl,
    keySource: fixture.exchangeKeySource,
    cache: new ExchangeCache({}),
    singleFlight: new SingleFlightExchange(),
    ...overrides,
  };
}
