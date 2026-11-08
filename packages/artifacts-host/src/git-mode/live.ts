import { createLiveService, createPostgresLiveStore, type GitPort, type LiveKeyPort, type LiveService, type LiveStore, type LiveWorkerPort } from "@sentropic/artifacts";
import { ArtifactOperationError } from "@sentropic/artifacts/server/outcome-contract";
import type pg from "pg";
import { createLiveAuthorize, type LiveAuthorityDeps } from "./live-authority.js";
import type { LiveWorkerFences } from "./live-grant.js";

/**
 * M4-I live composition (stubs, fail-closed).
 *
 * - Draft keys: TODO(M4-I) envelope keys from the KMS or a sealed secret,
 *   minted through the documented rotation cycle. Until then every draft
 *   encryption refuses (`provider_unavailable`), so no draft is stored.
 * - Worker: the HTTP LiveWorkerPort of the Sentropic controller
 *   (live-grant.ts, `v1/live/reconcile` and `v1/live/stop`), composed only
 *   with IMMO_ARTIFACTS_LIVE_EDGE_ENABLED=1 on top of stage `live`.
 *   Absent: live_write and live_control(start) answer `builder_unavailable`.
 * - Qualification: false until the M4-lite acceptance (GB4-P go, W2
 *   baseline and revocation qualified).
 */
export const FAIL_CLOSED_LIVE_KEYS: LiveKeyPort = Object.freeze({
  async current(): Promise<never> { throw new ArtifactOperationError("provider_unavailable"); },
  async resolve(): Promise<never> { throw new ArtifactOperationError("provider_unavailable"); },
});

export interface ComposeLiveInput extends Omit<LiveAuthorityDeps, "qualified"> {
  readonly pool: pg.Pool;
  readonly git: GitPort;
  readonly store?: LiveStore;
  readonly keys?: LiveKeyPort;
  readonly worker?: LiveWorkerPort;
  readonly qualified?: () => boolean;
}

/** Fences of the current live session read from the package store (sent to the controller on reconcile). */
export function liveStoreFences(store: LiveStore): LiveWorkerFences {
  return {
    async current(identity) {
      const runtime = await store.transaction(identity, async (tx) => tx.record?.runtime ?? undefined);
      return runtime ? { liveSessionId: runtime.liveSessionId, leaseEpoch: runtime.leaseEpoch, routeEpoch: runtime.routeEpoch } : undefined;
    },
  };
}

export function composeLiveService(input: ComposeLiveInput): LiveService {
  const { pool, git, store, keys, worker, qualified, ...authority } = input;
  return createLiveService({ store: store ?? createPostgresLiveStore(pool), keys: keys ?? FAIL_CLOSED_LIVE_KEYS, git,
    authorize: createLiveAuthorize({ ...authority, qualified: qualified ?? (() => false) }),
    ...(worker ? { worker } : {}) });
}
