import { createHash, verify, type KeyObject } from "node:crypto";
import type { GitBinding } from "@sentropic/artifacts";
import { ArtifactOperationError } from "@sentropic/artifacts/server/outcome-contract";
import { RELEASE_FILE_BYTES_MAX, RELEASE_FILES_MAX, RELEASE_TOTAL_BYTES_MAX } from "../p0b-profile.js";
import { HANDOFF_MAX_LIFETIME_MS, type BuildHandoff, type HandoffManifestFile, type VerifiedHandoff } from "./handoff.js";

/**
 * TEST SUPPORT ONLY. Contract reference of the SG4b host-side checks that the
 * provider `live-host` acceptHandoff must enforce (signature, 10-minute
 * single-use authorization, job/commit/generation, 255 files / 16 MiB /
 * 64 MiB, candidate digest). The host never runs this code: production
 * verification is imported from `@sentropic/artifacts/live-host` (0.2.20).
 * TODO(0.2.20): run build.test.ts cases against the provider acceptHandoff
 * and delete this file.
 */
const CLOCK_SKEW_MS = 30 * 1000;

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

