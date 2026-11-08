import { createLiveDraftVault, createLiveService, createPostgresLiveStore, type GitPort, type LiveInvitationPort, type LiveKeyPort, type LiveSessionService,
  type LiveStore, type LiveWorkerPort } from "@sentropic/artifacts";
import { ArtifactOperationError } from "@sentropic/artifacts/server/outcome-contract";
import type pg from "pg";
import { createLiveAuthorize, type LiveAuthorityDeps } from "./live-authority.js";
import type { LiveWorkerFences } from "./live-grant.js";
import type { LiveDraftSource } from "./live-draft-stager.js";

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

export interface ComposeLiveInput extends Omit<LiveAuthorityDeps, "qualified" | "invitations"> {
  readonly pool: pg.Pool;
  readonly git: GitPort;
  readonly store?: LiveStore;
  readonly keys?: LiveKeyPort;
  readonly worker?: LiveWorkerPort;
  readonly qualified?: () => boolean;
  /** Package invitations host port (0.2.22); absent or not qualified: live stays owner-only. */
  readonly invitations?: LiveInvitationPort;
  /**
   * Receives the composed service so the controller worker can read
   * `liveInvitationState(identity)` for its reconcile body (the worker is built first).
   */
  readonly onService?: (service: LiveSessionService) => void;
}

/** Fences of the current live session read from the package store (sent to the controller on reconcile). */
export function liveStoreFences(store: LiveStore): LiveWorkerFences {
  return {
    async current(identity) {
      const runtime = await store.transaction(identity, async (tx) => tx.record?.runtime ?? undefined);
      return runtime ? { ownerId: runtime.ownerId, liveSessionId: runtime.liveSessionId, leaseEpoch: runtime.leaseEpoch, routeEpoch: runtime.routeEpoch } : undefined;
    },
  };
}

/** Current durable draft (revision, base head, live tree, decrypted overlay) of the package store, staged before reconcile. */
export function liveStoreDrafts(store: LiveStore, keys: LiveKeyPort): LiveDraftSource {
  const vault = createLiveDraftVault({ store, keys });
  return {
    async current(identity) {
      const draft = await vault.read(identity);
      return draft ? { revision: draft.revision, baseHeadSha: draft.baseHeadSha, liveTreeSha: draft.liveTreeSha, overlay: draft.overlay } : undefined;
    },
  };
}

export function composeLiveService(input: ComposeLiveInput): LiveSessionService {
  const { pool, git, store, keys, worker, qualified, invitations, onService, ...authority } = input;
  const service: LiveSessionService = createLiveService({ store: store ?? createPostgresLiveStore(pool), keys: keys ?? FAIL_CLOSED_LIVE_KEYS, git,
    authorize: createLiveAuthorize({ ...authority, qualified: qualified ?? (() => false),
      ...(invitations ? { invitations: { qualified: () => invitations.qualified === true,
        viewer: (identity, principalId) => service.liveViewer(identity, principalId) } } : {}) }),
    ...(worker ? { worker } : {}), ...(invitations ? { invitations } : {}) });
  onService?.(service);
  return service;
}

const refused = async (): Promise<never> => { throw new ArtifactOperationError("access_denied"); };

/**
 * Read-only views of the package invitation state for the radar-api content
 * host (`liveViewer`, `liveInvitationState`): a package live service whose
 * every operation is refused (authorize denies, no keys, no git). Not qualified:
 * no invitee is ever reported and the epoch is 0 (owner-only).
 */
export function createLiveInvitationViews(input: { readonly pool: pg.Pool; readonly store?: LiveStore;
  readonly qualified: boolean }): Pick<LiveSessionService, "liveViewer" | "liveInvitationState"> {
  const service = createLiveService({ store: input.store ?? createPostgresLiveStore(input.pool), keys: FAIL_CLOSED_LIVE_KEYS,
    git: FAIL_CLOSED_VIEW_GIT, authorize: refused,
    invitations: { qualified: input.qualified, resolvePrincipal: async () => undefined, describePrincipal: async () => undefined,
      onRevoked: async () => undefined } });
  return { liveViewer: (identity, principalId) => service.liveViewer(identity, principalId),
    liveInvitationState: (identity) => service.liveInvitationState(identity) };
}
const FAIL_CLOSED_VIEW_GIT = Object.freeze({
  async resolveRef() { return refused(); }, async inspectCommit() { return refused(); }, async read() { return refused(); },
  async commit() { return refused(); }, async isAncestor() { return refused(); }, async createBranch() { return refused(); },
}) as unknown as GitPort;
