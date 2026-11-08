import type { DirectoryPerson, LiveInvitationPort, LiveInvitationRevoked, PrincipalDirectoryPort } from "@sentropic/artifacts";
import type { LiveFencePush, LiveSocketRegistry } from "./live-edge.js";

/**
 * Host invitations port of @sentropic/artifacts 0.2.22 (A-LIVE v2 §8.2, §9).
 *
 * - `qualified` comes from `GitModeConfig.liveInvitationsQualified`
 *   (IMMO_ARTIFACTS_LIVE_INVITATIONS_QUALIFIED=true, default false): while false
 *   every invitation tool refuses `builder_unavailable` and live stays owner-only.
 * - `resolvePrincipal` / `describePrincipal` use the existing immo people
 *   directory (the one behind artifacts_lookup_people). Fail closed: an
 *   unknown userRef, or any directory error, resolves to nothing, which the
 *   package turns into `access_denied`.
 * - `onRevoked` closes the tracked proxied sockets of the invitation FIRST,
 *   then pushes `revoke_invitation` carrying the NEW session epoch to the live
 *   control, retried until 204 (bounded; a final failure is thrown and the
 *   package re-invokes this idempotent handler when the revoke is replayed).
 */
export function createInvitationDirectory(directory: Pick<PrincipalDirectoryPort, "resolvePrincipal" | "describePrincipal">):
  Pick<LiveInvitationPort, "resolvePrincipal" | "describePrincipal"> {
  return {
    async resolvePrincipal(storageScopeId, userRef) {
      try { return (await directory.resolvePrincipal(storageScopeId, userRef)) || undefined; } catch { return undefined; }
    },
    async describePrincipal(storageScopeId, principalId): Promise<DirectoryPerson | undefined> {
      try {
        const person = await directory.describePrincipal(storageScopeId, principalId);
        // The email never leaves the host: only the opaque userRef and the display name are projected.
        return person ? { userRef: person.userRef, displayName: person.displayName, email: "" } : undefined;
      } catch { return undefined; }
    },
  };
}

export interface InvitationRevokerDeps {
  readonly sockets: Pick<LiveSocketRegistry, "closeInvitation">;
  readonly push: LiveFencePush;
  /** Cached controller grants dropped with the sockets (live-grant.ts). */
  readonly grants?: { invalidateInvitation(artifactId: string, invitationId: string): void } | undefined;
  /** Outer attempts on top of the pusher's own (default 5). */
  readonly attempts?: number;
  readonly backoffMs?: (attempt: number) => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export function createInvitationRevoker(deps: InvitationRevokerDeps): (event: LiveInvitationRevoked) => Promise<void> {
  const attempts = deps.attempts ?? 5;
  const backoff = deps.backoffMs ?? ((attempt: number) => 250 * 2 ** attempt);
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  return async (event) => {
    // 1. Sockets first (synchronous), then the cached grants of the invitation.
    deps.sockets.closeInvitation(event.artifactId, event.invitationId);
    deps.grants?.invalidateInvitation(event.artifactId, event.invitationId);
    // 2. Control push carrying the NEW session epoch, retried until it answers 204.
    let failure: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) await sleep(backoff(attempt - 1));
      try {
        await deps.push({ artifactId: event.artifactId, op: "revoke_invitation", sessionId: "",
          invitationId: event.invitationId, epoch: event.epoch });
        return;
      } catch (error) { failure = error; }
    }
    throw failure;
  };
}

export function createLiveInvitationPort(input: {
  readonly qualified: boolean;
  readonly directory: Pick<PrincipalDirectoryPort, "resolvePrincipal" | "describePrincipal">;
  readonly revoker: (event: LiveInvitationRevoked) => Promise<void>;
}): LiveInvitationPort {
  return { qualified: input.qualified, ...createInvitationDirectory(input.directory), onRevoked: input.revoker };
}
