import {
  EXCHANGE_GRANT_TYPE,
  EXCHANGE_MAX_RESPONSE_BYTES,
  EXCHANGE_REQUESTED_TOKEN_TYPE,
  EXCHANGE_SUBJECT_TOKEN_TYPE,
} from "./exchange-config.js";
import { readExchangeResponse } from "./exchange-response.js";

export interface TokenExchangeInput {
  /** Verified subject (incoming MCP) bearer. */
  readonly subjectToken: string;
  /** Requested delegated scope (exactly `immo:search`). */
  readonly scope: string;
  /** Exact API audience for the delegated token. */
  readonly audience: string;
  /** Confidential workload authentication; only sent to the trusted issuer. */
  readonly workload: { readonly clientId: string; readonly clientSecret: string };
}

export interface TokenExchangeResult {
  readonly accessToken: string;
  readonly tokenType: string;
  readonly expiresIn?: number | undefined;
  readonly scope?: string | undefined;
  readonly issuedTokenType?: string | undefined;
}

export interface ExchangeHttpOptions {
  readonly fetchImpl?: typeof fetch | undefined;
  readonly maxBytes?: number | undefined;
  readonly allowLoopbackHttp?: boolean;
}

/**
 * Perform one RFC 8693 token-exchange request. Exactly one HTTP call, no
 * retry, no redirect following, no broader-scope fallback.
 *
 * Refusals: `exchange_redirect_refused`, `exchange_response_too_large`,
 * `exchange_http_error:<status>`, `exchange_invalid_response`,
 * `exchange_refresh_token_refused`.
 */
export async function requestTokenExchange(
  tokenEndpoint: string,
  input: TokenExchangeInput,
  opts: ExchangeHttpOptions = {},
): Promise<TokenExchangeResult> {
  if (!input.subjectToken) throw new Error("exchange_missing_subject_token");
  if (!input.workload?.clientId || !input.workload.clientSecret) throw new Error("exchange_not_configured");
  let endpoint: URL;
  try { endpoint = new URL(tokenEndpoint); } catch { throw new Error("exchange_invalid_endpoint"); }
  const loopback = opts.allowLoopbackHttp === true && endpoint.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname);
  if ((endpoint.protocol !== "https:" && !loopback) || endpoint.username || endpoint.password) {
    throw new Error("exchange_invalid_endpoint");
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxBytes = opts.maxBytes ?? EXCHANGE_MAX_RESPONSE_BYTES;
  const body = new URLSearchParams({
    grant_type: EXCHANGE_GRANT_TYPE,
    subject_token: input.subjectToken,
    subject_token_type: EXCHANGE_SUBJECT_TOKEN_TYPE,
    audience: input.audience,
    scope: input.scope,
    requested_token_type: EXCHANGE_REQUESTED_TOKEN_TYPE,
  });
  const credentials = `${encodeURIComponent(input.workload.clientId)}:${encodeURIComponent(input.workload.clientSecret)}`;
  let res: Response;
  try {
    res = await fetchImpl(tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json",
        authorization: `Basic ${Buffer.from(credentials, "utf8").toString("base64")}` },
      body: body.toString(),
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/redirect/i.test(message)) throw new Error("exchange_redirect_refused");
    throw new Error("exchange_unavailable");
  }
  if (res.status === 301 || res.status === 302 || res.status === 303 || res.status === 307 || res.status === 308) {
    throw new Error("exchange_redirect_refused");
  }
  const text = await readExchangeResponse(res, maxBytes);
  if (!res.ok) throw new Error(`exchange_http_error:${res.status}`);
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("exchange_invalid_response");
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("exchange_invalid_response");
  }
  if (payload["refresh_token"] !== undefined) throw new Error("exchange_refresh_token_refused");
  if (payload["id_token"] !== undefined) throw new Error("exchange_refresh_token_refused");
  if (payload["issued_token_type"] !== EXCHANGE_REQUESTED_TOKEN_TYPE) throw new Error("exchange_invalid_token_type");
  const accessToken = payload["access_token"];
  const tokenType = payload["token_type"];
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new Error("exchange_invalid_response");
  }
  if (typeof tokenType !== "string" || tokenType.length === 0) {
    throw new Error("exchange_invalid_response");
  }
  const result: TokenExchangeResult = { accessToken, tokenType };
  const expiresIn = payload["expires_in"];
  if (expiresIn !== undefined && (typeof expiresIn !== "number" || !Number.isInteger(expiresIn) || expiresIn <= 0)) {
    throw new Error("exchange_invalid_response");
  }
  if (payload["scope"] !== undefined && typeof payload["scope"] !== "string") throw new Error("exchange_invalid_response");
  if (typeof expiresIn === "number" && Number.isFinite(expiresIn)) {
    return { ...result, expiresIn: Math.floor(expiresIn), scope: asScope(payload["scope"]), issuedTokenType: asScope(payload["issued_token_type"]) };
  }
  return { ...result, scope: asScope(payload["scope"]), issuedTokenType: asScope(payload["issued_token_type"]) };
}

function asScope(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
