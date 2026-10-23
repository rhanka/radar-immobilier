import { createHash } from "node:crypto";
import { decodeProtectedHeader, errors, jwtVerify } from "jose";
import { EXCHANGE_MAX_LIFETIME_S, EXCHANGE_REQUIRED_SCOPE } from "./exchange-config.js";
export interface ExchangeKeySource {
  resolveKey: (header: Record<string, unknown>) => Promise<unknown>;
}
export interface SubjectInfo {
  readonly sub: string;
  readonly exp: number;
  readonly scopes: readonly string[];
}
export interface ExchangeValidationConfig {
  readonly issuer: string;
  readonly apiAudience: string;
  readonly workloadSub: string;
  readonly workloadClientId: string;
  readonly requiredScope?: string | undefined;
  readonly maxLifetimeS?: number | undefined;
}
export interface ValidatedExchange {
  readonly token: string;
  readonly sub: string;
  readonly exp: number;
  readonly iat: number;
  readonly scopes: readonly string[];
  readonly tokenIdentity: string;
  readonly actSub: string;
  readonly clientId: string;
}
export function fingerprintToken(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 24);
}
function splitScopes(value: string): string[] {
  return value.split(/\s+/).map((s) => s.trim()).filter(Boolean);
}
function claimScopes(payload: Record<string, unknown>): string[] {
  const raw = payload["scope"];
  if (Array.isArray(raw) && raw.every((v) => typeof v === "string")) {
    return (raw as string[]).map((s) => s.trim()).filter(Boolean);
  }
  if (typeof raw === "string") return splitScopes(raw);
  const scp = payload["scp"];
  if (Array.isArray(scp) && scp.every((v) => typeof v === "string")) {
    return (scp as string[]).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}
function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
export async function validateExchangedToken(
  token: string,
  subject: SubjectInfo,
  config: ExchangeValidationConfig,
  keySource: ExchangeKeySource,
  nowS: number = Math.floor(Date.now() / 1000),
): Promise<ValidatedExchange> {
  const requiredScope = config.requiredScope ?? EXCHANGE_REQUIRED_SCOPE;
  const maxLifetimeS = config.maxLifetimeS ?? EXCHANGE_MAX_LIFETIME_S;
  let header: Record<string, unknown>;
  try {
    header = decodeProtectedHeader(token) as Record<string, unknown>;
  } catch {
    throw new Error("exchange_invalid_signature");
  }
  let key: unknown;
  try {
    key = await keySource.resolveKey(header);
  } catch {
    throw new Error("exchange_invalid_signature");
  }
  let payload: Record<string, unknown>;
  try {
    const verified = await jwtVerify(token, key as never, {
      issuer: config.issuer,
      audience: config.apiAudience,
      currentDate: new Date(nowS * 1000),
    });
    payload = verified.payload as unknown as Record<string, unknown>;
  } catch (err) {
    if (err instanceof errors.JWTClaimValidationFailed && err.claim === "aud") throw new Error("exchange_invalid_audience");
    if (err instanceof errors.JWTClaimValidationFailed && err.claim === "iss") throw new Error("exchange_invalid_issuer");
    if (err instanceof errors.JWTExpired) throw new Error("exchange_invalid_lifetime");
    throw new Error("exchange_invalid_signature");
  }
  if (payload["cnf"] !== undefined) throw new Error("exchange_proof_binding_refused");
  const tokenType = asString(payload["token_type"]) ?? asString(header["typ"]);
  if (tokenType !== undefined && tokenType.toLowerCase() !== "bearer" && tokenType.toLowerCase() !== "at+jwt" && tokenType.toLowerCase() !== "jwt") {
    throw new Error("exchange_invalid_token_type");
  }
  const aud = payload["aud"];
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (audiences.length !== 1 || audiences[0] !== config.apiAudience) {
    throw new Error("exchange_invalid_audience");
  }
  const sub = asString(payload["sub"]);
  if (!sub || sub !== subject.sub) throw new Error("exchange_invalid_subject");
  if (sub === config.workloadSub) throw new Error("exchange_service_user_refused");
  const act = payload["act"];
  const actSub =
    typeof act === "object" && act !== null ? asString((act as Record<string, unknown>)["sub"]) : undefined;
  if (actSub !== config.workloadSub) throw new Error("exchange_invalid_actor");
  const clientId = asString(payload["client_id"]);
  if (clientId !== config.workloadClientId) throw new Error("exchange_invalid_client");
  const scopes = claimScopes(payload);
  if (scopes.length !== 1 || scopes[0] !== requiredScope) throw new Error("exchange_scope_refused");
  for (const scope of scopes) {
    if (!subject.scopes.includes(scope)) throw new Error("exchange_scope_refused");
  }
  const exp = payload["exp"];
  const iat = payload["iat"];
  if (typeof exp !== "number" || typeof iat !== "number" || !Number.isFinite(exp) || !Number.isFinite(iat)) {
    throw new Error("exchange_invalid_lifetime");
  }
  const lifetime = Math.floor(exp) - Math.floor(iat);
  if (iat > nowS) throw new Error("exchange_invalid_lifetime");
  if (lifetime <= 0 || lifetime > maxLifetimeS) throw new Error("exchange_invalid_lifetime");
  if (Math.floor(exp) > Math.floor(subject.exp)) throw new Error("exchange_invalid_lifetime");
  if (Math.floor(exp) <= nowS) throw new Error("exchange_invalid_lifetime");
  const jti = asString(payload["jti"]) ?? fingerprintToken(token);
  return {
    token,
    sub,
    exp: Math.floor(exp),
    iat: Math.floor(iat),
    scopes: Object.freeze([...scopes]),
    tokenIdentity: jti,
    actSub: actSub ?? "",
    clientId: clientId ?? "",
  };
}
