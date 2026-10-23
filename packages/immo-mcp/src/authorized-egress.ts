import { AsyncLocalStorage } from "node:async_hooks";
import { assertScope, IMMO_SCOPES } from "./auth-context.js";
import type { DataSourceCallContext } from "./data-source.js";
import { EXCHANGE_REQUIRED_SCOPE, type ExchangeConfig } from "./exchange-config.js";
import { requestTokenExchange } from "./exchange-client.js";
import { fingerprintToken, validateExchangedToken, type ExchangeKeySource } from "./exchange-token.js";
import { buildCacheKey, ExchangeCache, SingleFlightExchange } from "./exchange-cache.js";
import type { InvocationContext } from "./invocation-context.js";
export const EXCHANGE_TOOL_NAME = "search_signals";
export interface ExchangeInput {
  readonly subjectToken: string;
  readonly subjectSub: string;
  readonly subjectExp: number;
  readonly subjectScopes: readonly string[];
  readonly subjectIdentity: string;
  readonly subjectClientId: string;
  readonly issuer: string;
  readonly membership: string;
  readonly confirmation: string;
}
export interface ExchangeRuntimeDeps {
  readonly config: ExchangeConfig;
  readonly clientSecret: string;
  readonly allowLoopbackHttp?: boolean;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly keySource: ExchangeKeySource;
  readonly cache?: ExchangeCache | undefined;
  readonly singleFlight?: SingleFlightExchange | undefined;
  readonly clockMs?: (() => number) | undefined;
}
const inputByContext = new WeakMap<object, ExchangeInput>();
const depsStorage = new AsyncLocalStorage<ExchangeRuntimeDeps>();
const defaults = new WeakMap<ExchangeRuntimeDeps, { cache: ExchangeCache; flight: SingleFlightExchange }>();
const egressByContext = new WeakMap<object, { cache: ExchangeCache; key: string; token: string }>();
export function bindExchangeInput(ctx: object, input: ExchangeInput): void {
  inputByContext.set(ctx, Object.freeze({ ...input, subjectScopes: Object.freeze([...input.subjectScopes]) }));
}
export function runWithExchangeDeps<T>(deps: ExchangeRuntimeDeps, fn: () => T): T {
  return depsStorage.run(deps, fn);
}
export function getExchangeDeps(): ExchangeRuntimeDeps | undefined {
  return depsStorage.getStore();
}
function defaultState(deps: ExchangeRuntimeDeps) {
  let state = defaults.get(deps);
  if (!state) { state = { cache: new ExchangeCache(), flight: new SingleFlightExchange() }; defaults.set(deps, state); }
  return state;
}
export function invalidateExchangedCallContext(ctx: InvocationContext, token: string | undefined): void {
  const entry = egressByContext.get(ctx);
  if (entry && entry.token === token && entry.cache.getIfFresh(entry.key)?.validated.token === token) {
    entry.cache.invalidate(entry.key);
  }
}
export async function resolveExchangedCallContext(
  ctx: InvocationContext,
  toolName: string,
): Promise<DataSourceCallContext> {
  if (toolName !== EXCHANGE_TOOL_NAME) return {};
  assertScope(ctx.auth, IMMO_SCOPES.search);
  const input = inputByContext.get(ctx);
  if (!input) return {};
  const deps = getExchangeDeps();
  if (!deps) throw new Error("exchange_not_configured");
  if (input.confirmation !== "none") throw new Error("exchange_proof_binding_refused");
  if (input.subjectSub === deps.config.workloadSub) {
    throw new Error("exchange_service_user_refused");
  }
  const effectiveScopes = EXCHANGE_REQUIRED_SCOPE;
  if (!input.subjectScopes.includes(EXCHANGE_REQUIRED_SCOPE)) {
    throw new Error("scope_denied:immo:search");
  }
  const key = buildCacheKey({
    issuer: deps.config.issuer,
    subjectIdentity: input.subjectIdentity,
    human: input.subjectSub,
    client: JSON.stringify([input.subjectClientId, deps.config.workloadClientId]),
    workloadSub: deps.config.workloadSub,
    environment: deps.config.environment,
    membership: input.membership,
    target: deps.config.apiAudience,
    effectiveScopes,
    confirmation: input.confirmation,
    policyRevision: deps.config.policyRevision,
  });
  const clockMs = deps.clockMs ?? (() => Date.now());
  const cache = deps.cache ?? defaultState(deps).cache;
  const flight = deps.singleFlight ?? defaultState(deps).flight;
  const fresh = cache.getIfFresh(key, clockMs());
  if (fresh) {
    egressByContext.set(ctx, { cache, key, token: fresh.validated.token });
    return { accessToken: fresh.validated.token };
  }
  const validated = await flight.getOrExchange(key, async () => {
    const doubleChecked = cache.getIfFresh(key, clockMs());
    if (doubleChecked) return doubleChecked.validated;
    const response = await requestTokenExchange(
      deps.config.tokenEndpoint,
      { subjectToken: input.subjectToken, scope: effectiveScopes, audience: deps.config.apiAudience,
        workload: { clientId: deps.config.workloadClientId, clientSecret: deps.clientSecret } },
      { fetchImpl: deps.fetchImpl, allowLoopbackHttp: deps.allowLoopbackHttp === true },
    );
    if (response.tokenType.toLowerCase() !== "bearer") {
      throw new Error("exchange_invalid_token_type");
    }
    if (response.issuedTokenType !== "urn:ietf:params:oauth:token-type:access_token") {
      throw new Error("exchange_invalid_token_type");
    }
    if (response.scope !== undefined && response.scope.split(/\s+/).filter(Boolean).join(" ") !== effectiveScopes) throw new Error("exchange_scope_refused");
    const subjectExp = Math.floor(input.subjectExp);
    const checked = await validateExchangedToken(
      response.accessToken,
      { sub: input.subjectSub, exp: subjectExp, scopes: input.subjectScopes },
      {
        issuer: deps.config.issuer,
        apiAudience: deps.config.apiAudience,
        workloadSub: deps.config.workloadSub,
        workloadClientId: deps.config.workloadClientId,
        requiredScope: EXCHANGE_REQUIRED_SCOPE,
      },
      deps.keySource,
      Math.floor(clockMs() / 1000),
    );
    cache.store(key, checked, subjectExp, clockMs());
    return checked;
  });
  egressByContext.set(ctx, { cache, key, token: validated.token });
  return { accessToken: validated.token };
}
export function buildExchangeInput(opts: {
  subjectToken: string;
  subjectSub: string;
  subjectExp: number;
  subjectScopes: readonly string[];
  subjectJti?: string | undefined;
  subjectClientId?: string | undefined;
  issuer: string;
  membership: string;
  confirmation?: string | undefined;
}): ExchangeInput {
  return {
    subjectToken: opts.subjectToken,
    subjectSub: opts.subjectSub,
    subjectExp: Math.floor(opts.subjectExp),
    subjectScopes: Object.freeze([...opts.subjectScopes]),
    subjectIdentity: JSON.stringify([opts.subjectJti ?? null, fingerprintToken(opts.subjectToken)]),
    subjectClientId: opts.subjectClientId ?? "unknown-client",
    issuer: opts.issuer,
    membership: opts.membership,
    confirmation: opts.confirmation ?? "none",
  };
}
