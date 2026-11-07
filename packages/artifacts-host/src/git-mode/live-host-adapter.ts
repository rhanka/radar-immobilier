/**
 * Single provider seam for everything the host executes or verifies on the
 * live/build path (architecture decision: one subpath,
 * `@sentropic/artifacts/live-host`, shipping as 0.2.20): candidate digest,
 * SG4b handoff acceptance and receipt verification, live assertion and
 * control signing, host build API types. immo implements none of this
 * cryptography itself.
 *
 * TODO(0.2.20): replace the dynamic lookup by static imports from
 * `@sentropic/artifacts/live-host` in the pin commit, and map the exact
 * export names below if they differ. Until then every consumer fails closed.
 */
export const LIVE_HOST_MODULE = "@sentropic/artifacts/live-host" as const;

export interface LiveHostModule {
  readonly signLiveAssertion?: unknown;
  readonly signLiveControl?: unknown;
  readonly acceptHandoff?: unknown;
  readonly verifyReceipt?: unknown;
  readonly candidateDigest?: unknown;
}

/** Undefined while the pinned provider does not export the subpath (0.2.18). */
export async function loadLiveHost(): Promise<LiveHostModule | undefined> {
  const specifier: string = LIVE_HOST_MODULE;
  try { return await import(specifier) as LiveHostModule; } catch { return undefined; }
}
