import type { GitBinding } from "@sentropic/artifacts";
import type { ArtifactBuildReceipt } from "@sentropic/artifacts/server/build-contract";
import { ArtifactOperationError } from "@sentropic/artifacts/server/outcome-contract";

/**
 * SG4b two-step publication handoff, host side (M3-I, D0).
 *
 * Verification and receipt signing are NOT implemented here: they come from
 * `@sentropic/artifacts/live-host` (0.2.20, live-host-adapter.ts) and fail
 * closed until the pin wires them. immo owns the orchestration and the
 * single immo transaction.
 *
 * 1. The builder seals the candidate and its receipt under a single-use
 *    supervisor authorization (10-minute lifetime), signed with the builder
 *    handoff key.
 * 2. immo verifies the handoff here, then commits release, git release
 *    index, receipt and publication baseline in ONE immo transaction
 *    (HandoffCommitPort), consuming the authorization in the same
 *    transaction, and returns a host-signed receipt.
 * 3. The builder records that receipt idempotently; a replay of the same
 *    authorization returns the same signed receipt, never a second release.
 */
export const HANDOFF_MAX_LIFETIME_MS = 10 * 60 * 1000;

export interface HandoffManifestFile { readonly path: string; readonly mimeType: string; readonly size: number; readonly digest: string }

export interface BuildHandoff {
  readonly authorizationId: string;
  readonly jobId: string;
  readonly storageScopeId: string;
  readonly artifactId: string;
  readonly bindingGeneration: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly candidateDigest: string;
  readonly receipt: ArtifactBuildReceipt;
  readonly manifest: { readonly files: readonly HandoffManifestFile[] };
  /** base64 Ed25519 signature over canonicalJson(handoff without signature). */
  readonly signature: string;
}

export interface VerifiedHandoff { readonly handoff: Omit<BuildHandoff, "signature">; readonly binding: GitBinding }

export interface HostReceipt {
  readonly authorizationId: string; readonly jobId: string; readonly releaseId: string;
  readonly candidateDigest: string; readonly committedAt: string;
}

/**
 * One immo transaction: consume the authorization, write release + git
 * release index + receipt + baseline. Returns the committed receipt, or the
 * original one when the authorization was already consumed (idempotent).
 */
export interface HandoffCommitPort {
  commit(verified: VerifiedHandoff): Promise<{ receipt: HostReceipt; replayed: boolean }>;
}

/**
 * TODO(0.2.19 / M3-B): compose with the provider publication unit writer and
 * `artifacts.git_release_index` inside the release transaction, plus a durable
 * single-use authorization ledger. Until then acceptance refuses.
 */
export const FAIL_CLOSED_HANDOFF_COMMIT: HandoffCommitPort = Object.freeze({
  async commit(): Promise<never> { throw new ArtifactOperationError("provider_unavailable"); },
});

/** Provider verification (live-host acceptHandoff): throws `verification_failed` on any refusal. */
export type HandoffVerifier = (input: unknown, context: { readonly binding: GitBinding | undefined; readonly now: number })
  => VerifiedHandoff | Promise<VerifiedHandoff>;
/** Provider host-receipt signer bound to the host receipt key. */
export type HostReceiptSigner = (receipt: HostReceipt) => string;

export const FAIL_CLOSED_HANDOFF_VERIFIER: HandoffVerifier = () => { throw new ArtifactOperationError("provider_unavailable"); };
export const FAIL_CLOSED_RECEIPT_SIGNER: HostReceiptSigner = () => { throw new ArtifactOperationError("provider_unavailable"); };

export interface HandoffAcceptanceDeps {
  /** TODO(0.2.20): live-host acceptHandoff. Absent: acceptance refuses. */
  readonly verify?: HandoffVerifier;
  /** TODO(0.2.20): live-host receipt signer. Absent: acceptance refuses. */
  readonly signReceipt?: HostReceiptSigner;
  readonly binding: (storageScopeId: string, artifactId: string) => Promise<GitBinding | undefined>;
  readonly commit?: HandoffCommitPort;
  readonly now?: () => number;
}

export function createHandoffAcceptance(deps: HandoffAcceptanceDeps) {
  const commit = deps.commit ?? FAIL_CLOSED_HANDOFF_COMMIT;
  const verifyHandoff = deps.verify ?? FAIL_CLOSED_HANDOFF_VERIFIER;
  const signReceipt = deps.signReceipt ?? FAIL_CLOSED_RECEIPT_SIGNER;
  const now = deps.now ?? Date.now;
  return {
    async accept(input: unknown): Promise<{ receipt: HostReceipt; signature: string; replayed: boolean }> {
      // Both provider ports must exist before anything is verified or committed.
      if (!deps.verify || !deps.signReceipt) throw new ArtifactOperationError("provider_unavailable");
      const claimed = input as Partial<BuildHandoff> | null;
      const binding = claimed && typeof claimed.storageScopeId === "string" && typeof claimed.artifactId === "string"
        ? await deps.binding(claimed.storageScopeId, claimed.artifactId) : undefined;
      const verified = await verifyHandoff(input, { binding, now: now() });
      const { receipt, replayed } = await commit.commit(verified);
      return { receipt, replayed, signature: signReceipt(receipt) };
    },
  };
}
