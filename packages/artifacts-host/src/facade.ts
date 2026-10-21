import { isArtifactId } from "@sentropic/artifacts/contracts";
import { parseContentHost } from "@sentropic/artifacts/content/routing";
import type { HttpResponse } from "@sentropic/artifacts/http";
import { checkAdmission, type AdmissionAuthority } from "./admission.js";
import type { composeArtifactHost } from "./composition.js";
import { ArtifactConnectionError, computeParamsHash, deriveIdempotencyKey } from "./idempotency.js";
import { validateBindingName, validatePublishFiles } from "./publish-policy.js";
import { ArtifactS3TimeoutError } from "./s3-timeout.js";

export interface ArtifactControl {
  handle(op: string, actorId: string, body: unknown): Promise<HttpResponse>;
}

/**
 * Failure accounting for write dispatches (861C unit 7). Every refused or
 * failed commit is recorded with its cause; reads are never recorded.
 */
export type CommitFailureReason =
  | "unauthorized_at_commit"
  | "provider_conflict"
  | "provider_unavailable"
  | "provider_error";

export interface CommitFailureRecord {
  readonly op: string;
  readonly actorId: string;
  readonly reason: CommitFailureReason;
  readonly status: number;
  readonly atMs: number;
}

export interface CommitFailureLedger {
  record(entry: CommitFailureRecord): void;
}

export function createMemoryCommitLedger(): {
  readonly ledger: CommitFailureLedger; readonly entries: CommitFailureRecord[];
} {
  const entries: CommitFailureRecord[] = [];
  return { ledger: { record: (entry) => { entries.push(entry); } }, entries };
}

export interface ArtifactControlOptions {
  readonly ledger?: CommitFailureLedger | undefined;
  readonly nowMs?: (() => number) | undefined;
}
type Host = NonNullable<Awaited<ReturnType<typeof composeArtifactHost>>>;
const invalid = (): HttpResponse => ({ status: 400, body: { error: "invalid_request" } });

function filesForPublication(raw: unknown) {
  if (!Array.isArray(raw) || raw.length > 32) throw new Error("invalid files");
  const files = raw.map((entry: unknown) => {
    if (!entry || typeof entry !== "object") throw new Error("invalid file");
    const file = entry as Record<string, unknown>;
    if (typeof file.path !== "string" || typeof file.mimeType !== "string") throw new Error("invalid file");
    if (("text" in file) === ("bytes" in file)) throw new Error("invalid bytes");
    let bytes: number[];
    if ("text" in file) {
      if (typeof file.text !== "string") throw new Error("invalid text");
      bytes = Array.from(new TextEncoder().encode(file.text));
    } else {
      if (!Array.isArray(file.bytes) || !file.bytes.every((b: unknown) =>
        typeof b === "number" && Number.isInteger(b) && b >= 0 && b <= 255)) throw new Error("invalid bytes");
      bytes = file.bytes;
    }
    return { path: file.path, mimeType: file.mimeType, bytes };
  });
  if (validatePublishFiles(files.map((f) => ({
    path: f.path, mediaType: f.mimeType, sizeBytes: f.bytes.length,
  }))).length) throw new Error("invalid publication");
  return files;
}

