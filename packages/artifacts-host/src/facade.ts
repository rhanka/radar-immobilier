import { AsyncLocalStorage } from "node:async_hooks";
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
  | "admission_unavailable"
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
  readonly ledger?: CommitFailureLedger;
  readonly nowMs?: () => number;
}

type Host = NonNullable<Awaited<ReturnType<typeof composeArtifactHost>>>;
const invalid = (): HttpResponse => ({ status: 400, body: { error: "invalid_request" } });

export function createArtifactControl(
  host: Host,
  scope: string,
  contentBase: string,
  admission?: AdmissionAuthority | undefined,
  options?: ArtifactControlOptions | undefined,
): ArtifactControl {
  const control: ArtifactControl = {
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
        // The provider HTTP layer converts thrown causes into responses, so
        // a cause preserved below that layer (probe) wins over the throw.
        const cause = options?.probe?.take() ?? error;
        const override = classifyProviderCause(cause);
        if (override !== undefined) {
          fail(override.reason, override.status);
          return { status: override.status,
            body: { error: override.status === 503 ? "capability_unavailable" : "conflict" } };
        }
        fail("provider_error", 500);
        return { status: 500, body: { error: "provider_error" } };
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
  const probe = options?.probe;
  return probe ? { handle: (...args) => probe.run(() => control.handle(...args)) } : control;
}
