import { randomUUID } from "node:crypto";
import { isArtifactId } from "@sentropic/artifacts/contracts";
import { parseContentHost } from "@sentropic/artifacts/content/routing";
import { projectArtifactHttpOutcome, type HttpResponse } from "@sentropic/artifacts/http";
import { projectArtifactWriteFailure } from "@sentropic/artifacts/server/outcome-contract";
import { authorizeArtifactCommit } from "./commit-policy.js";
import { checkAdmission, type AdmissionAuthority } from "./admission.js";
import type { composeArtifactHost } from "./composition.js";

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
  readonly invocationId: string;
  readonly op: string;
  readonly actorId: string;
  readonly reason: CommitFailureReason;
  readonly status: number;
  readonly atMs: number;
}

export interface CommitFailureLedger {
  record(entry: CommitFailureRecord): void | Promise<void>;
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
      if (write && admission) {
        const commit = await checkAdmission(admission, actorId);
        if (!commit.allowed) return { status: commit.status, body: commit.body };
      }
      const invocation = Object.freeze({ invocationId: randomUUID(), actorId, storageScopeId: scope,
        authorizeCommit: async (...args: Parameters<typeof authorizeArtifactCommit>) => {
          if (admission) {
            let decision;
            try { decision = await checkAdmission(admission, actorId); }
            catch { return { allowed: false as const, reason: "unavailable" as const,
              publicCode: "capability_unavailable", status: 503, retriable: true }; }
            if (!decision.allowed) return { allowed: false as const, reason: "denied" as const,
              publicCode: decision.body.error, status: decision.status, retriable: false };
          }
          return authorizeArtifactCommit(...args);
        } });
      const effective = op === "meta" ? {} : op === "list" ? {
        limit: body.limit === undefined ? 20 : Number(body.limit),
        offset: body.offset === undefined ? 0 : Number(body.offset),
      } : body;
      const outcome = await (host.execute ?? host.app.execute)({ actorId, body: effective,
        method: op === "meta" ? "GET" : "POST",
        path: op === "meta" ? `/meta/${String(artifactId)}` : `/${op}` }, invocation);
      if (!outcome.ok) {
        const entry = projectArtifactWriteFailure(outcome.failure, { dispatched: true, write });
        if (entry) await options?.ledger?.record({ invocationId: entry.invocationId, op, actorId,
          reason: entry.reason, status: entry.status, atMs: (options?.nowMs ?? Date.now)() });
      }
      const response = { ...projectArtifactHttpOutcome(outcome) };
      Object.defineProperty(response, "retryable", { value: !outcome.ok && outcome.failure.retriable });
      if (op !== "publish" || response.status !== 201) return response;
      const result = response.body as { releaseId: string; manifest: string };
      const manifest = JSON.parse(result.manifest) as { digest: string };
      const pinnedUrl = `https://${result.releaseId}.pinned.${contentBase}/`;
      const pinned = parseContentHost(new URL(pinnedUrl).host, contentBase);
      if (pinned?.kind !== "pinned" || pinned.releaseId !== result.releaseId) throw new Error("invalid content links");
      return { status: 201, body: { ...result, artifactId, releaseId: result.releaseId, digest: manifest.digest,
        stableUrl, pinnedUrl } };
    },
  };
  return control;
}