export function createArtifactControl(
  host: Host,
  scope: string,
  contentBase: string,
  admission?: AdmissionAuthority | undefined,
  options?: ArtifactControlOptions | undefined,
): ArtifactControl {
  return {
    async handle(op, actorId, raw) {
      if (!["ensure", "publish", "meta", "list"].includes(op)) {
        return { status: 503, body: { error: "capability_unavailable" } };
      }
      if (admission) {
        const entry = await checkAdmission(admission, actorId);
        if (!entry.allowed) return { status: entry.status, body: entry.body };
      }
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid();
      const body = raw as Record<string, unknown>;
      if (body.storageScopeId !== undefined && body.storageScopeId !== scope) return invalid();
      const artifactId = body.artifactId;
      if ((op === "publish" || op === "meta") && !isArtifactId(artifactId)) return invalid();
      let stableUrl: string | undefined;
      if (op === "publish") {
        try {
          stableUrl = `https://${String(artifactId)}.${contentBase}/`;
          const stable = parseContentHost(new URL(stableUrl).host, contentBase);
          if (stable?.kind !== "stable" || stable.artifactId !== artifactId) return invalid();
        } catch { return invalid(); }
      }
      const write = op === "ensure" || op === "publish";
      if (write && (typeof body.idempotencyKey !== "string" || !body.idempotencyKey.trim() ||
        body.idempotencyKey.length > 256)) return invalid();
      let effective: Record<string, unknown>;
      try {
        if (op === "ensure") {
          if (typeof body.bindingName !== "string" || validateBindingName(body.bindingName).length) return invalid();
          effective = { bindingName: body.bindingName, storageScopeId: scope, parameters: body.parameters ?? {} };
        } else if (op === "publish") {
          if (body.profile !== undefined && (!body.profile || typeof body.profile !== "object" || Array.isArray(body.profile))) return invalid();
          effective = { artifactId, profile: body.profile ?? {}, files: filesForPublication(body.files),
            source: { kind: "inline-original" } };
        } else if (op === "meta") {
          effective = {};
        } else {
          effective = { limit: body.limit === undefined ? 20 : Number(body.limit),
            offset: body.offset === undefined ? 0 : Number(body.offset) };
        }
      } catch { return invalid(); }
      if (write) {
        effective.paramsHash = computeParamsHash(effective);
        effective.idempotencyKey = deriveIdempotencyKey({ scope, sub: actorId, op,
          artifactId: typeof artifactId === "string" && op === "publish" ? artifactId : "",
          clientKey: body.idempotencyKey as string });
      }
      if (write && admission) {
        // Reread immediately before dispatch; provider commits already in
        // flight require their own authorization enforcement.
        const commit = await checkAdmission(admission, actorId);
        if (!commit.allowed) return { status: commit.status, body: commit.body };
      }
      const clock = options?.nowMs ?? Date.now;
      const fail = (reason: CommitFailureReason, status: number): void => {
        if (write) options?.ledger?.record({ op, actorId, reason, status, atMs: clock() });
      };
      let response: HttpResponse;
      try {
        response = await host.app.handle({ actorId, body: effective,
          method: op === "meta" ? "GET" : "POST",
          path: op === "meta" ? `/meta/${String(artifactId)}` : `/${op}` });
      } catch (error) {
        // The provider was blocked on its lock, connection or S3: account
        // the failure with a typed status instead of an unhandled throw.
        const code = error !== null && typeof error === "object"
          ? (error as { code?: unknown }).code
          : undefined;
        if (error instanceof ArtifactConnectionError || error instanceof ArtifactS3TimeoutError ||
          code === "artifact_connection_lost" || code === "artifact_s3_timeout") {
          fail("provider_unavailable", 503);
          return { status: 503, body: { error: "capability_unavailable" } };
        }
        if (error instanceof Error && error.message.includes("artifact advisory lock timeout conflict")) {
          fail("provider_conflict", 409);
          return { status: 409, body: { error: "conflict" } };
        }
        fail("provider_error", 500);
        return { status: 500, body: { error: "provider_error" } };
      }
      if (write && admission && response.status >= 200 && response.status < 300) {
        // Post-settle authorization (861C unit 7): @sentropic/artifacts@0.1.2
        // offers no commit-time hook — its publication service, HTTP app and
        // Postgres store accept no authorization callback, and the advisory
        // lock only bounds the wait — so a success that settles after
        // revocation is refused to the caller and accounted here instead of
        // receipted. Prevention inside the provider transaction is unverified:
        // it needs a provider authorizeCommit callback run after lock
        // acquisition and before the release insert/S3 finalization.
        const after = await checkAdmission(admission, actorId);
        if (!after.allowed) {
          fail("unauthorized_at_commit", after.status);
          return { status: after.status, body: after.body };
        }
      } else if (write && response.status === 409) {
        fail("provider_conflict", 409);
      } else if (write && response.status >= 400) {
        fail("provider_error", response.status);
      }
      if (op !== "publish" || response.status !== 201) return response;
      const result = response.body as { releaseId: string; manifest: string };
      const manifest = JSON.parse(result.manifest) as { digest: string };
      const pinnedUrl = `https://${result.releaseId}.pinned.${contentBase}/`;
      const pinned = parseContentHost(new URL(pinnedUrl).host, contentBase);
      if (pinned?.kind !== "pinned" || pinned.releaseId !== result.releaseId) throw new Error("invalid content links");
      return { status: 201, body: { artifactId, releaseId: result.releaseId, digest: manifest.digest,
        stableUrl, pinnedUrl } };
    },
  };
}
