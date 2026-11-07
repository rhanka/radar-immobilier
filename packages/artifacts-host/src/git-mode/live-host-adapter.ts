import * as liveHost from "@sentropic/artifacts/live-host";

/**
 * Single provider seam for everything the host executes or verifies on the
 * live/build path (architecture decision: one subpath,
 * `@sentropic/artifacts/live-host`, since 0.2.20): candidate digest, SG4b
 * handoff acceptance and receipt verification, live assertion and control
 * signing, host build API. immo implements none of this cryptography itself.
 *
 * The subpath is imported statically. Consumers still take the module as an
 * injected (partial) dependency so that a missing export keeps failing closed.
 */
export const LIVE_HOST_MODULE = "@sentropic/artifacts/live-host" as const;

/** Injected shape: any export may be absent (each consumer checks it at run time and fails closed). */
export type LiveHostModule = { readonly [K in keyof typeof liveHost]?: unknown };

/** The pinned provider live-host subpath. */
export async function loadLiveHost(): Promise<LiveHostModule | undefined> {
  return liveHost;
}
