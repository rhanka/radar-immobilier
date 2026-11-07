import { createHash, sign, verify, type KeyObject } from "node:crypto";
import type { GitBinding } from "@sentropic/artifacts";
import type { ArtifactBuildReceipt } from "@sentropic/artifacts/server/build-contract";
import { ArtifactOperationError } from "@sentropic/artifacts/server/outcome-contract";
import { RELEASE_FILE_BYTES_MAX, RELEASE_FILES_MAX, RELEASE_TOTAL_BYTES_MAX } from "../p0b-profile.js";

/**
 * SG4b two-step publication handoff, host side (M3-I, D0).
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
const CLOCK_SKEW_MS = 30 * 1000;

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

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Candidate digest = sha256 over the canonical manifest, files sorted by path. */
export function candidateDigestOf(files: readonly HandoffManifestFile[]): string {
  const sorted = [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
    .map(({ path, mimeType, size, digest }) => ({ path, mimeType, size, digest }));
  return `sha256:${createHash("sha256").update(canonicalJson(sorted)).digest("hex")}`;
}

const refuse = (detail: string): never => {
  throw new ArtifactOperationError("verification_failed", { publicDetails: { handoff: detail } });
};

export function verifyBuildHandoff(input: unknown, context: {
  readonly builderPublicKey: KeyObject; readonly binding: GitBinding | undefined; readonly now: number;
}): VerifiedHandoff {
  if (!input || typeof input !== "object" || Array.isArray(input)) return refuse("shape");
  const { signature, ...unsigned } = input as BuildHandoff;
  const handoff = unsigned as Omit<BuildHandoff, "signature">;
  const files = handoff.manifest?.files;
  if (typeof signature !== "string" || typeof handoff.authorizationId !== "string" || !handoff.authorizationId ||
    typeof handoff.jobId !== "string" || !handoff.jobId || !Array.isArray(files) || !handoff.receipt?.tuple) return refuse("shape");
  if (!verify(null, Buffer.from(canonicalJson(handoff)), context.builderPublicKey, Buffer.from(signature, "base64"))) {
    return refuse("signature");
  }
  const issued = Date.parse(handoff.issuedAt);
  const expires = Date.parse(handoff.expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || expires <= issued ||
    expires - issued > HANDOFF_MAX_LIFETIME_MS) return refuse("lifetime");
  if (context.now < issued - CLOCK_SKEW_MS || context.now >= expires) return refuse("expired");
  const binding = context.binding;
  if (!binding || binding.storageScopeId !== handoff.storageScopeId || binding.artifactId !== handoff.artifactId ||
    binding.generation !== handoff.bindingGeneration || binding.pendingJobId !== handoff.jobId ||
    binding.pendingCommitSha !== handoff.receipt.tuple.commitSha || binding.executor !== "sandbox") return refuse("job");
  const receipt = handoff.receipt;
  if (receipt.jobId !== handoff.jobId || receipt.candidateDigest !== handoff.candidateDigest ||
    receipt.executor !== "sandbox" || receipt.verification !== "builder-attested") return refuse("receipt");
  if (files.length === 0 || files.length > RELEASE_FILES_MAX) return refuse("file_count");
  let total = 0;
  const paths = new Set<string>();
  for (const file of files) {
    if (!file || typeof file.path !== "string" || !file.path || paths.has(file.path) || typeof file.mimeType !== "string" ||
      !Number.isSafeInteger(file.size) || file.size < 0 || typeof file.digest !== "string") return refuse("file");
    if (file.size > RELEASE_FILE_BYTES_MAX) return refuse("file_bytes");
    paths.add(file.path);
    total += file.size;
  }
  if (total > RELEASE_TOTAL_BYTES_MAX) return refuse("release_bytes");
  if (candidateDigestOf(files) !== handoff.candidateDigest) return refuse("candidate_digest");
  return { handoff, binding };
}

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

export interface HandoffAcceptanceDeps {
  readonly builderPublicKey: KeyObject;
  readonly hostReceiptKey: KeyObject;
  readonly binding: (storageScopeId: string, artifactId: string) => Promise<GitBinding | undefined>;
  readonly commit?: HandoffCommitPort;
  readonly now?: () => number;
}

export function createHandoffAcceptance(deps: HandoffAcceptanceDeps) {
  const commit = deps.commit ?? FAIL_CLOSED_HANDOFF_COMMIT;
  const now = deps.now ?? Date.now;
  return {
    async accept(input: unknown): Promise<{ receipt: HostReceipt; signature: string; replayed: boolean }> {
      const claimed = input as Partial<BuildHandoff> | null;
      const binding = claimed && typeof claimed.storageScopeId === "string" && typeof claimed.artifactId === "string"
        ? await deps.binding(claimed.storageScopeId, claimed.artifactId) : undefined;
      const verified = verifyBuildHandoff(input, { builderPublicKey: deps.builderPublicKey, binding, now: now() });
      const { receipt, replayed } = await commit.commit(verified);
      return { receipt, replayed, signature: sign(null, Buffer.from(canonicalJson(receipt)), deps.hostReceiptKey).toString("base64") };
    },
  };
}
