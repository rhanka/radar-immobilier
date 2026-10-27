import { AsyncLocalStorage } from "node:async_hooks";
import type { ImmoMcpAuthContext } from "./auth-context.js";
import type { DataSourceCallContext, ImmoDataSource } from "./data-source.js";
import type { RawDataSource } from "./raw-data.js";

/**
 * Prepared authorized egress for a single tool invocation.
 *
 * P4 keeps the subject credential in the private exchange boundary
 * (`authorized-egress.ts`) and never copies it here. `bearer` carries only
 * an already-exchanged delegated token when a resolver has produced one;
 * at capture it is always `undefined` (public tools and stubs stay
 * credential-free). Handlers must only consume this snapshot, never a
 * mutable holder.
 */
export interface AuthorizedEgress {
  readonly bearer: string | undefined;
  readonly scopes: readonly string[];
  readonly sub: string;
}

/** Seeds captured once at request entry (verified claims + shared seams). */
export interface InvocationSeeds {
  readonly auth: ImmoMcpAuthContext;
  readonly data: ImmoDataSource;
  readonly raw: RawDataSource;
}

/**
 * Immutable per-call context shared by the SDK registrar and the future
 * cluster-mesh bridge. `auth` and `egress` are frozen snapshots: concurrent
 * invocations on one session cannot observe each other's rebinding.
 * `data`/`raw` stay shared stateless seams; identity travels in `auth`/`egress`.
 */
export interface InvocationContext {
  readonly auth: InvocationAuth;
  readonly data: ImmoDataSource;
  readonly raw: RawDataSource;
  readonly egress: AuthorizedEgress;
}

export type InvocationAuth = Readonly<Omit<ImmoMcpAuthContext, "accessToken" | "scopes" | "roles" | "workspaces">> & {
  readonly scopes: readonly string[];
  readonly roles: readonly string[];
  readonly workspaces: readonly string[];
};

/** Freeze one verified request into an immutable invocation context. */
export function captureInvocationContext(seeds: InvocationSeeds): InvocationContext {
  const { accessToken: _droppedSubjectBearer, ...rest } = seeds.auth;
  void _droppedSubjectBearer;
  const auth: InvocationAuth = {
    ...rest,
    scopes: Object.freeze([...seeds.auth.scopes]),
    roles: [...seeds.auth.roles],
    workspaces: [...seeds.auth.workspaces],
  };
  Object.freeze(auth.scopes);
  Object.freeze(auth.roles);
  Object.freeze(auth.workspaces);
  Object.freeze(auth);
  const snapshot: AuthorizedEgress = Object.freeze({
    bearer: undefined,
    scopes: Object.freeze([...seeds.auth.scopes]),
    sub: seeds.auth.sub,
  });
  return Object.freeze({ auth, data: seeds.data, raw: seeds.raw, egress: snapshot });
}

/**
 * Per-call caller identity for tools without delegated egress (public tools
 * and stubs). Always empty: only `resolveExchangedCallContext` may supply
 * an exchanged token, and only for `search_signals`.
 */
export function authorizedCallContext(_ctx: InvocationContext): DataSourceCallContext {
  return {};
}

const storage = new AsyncLocalStorage<InvocationContext>();

/** Run `fn` with `ctx` as the ambient invocation (isolated per request). */
export function runWithInvocationContext<T>(ctx: InvocationContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** Ambient immutable invocation for the running handler, if any. */
export function getInvocationContext(): InvocationContext | undefined {
  return storage.getStore();
}
